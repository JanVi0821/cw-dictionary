import type { Collection } from "mongodb";
import { appendFile, mkdir } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import {
  BREADCRUMB_SAVE_INTERVAL,
  hasProcessedBreadcrumbPath,
  loadBreadcrumbPaths,
  saveBreadcrumbPaths,
} from "./breadcrumb-cache.ts";
import {
  LIMIT,
  MAX_ATTEMPTS,
  PRODUCT_INTERVAL_MS,
  REQUEST_TIMEOUT_MS,
} from "./config.ts";
import {
  collectionId,
  parseDetail,
  productSid,
  type CollectionRecord,
} from "./parse.ts";

export type RawProduct = {
  sid: string;
  name?: string;
  list_category_ids?: (string | number)[];
  category_ids?: (string | number)[];
  fetched_at?: string | null;
  images?: string[];
  isPrescription?: boolean;
};
const errorFile = new URL(
  "../../../storage/detail-crawl-errors.jsonl",
  import.meta.url,
);

/** 429 使用服务端 Retry-After；长等待拆段输出，便于了解采集进度。 */
class HttpError extends Error {
  retryAfterMs: number;
  constructor(status: number, retryAfter: string | null) {
    super(`HTTP ${status}`);
    const seconds = retryAfter === null ? NaN : Number(retryAfter);
    this.retryAfterMs =
      status === 429 && retryAfter !== null
        ? Math.max(
            0,
            Number.isFinite(seconds)
              ? seconds * 1000
              : Date.parse(retryAfter) - Date.now(),
          )
        : 0;
    if (!Number.isFinite(this.retryAfterMs)) this.retryAfterMs = 0;
  }
}
async function wait(milliseconds: number): Promise<void> {
  while (milliseconds > 0) {
    const chunk = Math.min(milliseconds, 30_000);
    if (milliseconds > 30_000)
      console.log(`等待重试：剩余 ${Math.ceil(milliseconds / 1000)} 秒`);
    await delay(chunk);
    milliseconds -= chunk;
  }
}

/** 手动跟随重定向，每一跳都验证商品 ID 和域名，不保存完整 URL。 */
async function fetchProduct(
  sid: string,
): Promise<{ html: string; url: string }> {
  let url = `https://www.chemistwarehouse.co.nz/buy/${sid}`;
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  for (let redirect = 0; redirect <= 5; redirect++) {
    if (productSid(url) !== sid)
      throw new Error(`Redirected to a different product: ${sid}`);
    const response = await fetch(url, {
      redirect: "manual",
      signal,
      headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0" },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error(`Redirect without Location: ${sid}`);
      url = new URL(location, url).href;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new HttpError(response.status, response.headers.get("retry-after"));
    }
    return { html: await response.text(), url };
  }
  throw new Error(`Too many redirects: ${sid}`);
}

/** 按商品处理，先写分类，再更新商品；任一失败都会让本商品进入重试。 */
export async function crawlDetails(
  products: Collection<RawProduct>,
  collections: Collection<CollectionRecord>,
  refresh: boolean,
): Promise<void> {
  // 1. 启动前校验配置，避免错误 LIMIT 被解释为无限采集。
  if (!Number.isSafeInteger(LIMIT) || LIMIT < 1)
    throw new Error("LIMIT 必须是正整数");
  if (!Number.isSafeInteger(MAX_ATTEMPTS) || MAX_ATTEMPTS < 1)
    throw new Error("MAX_ATTEMPTS 必须是正整数");
  if (
    !Number.isFinite(PRODUCT_INTERVAL_MS) ||
    PRODUCT_INTERVAL_MS < 0 ||
    !Number.isSafeInteger(REQUEST_TIMEOUT_MS) ||
    REQUEST_TIMEOUT_MS < 1
  ) {
    throw new Error("采集间隔或请求超时配置无效");
  }

  // 2. 启动时从命令同目录文件恢复已处理的面包屑 Set。
  const breadcrumbPaths = await loadBreadcrumbPaths();
  console.log(`已加载面包屑缓存：${breadcrumbPaths.size} 条`);

  // 分类 ID 是唯一键；已有重复导致建索引失败时停止，不擅自删库内记录。
  await products.createIndex({ sid: 1 }, { unique: true, name: "sid_unique" });
  await collections.createIndex(
    { collection_id: 1 },
    { unique: true, name: "collection_id_unique" },
  );

  // 记录数据库实际存在的分类 ID，避免缓存文件存在但分类表被清空时错误跳过。
  const persistedCollectionIds = new Set(
    await collections.distinct("collection_id", {
      parent_id: { $exists: true },
    }),
  );

  // 4. MongoDB 的 null 查询同时匹配字段缺失，自动包含仅 sid/name/category_ids 的增量商品。
  // 不要求 bootstrap 专属的 list_category_ids 或 price；--refresh 才重抓已完成详情。
  // fetched_at 仅在两表写入流程成功后保存，因此无需另建成功进度集合。
  const filter = refresh ? {} : { fetched_at: null };
  const cursor = products
    .find(filter, {
      projection: { sid: 1, category_ids: 1, list_category_ids: 1 },
    })
    .sort({ sid: 1 })
    .limit(LIMIT);
  let attempted = 0;
  let succeeded = 0;
  let failed = 0;
  try {
    for await (const record of cursor) {
      attempted++;
      let lastError: unknown;
      let complete = false;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          // 5. 请求商品 HTML 并完成全部解析，解析失败不写入任何本次商品详情。
          if (typeof record.sid !== "string" || !/^\d+$/.test(record.sid))
            throw new Error("Invalid product sid");
          // 列表分类字段均可缺失；若存在则先验证，避免完成网络请求后才发现输入错误。
          if (
            record.list_category_ids !== undefined &&
            !Array.isArray(record.list_category_ids)
          )
            throw new Error(`Invalid list_category_ids: ${record.sid}`);
          if (
            record.category_ids !== undefined &&
            !Array.isArray(record.category_ids)
          )
            throw new Error(`Invalid category_ids: ${record.sid}`);
          const inherited = (record.list_category_ids ?? []).map(collectionId);
          const existingCategories = (record.category_ids ?? []).map(
            collectionId,
          );
          const page = await fetchProduct(record.sid);
          const parsed = parseDetail(page.html, page.url, record.sid);
          // 缓存键只取原始 breadcrumbs，与 list_category_ids 无关。
          // 保留从左到右的顺序，257,665 与 665,257 是不同的关系链。
          const breadcrumbIds = parsed.collections.map(
            (category) => category.collection_id,
          );
          const breadcrumbKey = breadcrumbIds.join(",");

          // 分类关系只使用 parseDetail.collections，不读取列表分类的名称或父级。
          const byId = new Map(
            parsed.collections.map((category) => [
              category.collection_id,
              category,
            ]),
          );

          // 7. 检查完整命中或更长链的前缀覆盖：a,b,c,d 已处理则 a,b,c 也可跳过。
          // 若数据库曾被清空或删除分类，已存在 ID 检查会使缓存失效并重新写入。
          const cached =
            hasProcessedBreadcrumbPath(breadcrumbPaths, breadcrumbKey) &&
            breadcrumbIds.every((id) => persistedCollectionIds.has(id));
          const categoriesToWrite = cached ? [] : parsed.collections;
          if (categoriesToWrite.length) {
            const previousCategories = await collections
              .find({
                collection_id: {
                  $in: categoriesToWrite.map(
                    (category) => category.collection_id,
                  ),
                },
              })
              .toArray();
            for (const previous of previousCategories) {
              const incoming = byId.get(previous.collection_id)!;
              if (
                previous.parent_id !== undefined &&
                previous.parent_id !== incoming.parent_id
              ) {
                throw new Error(
                  `Collection parent conflict: id=${previous.collection_id} stored=${previous.parent_id} incoming=${incoming.parent_id}`,
                );
              }
            }
            await collections.bulkWrite(
              categoriesToWrite.map((category) => ({
                updateOne: {
                  filter: { collection_id: category.collection_id },
                  update: {
                    $set: {
                      name: category.name,
                      parent_id: category.parent_id,
                    },
                    $setOnInsert: { collection_id: category.collection_id },
                  },
                  upsert: true,
                },
              })),
              { ordered: true },
            );
            for (const category of categoriesToWrite)
              persistedCollectionIds.add(category.collection_id);
          }
          // 只有分类写入成功（或已确认此前存在）才加入 Set，失败不会污染缓存。
          breadcrumbPaths.add(breadcrumbKey);

          // 8. 这些 ID 仅用于商品字段合并，不参与分类父子关系或面包屑缓存。
          // 这里形成解析快照，实际写入时仍以数据库中的最新数组为准。
          parsed.product.category_ids = [
            ...new Set([...breadcrumbIds, ...inherited, ...existingCategories]),
          ];

          // 9. 更新商品详情与完成时间，保留原 list_category_ids，不替换整份文档。
          // 分类先成功、商品后失败时，重试可通过 Set 跳过已完成的分类链。
          const { sid, images, ...fields } = parsed.product;
          // 保留已有处方药标记；增量商品没有列表标记时，由详情页识别后补齐。
          // 用原子更新管道按数据库当前标记保留图片，避免并行补丁期间读写竞态。
          // 其余字段包裹 $literal，防止富文本、名称或特征中的 $ 被解释为表达式。
          const updates: Record<string, unknown> = Object.fromEntries(
            Object.entries(fields).map(([key, value]) => [
              key,
              { $literal: value },
            ]),
          );
          // 原子合并写入时最新的列表和已补全分类，避免其他采集补丁被覆盖。
          // breadcrumbs 保持在前，继承 ID 转为数字并按首次出现顺序去重。
          updates.category_ids = {
            $reduce: {
              input: {
                $concatArrays: [
                  { $literal: breadcrumbIds },
                  {
                    $map: {
                      input: { $ifNull: ["$list_category_ids", []] },
                      as: "category",
                      in: { $toInt: "$$category" },
                    },
                  },
                  {
                    $map: {
                      input: { $ifNull: ["$category_ids", []] },
                      as: "category",
                      in: { $toInt: "$$category" },
                    },
                  },
                ],
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
          updates.images = {
            $cond: [
              {
                $or: [
                  { $eq: ["$isPrescription", true] },
                  { $literal: parsed.isPrescription },
                ],
              },
              { $ifNull: ["$images", []] },
              { $literal: images },
            ],
          };
          if (parsed.isPrescription)
            updates.isPrescription = {
              $cond: [
                { $eq: [{ $type: "$isPrescription" }, "missing"] },
                true,
                "$isPrescription",
              ],
            };
          // 更新并返回实际分类，省去另一次查询；已有详情标记和全部补齐字段同次提交。
          const saved = await products.findOneAndUpdate(
            { _id: record._id, sid },
            [{ $set: updates }],
            {
              returnDocument: "after",
              projection: { sid: 1, category_ids: 1 },
            },
          );
          if (!saved) throw new Error(`Product update did not match: ${sid}`);
          succeeded++;
          complete = true;
          console.log(
            `[${attempted}/${LIMIT}] sid=${sid} 完成，collections=${saved.category_ids!.join(",")}`,
          );
          break;
        } catch (error) {
          lastError = error;
          console.error(
            `sid=${record.sid} attempt=${attempt}: ${error instanceof Error ? error.message : String(error)}`,
          );
          if (attempt < MAX_ATTEMPTS) {
            await wait(
              Math.max(
                attempt * 1000,
                error instanceof HttpError ? error.retryAfterMs : 0,
              ),
            );
          }
        }
      }

      // 10. 重试耗尽后记录本地错误日志，继续下一个商品，不给失败商品写 fetched_at。
      if (!complete) {
        failed++;
        await mkdir(new URL(".", errorFile), { recursive: true });
        await appendFile(
          errorFile,
          JSON.stringify({
            sid: record.sid,
            failed_at: new Date().toISOString(),
            error:
              lastError instanceof Error
                ? lastError.message
                : String(lastError),
          }) + "\n",
        );
      }
      // 每处理 100 个商品落盘一次，失败商品也计数，单商品重试不重复计数。
      if (attempted % BREADCRUMB_SAVE_INTERVAL === 0) {
        await saveBreadcrumbPaths(breadcrumbPaths);
        console.log(
          `已保存面包屑缓存：${breadcrumbPaths.size} 条，已处理 ${attempted} 个商品`,
        );
      }
      await wait(PRODUCT_INTERVAL_MS);
    }
  } finally {
    // 11. 正常结束或可捕获异常退出时，保存不足 100 条的尾批，再关闭 cursor。
    try {
      await saveBreadcrumbPaths(breadcrumbPaths);
    } finally {
      await cursor.close();
    }
  }
  console.log(
    `详情采集结束：attempted=${attempted} succeeded=${succeeded} failed=${failed} limit=${LIMIT}`,
  );
  if (failed) process.exitCode = 1;
}
