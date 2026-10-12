import type { AnyBulkWriteOperation, Collection } from "mongodb";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import {
  EXCLUDED_NAME_KEYWORDS,
  MAX_ATTEMPTS,
  MAX_PAGES,
  PAGE_INTERVAL_MS,
  PAGE_SIZE,
  REQUEST_TIMEOUT_MS,
} from "./config.ts";
import { categoryId, pageUrl, parsePage } from "./parse.ts";

const stateFile = new URL(
  "../../../storage/prescription-list-crawl-state.json",
  import.meta.url,
);
type State = {
  version: 1;
  source: string;
  pageSize: number;
  nextPage: number;
  total: number | null;
  lastPage: number | null;
  pages: Record<string, string[]>;
  written: Record<string, number>;
  excludedNames: string[];
  complete: boolean;
  error?: string;
};

/** MongoDB 确认写入后才保存完成页；临时文件 rename 避免保存到一半损坏。 */
async function saveState(state: State): Promise<void> {
  await mkdir(new URL(".", stateFile), { recursive: true });
  const temporary = new URL(
    "prescription-list-crawl-state.json.tmp",
    stateFile,
  );
  await writeFile(temporary, JSON.stringify(state, null, 2) + "\n");
  await rename(temporary, stateFile);
}
async function loadState(fresh: boolean): Promise<State> {
  if (!fresh) {
    try {
      const previous = JSON.parse(await readFile(stateFile, "utf8")) as State;
      if (
        previous.version !== 1 ||
        previous.source !== pageUrl(1) ||
        previous.pageSize !== PAGE_SIZE ||
        JSON.stringify(previous.excludedNames) !==
          JSON.stringify(EXCLUDED_NAME_KEYWORDS) ||
        !Number.isSafeInteger(previous.nextPage) ||
        previous.nextPage < 1 ||
        !previous.pages ||
        typeof previous.pages !== "object" ||
        Array.isArray(previous.pages) ||
        !previous.written ||
        typeof previous.written !== "object" ||
        Array.isArray(previous.written) ||
        typeof previous.complete !== "boolean" ||
        (previous.total !== null &&
          (!Number.isSafeInteger(previous.total) || previous.total < 0)) ||
        (previous.lastPage !== null &&
          (!Number.isSafeInteger(previous.lastPage) || previous.lastPage < 1))
      ) {
        throw new Error(
          "Invalid prescription checkpoint or configuration changed; use --fresh",
        );
      }
      // 逐页确认检查点连续，避免损坏的 nextPage 导致跳过尚未完成的页。
      for (let page = 1; page < previous.nextPage; page++) {
        const ids = previous.pages[String(page)];
        if (
          !Array.isArray(ids) ||
          ids.some((id) => typeof id !== "string" || !/^\d+$/.test(id)) ||
          !Number.isSafeInteger(previous.written[String(page)]) ||
          previous.written[String(page)]! < 0 ||
          previous.written[String(page)]! > ids.length
        ) {
          throw new Error("Invalid prescription checkpoint pages; use --fresh");
        }
      }
      if (!previous.complete) return previous;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return {
    version: 1,
    source: pageUrl(1),
    pageSize: PAGE_SIZE,
    nextPage: 1,
    total: null,
    lastPage: null,
    pages: {},
    written: {},
    excludedNames: [...EXCLUDED_NAME_KEYWORDS],
    complete: false,
  };
}

/** 在 MongoDB 更新管道中按原顺序合并列表分类数组并去重，无读写竞态。 */
function mergeArray(
  field: string,
  values: (string | number)[],
): Record<string, unknown> {
  return {
    $reduce: {
      input: {
        $concatArrays: [{ $ifNull: [`$${field}`, []] }, { $literal: values }],
      },
      initialValue: [],
      in: {
        $cond: [
          { $in: ["$$this", "$$value"] },
          "$$value",
          { $concatArrays: ["$$value", ["$$this"]] },
        ],
      },
    },
  };
}

export async function crawlPrescriptionLists(
  collection: Collection,
  options: {
    fresh: boolean;
    maxPages?: number;
  },
): Promise<boolean> {
  // 1. 配置页数上限按页计数，独立于 crawl-details 的商品 LIMIT。
  const maxPages = options.maxPages ?? MAX_PAGES;
  if (
    maxPages !== Infinity &&
    (!Number.isSafeInteger(maxPages) || maxPages < 1)
  )
    throw new Error("maxPages must be positive");
  if (
    !Number.isSafeInteger(PAGE_SIZE) ||
    PAGE_SIZE < 1 ||
    !Number.isSafeInteger(MAX_ATTEMPTS) ||
    MAX_ATTEMPTS < 1 ||
    !Number.isSafeInteger(REQUEST_TIMEOUT_MS) ||
    REQUEST_TIMEOUT_MS < 1 ||
    !Number.isFinite(PAGE_INTERVAL_MS) ||
    PAGE_INTERVAL_MS < 0
  ) {
    throw new Error("Invalid prescription crawl configuration");
  }
  const state = await loadState(options.fresh);
  delete state.error;
  await saveState(state);
  await collection.createIndex(
    { sid: 1 },
    { unique: true, name: "sid_unique" },
  );
  let processed = 0;
  try {
    // 2. 从独立 checkpoint 的 nextPage 续跑，绝不使用通用列表 API 的 offset。
    while (state.lastPage === null || state.nextPage <= state.lastPage) {
      if (processed >= maxPages) {
        console.log(
          `处方药列表暂停：处理 ${processed} 页，下次从第 ${state.nextPage} 页继续`,
        );
        return false;
      }
      const page = state.nextPage;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        let retryDelay = attempt * 1000;
        try {
          // 3. 请求 SSR HTML 并核对实际页码、总数、卡片条数及商品 sid。
          const response = await fetch(pageUrl(page), {
            headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0" },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });
          if (!response.ok) {
            const retryAfter = response.headers.get("retry-after");
            if (response.status === 429 && retryAfter) {
              const seconds = Number(retryAfter);
              const milliseconds = Number.isFinite(seconds)
                ? seconds * 1000
                : Date.parse(retryAfter) - Date.now();
              if (Number.isFinite(milliseconds))
                retryDelay = Math.max(retryDelay, milliseconds);
            }
            await response.body?.cancel();
            throw new Error(`HTTP ${response.status}`);
          }
          const parsed = parsePage(await response.text(), response.url, page);
          if (
            (state.total !== null && state.total !== parsed.total) ||
            (state.lastPage !== null && state.lastPage !== parsed.lastPage)
          ) {
            throw new Error(
              "Prescription total changed during scan; use --fresh",
            );
          }

          // 4. 按 sid 原子 upsert：已有商品补充图片和标记；新商品补基本列表字段。
          // images 仅在原字段缺失、null 或 [] 时补丁；非空原数组保持原样。
          // 列表分类有序去重合并，名称和价格仅补缺失值。
          const operations: AnyBulkWriteOperation[] = parsed.products.map(
            (product) => ({
              updateOne: {
                filter: { sid: product.sid },
                update: [
                  {
                    $set: {
                      sid: { $literal: product.sid },
                      name: { $ifNull: ["$name", { $literal: product.name }] },
                      price: {
                        $ifNull: ["$price", { $literal: product.price }],
                      },
                      images: {
                        $cond: [
                          { $eq: [{ $ifNull: ["$images", []] }, []] },
                          { $literal: product.images },
                          "$images",
                        ],
                      },
                      isPrescription: true,
                      list_category_ids: mergeArray("list_category_ids", [
                        categoryId(),
                      ]),
                      // 已完成详情的商品也立即补齐分类；仅更新商品，不处理分类父子关系。
                      category_ids: mergeArray("category_ids", [
                        Number(categoryId()),
                      ]),
                    },
                  },
                ],
                upsert: true,
              },
            }),
          );
          if (operations.length)
            await collection.bulkWrite(operations, { ordered: false });

          // 5. 整页写入确认后才推进 checkpoint；部分写入失败会重试整页，sid 防重复。
          // 分页完整性保留原始 ID；被排除的广告仅出现在本地进度，不进入商品表。
          state.pages[String(page)] = parsed.rawSids;
          state.written[String(page)] = parsed.products.length;
          state.total = parsed.total;
          state.lastPage = parsed.lastPage;
          state.nextPage = page + 1;
          await saveState(state);
          processed++;
          console.log(
            `处方药列表 page=${page}/${parsed.lastPage} raw=${parsed.rawSids.length} products=${parsed.products.length} skipped=${parsed.rawSids.length - parsed.products.length} total=${parsed.total}`,
          );
          break;
        } catch (error) {
          console.error(
            `处方药列表 page=${page} attempt=${attempt}: ${error instanceof Error ? error.message : String(error)}`,
          );
          if (attempt === MAX_ATTEMPTS) throw error;
          while (retryDelay > 0) {
            const chunk = Math.min(30_000, retryDelay);
            if (retryDelay > 30_000)
              console.log(`等待重试 ${Math.ceil(retryDelay / 1000)} 秒`);
            await delay(chunk);
            retryDelay -= chunk;
          }
        }
      }
      await delay(PAGE_INTERVAL_MS);
    }

    // 6. 全分类结束核对原始条数及 sid 去重数，不将页间重复或漏项标成完成。
    const allIds = Object.values(state.pages).flat();
    if (allIds.length !== state.total || new Set(allIds).size !== state.total) {
      throw new Error(
        `Prescription reconciliation failed: total=${state.total}, raw=${allIds.length}, unique=${new Set(allIds).size}; use --fresh`,
      );
    }
    state.complete = true;
    await saveState(state);
    const written = Object.values(state.written).reduce(
      (sum, count) => sum + count,
      0,
    );
    console.log(
      `处方药列表完成：rawUnique=${allIds.length} products=${written} skipped=${allIds.length - written}`,
    );
    return true;
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    await saveState(state);
    throw error;
  }
}
