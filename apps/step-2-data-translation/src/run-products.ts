import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { MongoClient, ObjectId } from "mongodb";
import {
  API_REQUEST_INTERVAL_MS,
  CUSTOM_INSTRUCTIONS,
  CONCURRENCY,
  DATABASE,
  LIMIT,
  LANG,
  REDIS_NAMESPACE,
  REQUEST_TIMEOUT_MS,
  RETRY_DELAYS_MS,
  SOURCE_LANG,
  SOURCE_COLLECTION,
  TARGET_COLLECTION,
} from "./config.ts";
import { createCachedTranslator } from "./cache.ts";
import { createDeeplTranslator } from "./deepl.ts";
import { createDeeplKeyPool } from "./deepl-api-keys/deepl-key-pool.ts";
import { translateRow } from "./fields.ts";
import type { ProductDocument } from "./types.ts";
import { loadCollectionNames, buildProductContext } from "./context.ts";
import { createRedisConnection, acquireRedisLock } from "./redis.ts";
import { claimTask, type PrepareTasks } from "./tasks.ts";

export async function runProductTranslation(
  command: string,
  description: string,
  prepareTasks: PrepareTasks,
) {
  const { values, positionals } = parseArgs({
    options: {
      limit: { type: "string" },
      concurrency: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });
  if (positionals.some((value) => value !== "--"))
    throw new Error("Unexpected positional argument");
  if (values.help) {
    console.log(`pnpm ${command} [--limit=10|all] [--concurrency=4]
${description}
默认最多完成 ${LIMIT} 条，${CONCURRENCY} 个并发 worker；仍复用 Redis 缓存。
Redis 必须可连接，同一项目只允许一个命令实例。`);
    return;
  }
  const limit =
    values.limit === undefined
      ? LIMIT
      : values.limit === "all"
        ? Infinity
        : Number(values.limit);
  const concurrency =
    values.concurrency === undefined ? CONCURRENCY : Number(values.concurrency);
  if (limit !== Infinity && (!Number.isSafeInteger(limit) || limit < 1))
    throw new Error("Invalid limit");
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 64)
    throw new Error("concurrency must be between 1 and 64");
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) throw new Error("MONGODB_URI missing");
  if (SOURCE_COLLECTION === (TARGET_COLLECTION as string))
    throw new Error("Source and target must differ");

  const redis = createRedisConnection();
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  let runLock: Awaited<ReturnType<typeof acquireRedisLock>> | undefined;
  let stopping = false;
  let fatal: unknown;
  let processed = 0;
  let skipped = 0;
  let reserved = 0;
  const stop = () => {
    stopping = true;
    console.log("停止领取新任务，等待正在处理的商品结束。");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    await redis.connect();
    // 一个项目实例持有共享 key 文件的运行锁；实例内 worker 并发。
    // 防止误开两个命令重置 pending owner 或争写 deep-api-keys.ts。
    runLock = await acquireRedisLock(
      redis,
      `${REDIS_NAMESPACE}:run:${DATABASE}:${TARGET_COLLECTION}`,
    );
    const assertRunning = () => {
      runLock!.assertOwned();
      if (fatal) throw fatal;
    };
    const keyPool = await createDeeplKeyPool();
    const translator = createDeeplTranslator(keyPool, assertRunning, {
      sourceLang: SOURCE_LANG,
      targetLang: LANG,
      customInstructions: CUSTOM_INSTRUCTIONS,
      requestIntervalMs: API_REQUEST_INTERVAL_MS,
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
      retryDelaysMs: RETRY_DELAYS_MS,
    });
    const cached = createCachedTranslator(translator, redis, assertRunning);
    await client.connect();
    const db = client.db(DATABASE);
    const source = db.collection<ProductDocument>(SOURCE_COLLECTION);
    const target = db.collection<ProductDocument>(TARGET_COLLECTION);
    await target.createIndex({ sid: 1 }, { unique: true });
    const names = await loadCollectionNames(db);
    // 开始翻译前先持久化本次待办；崩溃时较小 ID 的任务仍在 pending 中。
    const plan = await prepareTasks(db, {
      limit,
      assertRunning,
      stopping: () => stopping,
    });
    const { tasks, selection } = plan;
    async function worker(index: number) {
      const owner = `${randomUUID()}:${index}`;
      while (!stopping) {
        // 此检查和占位间无 await，因此单进程 worker 不会突破总 limit。
        if (processed + reserved >= limit) return;
        reserved++;
        let task: Awaited<ReturnType<typeof claimTask>> = null;
        try {
          assertRunning();
          task = await claimTask(tasks, selection, owner);
          if (!task) return;
          const sourceId = task.source_id ?? task._id;
          if (!(sourceId instanceof ObjectId))
            throw new Error("Invalid task source ID");
          const row = await source.findOne({ _id: sourceId });
          if (!row)
            throw new Error(
              `Pending product missing from data_raw: ${task.sid}`,
            );
          // 原表完成标记是 filter 任务的最终状态；即使之后另一批重译覆盖目标 task_id，也不重跑。
          if (
            plan.retranslate &&
            task.flag &&
            row.translation_flags?.[task.flag] === true
          ) {
            await tasks.deleteOne({ _id: task._id, owner });
            skipped++;
            continue;
          }
          const existing = await target.findOne(
            { _id: sourceId },
            { projection: { translation: 1 } },
          );
          if (
            existing?.translation?.status === "completed" &&
            (!plan.retranslate ||
              existing.translation.task_id === task.generation)
          ) {
            // 上次写商品后、删 pending 前崩溃：直接完成待办，不再次调用 DeepL。
            await plan.markCompleted(task);
            await tasks.deleteOne({ _id: task._id, owner });
            skipped++;
            continue;
          }
          const context = buildProductContext(row, names);
          console.log(
            JSON.stringify({
              event: "row_started",
              worker: index,
              sid: row.sid,
            }),
          );
          const translated = await translateRow(row, cached.translate, context);
          translated.translation!.task_id = task.generation;
          assertRunning();
          // 写商品前再向 Redis 确认运行锁，连接中断或 Redis 重启后不继续提交。
          if ((await redis.get(runLock!.key)) !== runLock!.token)
            throw new Error("Translation run lock lost before product write");
          if (
            !(await tasks.findOne(
              { _id: task._id, owner },
              { projection: { _id: 1 } },
            ))
          )
            throw new Error(
              "Translation task ownership lost before product write",
            );
          await target.replaceOne({ _id: row._id }, translated, {
            upsert: true,
          });
          await plan.markCompleted(task);
          await tasks.deleteOne({ _id: task._id, owner });
          processed++;
          console.log(
            JSON.stringify({
              event: "row_completed",
              worker: index,
              sid: row.sid,
              processed,
            }),
          );
        } catch (error) {
          // 首个错误阻止所有 worker 继续领取/写入；保留 pending 供下次恢复。
          fatal ??= error;
          stopping = true;
          if (task)
            await tasks.updateOne(
              { _id: task._id, owner },
              { $unset: { owner: "" } },
            );
          throw error;
        } finally {
          reserved--;
        }
      }
    }
    // 不使用提前拒绝的 Promise.all；所有在途任务结束后才关闭 Redis/MongoDB。
    const results = await Promise.allSettled(
      Array.from({ length: concurrency }, (_, i) => worker(i + 1)),
    );
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    console.log(
      JSON.stringify({
        event: "translation_finished",
        processed,
        skipped,
        stopped: stopping,
        concurrency,
      }),
    );
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    // 缓存已在每次翻译成功时写入 Redis，不存在退出保存阶段。
    try {
      if (runLock) await runLock.release();
    } finally {
      try {
        await client.close();
      } finally {
        if (redis.isOpen) redis.destroy();
      }
    }
  }
}

export function reportTranslationError(error: unknown) {
  let message = error instanceof Error ? error.message : "Translation failed";
  for (const key of ["MONGODB_URI", "REDIS_URL", "DEEPL_API_KEY"]) {
    const value = process.env[key];
    if (value) message = message.split(value).join("[REDACTED]");
  }
  console.error(message);
  process.exitCode = 1;
}
