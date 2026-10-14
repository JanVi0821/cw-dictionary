import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";
import {
  MongoClient,
  type AnyBulkWriteOperation,
  type Document,
} from "mongodb";
import { PAGE_SIZE, SORT, pageUrl, parsePage } from "../(1)bootstrap/api.ts";
import { PAGE_SIZE as PRESCRIPTION_PAGE_SIZE } from "../(2)bootstrap-prescription/config.ts";
import {
  categoryId as prescriptionId,
  pageUrl as prescriptionUrl,
  parsePage as parsePrescriptionPage,
} from "../(2)bootstrap-prescription/parse.ts";
import type { CollectionLeaf } from "../(3)export-collection-tree/tree.ts";
import {
  DATABASE,
  DEFAULT_MONGODB_URI,
  LEAVES_PATH,
  MAX_ATTEMPTS,
  MAX_PAGES,
  PAGE_INTERVAL_MS,
  PRODUCT_COLLECTION,
  REQUEST_TIMEOUT_MS,
  RETRY_INTERVAL_MS,
  STATE_PATH,
} from "./config.ts";

type State = {
  version: 1;
  input_hash: string;
  sort: string;
  leaf_index: number;
  next_offset: number;
  total: number | null;
  /** 仅记录当前分类的原始 SID，用于核对重复分页；完成分类后清空。 */
  seen_sids: string[];
  complete: boolean;
};
type Page = {
  products: { sid: string; name: string | null }[];
  rawSids: string[];
  total: number;
};

/** 校验导出的叶子文件，避免输入错误时把别的分类链写入商品。 */
function parseLeaves(value: unknown): CollectionLeaf[] {
  if (!Array.isArray(value))
    throw new Error("Invalid leaves.json: expected array");
  const ids = new Set<number>();
  for (const leaf of value) {
    if (
      !leaf ||
      !Number.isSafeInteger(leaf.collection_id) ||
      leaf.collection_id <= 0 ||
      typeof leaf.name !== "string" ||
      !leaf.name.trim() ||
      !Array.isArray(leaf.path_ids) ||
      !leaf.path_ids.length ||
      leaf.path_ids.some(
        (id: unknown) => !Number.isSafeInteger(id) || Number(id) <= 0,
      ) ||
      new Set(leaf.path_ids).size !== leaf.path_ids.length ||
      leaf.path_ids.at(-1) !== leaf.collection_id ||
      !Array.isArray(leaf.ancestor_ids) ||
      JSON.stringify(leaf.ancestor_ids) !==
        JSON.stringify(leaf.path_ids.slice(0, -1)) ||
      leaf.parent_id !== (leaf.path_ids.at(-2) ?? null)
    )
      throw new Error(
        "Invalid leaf/path_ids in leaves.json; export the collection tree again",
      );
    if (ids.has(leaf.collection_id))
      throw new Error(`Duplicate leaf: ${leaf.collection_id}`);
    ids.add(leaf.collection_id);
  }
  return value;
}

/** checkpoint 通过临时文件原子替换；只能在整页 MongoDB 写入成功后调用。 */
async function saveState(state: State) {
  await mkdir(new URL(".", STATE_PATH), { recursive: true });
  const temporary = new URL(`${STATE_PATH.href}.tmp`);
  await writeFile(temporary, JSON.stringify(state, null, 2) + "\n");
  await rename(temporary, STATE_PATH);
}

async function loadState(
  leaves: CollectionLeaf[],
  fresh: boolean,
): Promise<State> {
  const hash = createHash("sha256")
    .update(
      JSON.stringify(leaves.map((leaf) => [leaf.collection_id, leaf.path_ids])),
    )
    .digest("hex");
  const initial: State = {
    version: 1,
    input_hash: hash,
    sort: SORT,
    leaf_index: 0,
    next_offset: 0,
    total: null,
    seen_sids: [],
    complete: leaves.length === 0,
  };
  if (fresh) return initial;
  let stored: State;
  try {
    stored = JSON.parse(await readFile(STATE_PATH, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return initial;
    throw error;
  }
  if (
    stored.version !== 1 ||
    stored.input_hash !== hash ||
    stored.sort !== SORT
  )
    throw new Error(
      "Leaf paths changed or checkpoint incompatible; use --fresh to rescan",
    );
  const pageSize =
    leaves[stored.leaf_index]?.collection_id === Number(prescriptionId())
      ? PRESCRIPTION_PAGE_SIZE
      : PAGE_SIZE;
  if (
    !Number.isSafeInteger(stored.leaf_index) ||
    stored.leaf_index < 0 ||
    stored.leaf_index > leaves.length ||
    !Number.isSafeInteger(stored.next_offset) ||
    stored.next_offset < 0 ||
    stored.next_offset % pageSize !== 0 ||
    !(
      stored.total === null ||
      (Number.isSafeInteger(stored.total) && stored.total >= 0)
    ) ||
    !Array.isArray(stored.seen_sids) ||
    stored.seen_sids.some(
      (sid) => typeof sid !== "string" || !/^\d+$/.test(sid),
    ) ||
    new Set(stored.seen_sids).size !== stored.seen_sids.length ||
    stored.seen_sids.length !== stored.next_offset ||
    typeof stored.complete !== "boolean" ||
    stored.complete !== (stored.leaf_index === leaves.length) ||
    (stored.total === null
      ? stored.next_offset !== 0
      : stored.next_offset >= stored.total)
  )
    throw new Error(
      "Invalid category completion checkpoint; use --fresh to rescan",
    );
  return stored;
}

async function fetchPage(leaf: CollectionLeaf, offset: number): Promise<Page> {
  const prescription = leaf.collection_id === Number(prescriptionId());
  const address = prescription
    ? prescriptionUrl(offset / PRESCRIPTION_PAGE_SIZE + 1)
    : pageUrl(String(leaf.collection_id), offset);
  for (let attempt = 1; ; attempt++) {
    let retryDelay = attempt * RETRY_INTERVAL_MS;
    try {
      const response = await fetch(address, {
        headers: {
          "User-Agent": "Mozilla/5.0",
          Accept: prescription ? "text/html" : "application/json",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        const retry = response.headers.get("retry-after");
        if (response.status === 429 && retry) {
          const ms = /^\d+$/.test(retry)
            ? Number(retry) * 1000
            : Date.parse(retry) - Date.now();
          if (Number.isFinite(ms)) retryDelay = Math.max(retryDelay, ms);
        }
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status}`);
      }
      const body = await response.text();
      if (prescription) {
        const page = parsePrescriptionPage(
          body,
          response.url,
          offset / PRESCRIPTION_PAGE_SIZE + 1,
        );
        return {
          products: page.products,
          rawSids: page.rawSids,
          total: page.total,
        };
      }
      // 此阶段只取 SID/名称，价格不是入库字段，不因价格文案影响分类补全。
      const page = parsePage(body, offset, String(leaf.collection_id), {
        readPrice: false,
      });
      return {
        products: page.products,
        rawSids: page.products.map((p) => p.sid),
        total: page.total,
      };
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS) throw error;
      console.error(
        `category=${leaf.collection_id} offset=${offset} attempt=${attempt}: ${error instanceof Error ? error.message : "Request failed"}`,
      );
      while (retryDelay > 0) {
        const wait = Math.min(retryDelay, 30_000);
        await delay(wait);
        retryDelay -= wait;
      }
    }
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      fresh: { type: "boolean", default: false },
      "max-pages": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(`Usage: pnpm complete-product-collections [--fresh] [--max-pages=N]
读取导出的 leaves.json，分页合并 path_ids 到 ${DATABASE}.${PRODUCT_COLLECTION}.category_ids。
新商品写入 sid、name、category_ids；不会采集详情、价格或更新译文/Supabase。
默认从 checkpoint 续跑，已全部完成则退出；--fresh 从首叶子重扫但不删除已有数据。
配置：src/commands/(4)complete-product-collections/config.ts
请先执行 pnpm export-collection-tree。本命令仅允许单实例运行。`);
    return;
  }
  const maxPages =
    values["max-pages"] === undefined ? MAX_PAGES : Number(values["max-pages"]);
  if (
    maxPages !== Infinity &&
    (!Number.isSafeInteger(maxPages) || maxPages < 1)
  )
    throw new Error("Invalid --max-pages");
  const leaves = parseLeaves(JSON.parse(await readFile(LEAVES_PATH, "utf8")));
  const state = await loadState(leaves, values.fresh);
  if (state.complete) {
    console.log("All leaves completed; use --fresh to rescan.");
    return;
  }
  const client = new MongoClient(
    process.env.MONGODB_URI ?? DEFAULT_MONGODB_URI,
    { serverSelectionTimeoutMS: 5000 },
  );
  let stopping = false;
  const stop = () => {
    stopping = true;
    console.log("Stopping after current page and checkpoint.");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    await client.connect();
    const products = client.db(DATABASE).collection(PRODUCT_COLLECTION);
    await products.createIndex(
      { sid: 1 },
      { unique: true, name: "sid_unique" },
    );
    await saveState(state);
    let pages = 0;
    while (state.leaf_index < leaves.length && !stopping && pages < maxPages) {
      const leaf = leaves[state.leaf_index]!;
      const pageSize =
        leaf.collection_id === Number(prescriptionId())
          ? PRESCRIPTION_PAGE_SIZE
          : PAGE_SIZE;
      const page = await fetchPage(leaf, state.next_offset);
      // 检测总数变化及跨页重复，避免静默跳过商品或误把重复首屏当后续页。
      if (state.total !== null && state.total !== page.total)
        throw new Error(
          `Category total changed: ${leaf.collection_id}; use --fresh to rescan`,
        );
      const seen = new Set(state.seen_sids);
      for (const sid of page.rawSids) {
        if (seen.has(sid))
          throw new Error(
            `Duplicate sid across pages: category=${leaf.collection_id}, sid=${sid}; use --fresh`,
          );
        seen.add(sid);
      }
      const operations: AnyBulkWriteOperation<Document>[] = page.products.map(
        (product) => {
          if (!product.name?.trim())
            throw new Error(`Missing product name: ${product.sid}`);
          return {
            updateOne: {
              filter: { sid: product.sid },
              upsert: true,
              update: [
                {
                  $set: {
                    // $literal 防止商品名称中的 $ 被当成表达式；已有 name 不覆盖。
                    name: {
                      $cond: [
                        { $eq: [{ $type: "$name" }, "missing"] },
                        { $literal: product.name },
                        "$name",
                      ],
                    },
                    // 原子集合并集，同时去除旧数组和新路径内部的重复 ID；不推断数组父子关系。
                    category_ids: {
                      $setUnion: [
                        { $ifNull: ["$category_ids", []] },
                        { $literal: leaf.path_ids },
                      ],
                    },
                  },
                },
              ],
            },
          };
        },
      );
      // upsert 的 filter 会提供新记录 sid；每个商品一次更新，批量发送减少往返。
      const result = operations.length
        ? await products.bulkWrite(operations, { ordered: false })
        : null;
      const offset = state.next_offset;
      const finished = offset + page.rawSids.length >= page.total;
      if (finished && seen.size !== page.total)
        throw new Error(`Category count mismatch: ${leaf.collection_id}`);
      if (finished) {
        state.leaf_index++;
        state.next_offset = 0;
        state.total = null;
        state.seen_sids = [];
      } else {
        state.next_offset += pageSize;
        state.total = page.total;
        state.seen_sids = [...seen];
      }
      state.complete = state.leaf_index === leaves.length;
      await saveState(state);
      pages++;
      console.log(
        JSON.stringify({
          event: "category_page_completed",
          collection_id: leaf.collection_id,
          path_ids: leaf.path_ids,
          offset,
          total: page.total,
          products: page.products.length,
          inserted: result?.upsertedCount ?? 0,
          matched: result?.matchedCount ?? 0,
          modified: result?.modifiedCount ?? 0,
          category_complete: finished,
          leaves_completed: state.leaf_index,
          leaves_total: leaves.length,
          pages,
        }),
      );
      if (!state.complete && !stopping && pages < maxPages)
        await delay(PAGE_INTERVAL_MS);
    }
    console.log(
      JSON.stringify({
        event: "category_completion_finished",
        complete: state.complete,
        pages,
        leaves_completed: state.leaf_index,
        leaves_total: leaves.length,
      }),
    );
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    await client.close();
  }
}

main().catch((error: unknown) => {
  let message =
    error instanceof Error
      ? error.message
      : "Product category completion failed";
  if (process.env.MONGODB_URI)
    message = message.replaceAll(process.env.MONGODB_URI, "[redacted]");
  console.error(message);
  process.exitCode = 1;
});
