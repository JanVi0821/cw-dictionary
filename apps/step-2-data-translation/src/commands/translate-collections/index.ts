import { parseArgs } from "node:util";
import { MongoClient } from "mongodb";
import { createDeeplTranslator } from "../../deepl.ts";
import { createDeeplKeyPool } from "../../deepl-api-keys/deepl-key-pool.ts";
import { acquireRedisLock, createRedisConnection } from "../../redis.ts";
import {
  DATABASE,
  DEEPL_OPTIONS,
  LIMIT,
  RUN_LOCK_KEY,
  SOURCE_COLLECTION,
  TARGET_COLLECTION,
  TRANSLATION_FIELDS,
  VERSION,
} from "./config.ts";
import { buildCollectionContext, type CollectionDocument } from "./context.ts";

async function main() {
  const { values } = parseArgs({
    options: {
      limit: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(`pnpm translate-collections [--limit=10|all]
单线程翻译 collection_raw.name，写入 collection_raw_translated。
默认处理全部未完成分类；重复执行跳过已完成记录，无翻译缓存。
Redis 仅用于共享 DeepL key 文件的运行锁，不可与商品翻译命令同时执行。`);
    return;
  }
  const limit =
    values.limit === undefined
      ? LIMIT
      : values.limit === "all"
        ? Infinity
        : Number(values.limit);
  if (limit !== Infinity && (!Number.isSafeInteger(limit) || limit < 1))
    throw new Error("Invalid limit");
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) throw new Error("MONGODB_URI missing");
  if (SOURCE_COLLECTION === (TARGET_COLLECTION as string))
    throw new Error("Source and target must differ");

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  const redis = createRedisConnection();
  let lock: Awaited<ReturnType<typeof acquireRedisLock>> | undefined;
  let stopping = false;
  let processed = 0;
  const stop = () => {
    stopping = true;
    console.log("停止领取新分类，当前分类写入后退出。");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    // 1. 保护共用的 API key 文件；此命令没有 worker 队列或缓存锁。
    await redis.connect();
    lock = await acquireRedisLock(redis, RUN_LOCK_KEY);
    const assertRunning = () => lock!.assertOwned();
    const keyPool = await createDeeplKeyPool();
    const translate = createDeeplTranslator(
      keyPool,
      assertRunning,
      DEEPL_OPTIONS,
    );
    await client.connect();
    const db = client.db(DATABASE);
    const source = db.collection<CollectionDocument>(SOURCE_COLLECTION);
    const target = db.collection(TARGET_COLLECTION);
    await target.createIndex({ collection_id: 1 }, { unique: true });

    // 2. 分类数量较少，一次读取用于解析父级路径和直接子分类示例。
    const rows = await source.find({}).sort({ _id: 1 }).toArray();
    const byId = new Map<number, CollectionDocument>();
    const children = new Map<number, string[]>();
    for (const row of rows) {
      if (
        !Number.isSafeInteger(row.collection_id) ||
        typeof row.name !== "string" ||
        !row.name.trim() ||
        (row.parent_id != null && !Number.isSafeInteger(row.parent_id))
      )
        throw new Error(`Invalid category: ${String(row.collection_id)}`);
      if (byId.has(row.collection_id))
        throw new Error(`Duplicate category: ${row.collection_id}`);
      byId.set(row.collection_id, row);
      if (row.parent_id != null) {
        const names = children.get(row.parent_id) ?? [];
        names.push(row.name.trim());
        children.set(row.parent_id, names);
      }
    }

    // 3. 目标记录本身就是断点，避免只记最大 ID 时漏掉较小 ID 的未完成项。
    const completed = new Set(
      (
        await target
          .find(
            { "translation.status": "completed" },
            { projection: { collection_id: 1 } },
          )
          .toArray()
      ).map((row) => row.collection_id as number),
    );
    console.log(
      JSON.stringify({
        event: "collections_resume",
        total: rows.length,
        remaining: rows.filter((row) => !completed.has(row.collection_id))
          .length,
      }),
    );

    // 4. 顺序处理，只将 name 送入 DeepL；context 使用原始英文分类关系。
    for (const row of rows) {
      if (stopping || processed >= limit) break;
      if (completed.has(row.collection_id)) continue;
      assertRunning();
      const context = buildCollectionContext(row, byId, children);
      const name = await translate(row.name, {
        sid: String(row.collection_id),
        path: "name",
        mode: "text",
        context,
      });

      // 5. 完整译文与完成标记在同一次写入中提交；失败时下次仍会处理该分类。
      assertRunning();
      if ((await redis.get(lock.key)) !== lock.token)
        throw new Error("Translation run lock lost before category write");
      await target.replaceOne(
        { collection_id: row.collection_id },
        {
          ...row,
          name,
          translation: {
            status: "completed",
            provider: "deepl",
            lang: DEEPL_OPTIONS.targetLang,
            version: VERSION,
            fields: [...TRANSLATION_FIELDS],
            source_name: row.name,
            completed_at: new Date(),
          },
        },
        { upsert: true },
      );
      processed++;
      console.log(
        JSON.stringify({
          event: "collection_completed",
          collection_id: row.collection_id,
          processed,
        }),
      );
    }
    console.log(
      JSON.stringify({ event: "collections_finished", processed, stopping }),
    );
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    try {
      await lock?.release();
    } finally {
      try {
        await client.close();
      } finally {
        if (redis.isOpen) redis.destroy();
      }
    }
  }
}

main().catch((error: unknown) => {
  let message = error instanceof Error ? error.message : "Unknown error";
  for (const secret of [process.env.MONGODB_URI, process.env.REDIS_URL])
    if (secret) message = message.replaceAll(secret, "[redacted]");
  console.error(message);
  process.exitCode = 1;
});
