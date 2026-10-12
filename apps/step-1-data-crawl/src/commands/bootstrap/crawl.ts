import type { AnyBulkWriteOperation, Collection } from "mongodb";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { categoryId, PAGE_SIZE, pageUrl, parsePage, SORT } from "./api.ts";

const stateFile = new URL(
  "../../../storage/list-crawl-state.json",
  import.meta.url,
);
type PageState = { sids: string[]; total: number; fetched_at: string };
type CategoryState = {
  id: string;
  url: string;
  total: number | null;
  pages: Record<string, PageState>;
  complete: boolean;
  error?: string;
};
type State = {
  version: 1;
  run_id: string;
  sort: string;
  started_at: string;
  complete: boolean;
  categories: CategoryState[];
};

async function saveState(state: State): Promise<void> {
  await mkdir(new URL(".", stateFile), { recursive: true });
  const temporary = new URL("list-crawl-state.json.tmp", stateFile);
  await writeFile(temporary, JSON.stringify(state, null, 2));
  await rename(temporary, stateFile);
}

async function loadState(
  sites: { url: string }[],
  fresh: boolean,
): Promise<State> {
  const categories = sites.map(({ url }) => ({
    id: categoryId(url),
    url,
    total: null,
    pages: {},
    complete: false,
  }));
  if (!fresh) {
    try {
      const previous = JSON.parse(await readFile(stateFile, "utf8")) as State;
      if (
        previous.version !== 1 ||
        previous.sort !== SORT ||
        !Array.isArray(previous.categories)
      )
        throw new Error("Invalid checkpoint");
      if (!previous.complete) {
        if (
          previous.categories.map((c) => c.id).join(",") !==
          categories.map((c) => c.id).join(",")
        ) {
          throw new Error(
            "Categories changed; use --fresh to begin a new scan",
          );
        }
        console.log(`Resuming ${previous.run_id}`);
        return previous;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return {
    version: 1,
    run_id: randomUUID(),
    sort: SORT,
    started_at: new Date().toISOString(),
    complete: false,
    categories,
  };
}

export async function crawlLists(
  collection: Collection,
  sites: { url: string }[],
  options: { fresh: boolean; maxPages: number },
): Promise<boolean> {
  const state = await loadState(sites, options.fresh);
  await saveState(state);
  let processed = 0;
  for (const category of state.categories) {
    if (category.complete) continue;
    delete category.error;
    let totalsChanged = false;
    try {
      for (
        let offset = 0;
        category.total === null || offset < category.total;
        offset += PAGE_SIZE
      ) {
        if (category.pages[String(offset)]) continue;
        if (processed >= options.maxPages) {
          console.log(`Paused after ${processed} pages; checkpoint saved`);
          return false;
        }
        for (let attempt = 1; attempt <= 3; attempt++) {
          let retryDelay = attempt * 1000;
          try {
            const response = await fetch(pageUrl(category.id, offset), {
              headers: {
                Accept: "application/json",
                "User-Agent": "Mozilla/5.0",
                Referer: category.url,
              },
              signal: AbortSignal.timeout(30_000),
            });
            if (!response.ok) {
              if (response.status === 429) {
                const retry = response.headers.get("retry-after");
                if (retry) {
                  const seconds = Number(retry);
                  const remaining = Number.isFinite(seconds)
                    ? seconds * 1000
                    : Date.parse(retry) - Date.now();
                  if (Number.isFinite(remaining))
                    retryDelay = Math.max(retryDelay, remaining);
                }
              }
              await response.body?.cancel();
              throw new Error(`HTTP ${response.status}`);
            }
            const page = parsePage(await response.text(), offset, category.id);
            if (category.total !== null && category.total !== page.total)
              totalsChanged = true;
            const fetchedAt = new Date();
            const operations: AnyBulkWriteOperation[] = page.products.map(
              (product) => {
                const fields: Record<string, unknown> = {};
                const defaults: Record<string, unknown> = { sid: product.sid };
                for (const key of ["name", "price"] as const) {
                  if (product[key] !== null) fields[key] = product[key];
                  else defaults[key] = null;
                }
                return {
                  updateOne: {
                    filter: { sid: product.sid },
                    update: {
                      ...(Object.keys(fields).length ? { $set: fields } : {}),
                      $setOnInsert: defaults,
                      $addToSet: { list_category_ids: category.id },
                    },
                    upsert: true,
                  },
                };
              },
            );
            if (operations.length)
              await collection.bulkWrite(operations, { ordered: false });
            // Standalone MongoDB: save progress only after acknowledged writes.
            // A partially written page is safely retried using upsert.
            category.total = page.total;
            category.pages[String(offset)] = {
              sids: page.products.map((p) => p.sid),
              total: page.total,
              fetched_at: fetchedAt.toISOString(),
            };
            await saveState(state);
            processed++;
            console.log(
              `category=${category.id} offset=${offset} items=${page.products.length} total=${page.total}`,
            );
            break;
          } catch (error) {
            console.error(
              `category=${category.id} offset=${offset} attempt=${attempt}: ${error instanceof Error ? error.message : String(error)}`,
            );
            if (attempt === 3) throw error;
            while (retryDelay > 0) {
              const wait = Math.min(retryDelay, 30_000);
              console.log(
                `Retrying in ${Math.ceil(retryDelay / 1000)} seconds`,
              );
              await delay(wait);
              retryDelay -= wait;
            }
          }
        }
        await delay(250);
      }
      const pages = Object.values(category.pages);
      const rawCount = pages.reduce((sum, page) => sum + page.sids.length, 0);
      const uniqueCount = new Set(pages.flatMap((page) => page.sids)).size;
      if (pages.some((page) => page.total !== category.total))
        totalsChanged = true;
      if (
        totalsChanged ||
        rawCount !== category.total ||
        uniqueCount !== category.total
      ) {
        throw new Error(
          `Reconciliation failed: total=${category.total}, records=${rawCount}, unique=${uniqueCount}, totalChanged=${totalsChanged}; use --fresh to rescan`,
        );
      }
      category.complete = true;
      console.log(`category=${category.id} COMPLETE unique=${uniqueCount}`);
    } catch (error) {
      category.error = error instanceof Error ? error.message : String(error);
      console.error(`category=${category.id} FAILED: ${category.error}`);
    }
    await saveState(state);
  }
  state.complete = state.categories.every((category) => category.complete);
  await saveState(state);
  const runUnique = new Set(
    state.categories.flatMap((c) =>
      Object.values(c.pages).flatMap((p) => p.sids),
    ),
  ).size;
  console.log(
    `run=${state.run_id} complete=${state.complete} uniqueProducts=${runUnique} databaseDocuments=${await collection.countDocuments()}`,
  );
  return state.complete;
}
