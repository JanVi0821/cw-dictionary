import { parseArgs } from "node:util";
import { MongoClient } from "mongodb";
import {
  BATCH_SIZE,
  CONNECTION_TIMEOUT_MS,
  ENV,
  LIMIT,
  MONGO_DATABASE,
  SCHEMA,
  TABLES,
  type TableConfig,
  type TableKey,
} from "./config.ts";
import { createSupabaseClient, requiredEnv } from "./database.ts";
import { mapDocument } from "./mapping.ts";
import { syncBatch } from "./sync-batch.ts";

/** 仅迁移指定的一张表；每批一次 Data API upsert，不使用数据库直连。 */
export async function migrate(key: TableKey) {
  const { values } = parseArgs({
    options: {
      limit: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const table: TableConfig = TABLES[key];
  if (values.help) {
    console.log(
      `${table.source} -> ${SCHEMA}.${table.target}\n--limit=100|all：本次读取数量；默认全部。\n${table.incremental ? "扫描全部候选，比较目标后仅新增/更新变化记录；包含旧商品分类变更。" : "重复执行按业务唯一键 upsert。"}`,
    );
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
  const mongo = new MongoClient(requiredEnv(ENV.mongoUri), {
    serverSelectionTimeoutMS: CONNECTION_TIMEOUT_MS,
  });
  const supabase = createSupabaseClient();
  let stopping = false;
  const stop = () => {
    stopping = true;
    console.log("停止读取新记录，当前批次提交后退出。");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    await mongo.connect();
    const db = mongo.db(MONGO_DATABASE);
    // 分类译文所需的父级信息只从原分类表读取一次。
    let parents: Map<number, number | null> | undefined;
    if (key === "collectionTranslations") {
      const rows = await db
        .collection(TABLES.collections.source)
        .find({}, { projection: { collection_id: 1, parent_id: 1 } })
        .toArray();
      parents = new Map(
        rows.map((row) => [row.collection_id, row.parent_id ?? null]),
      );
    }
    const cursor = db
      .collection(table.source)
      .find({})
      .sort({ _id: 1 })
      .batchSize(BATCH_SIZE);
    if (Number.isFinite(limit)) cursor.limit(limit);
    let batch: Record<string, unknown>[] = [];
    let processed = 0;
    let written = 0;
    let unchanged = 0;
    let newRecords = 0;
    let changedRecords = 0;
    async function flush() {
      if (!batch.length) return;
      const result = await syncBatch(supabase, table, batch);
      written += result.written;
      unchanged += result.unchanged;
      newRecords += result.new_records ?? 0;
      changedRecords += result.changed_records ?? 0;
      processed += batch.length;
      batch = [];
      console.log(
        JSON.stringify({
          event: "migration_batch_completed",
          table: table.target,
          processed,
          ...result,
        }),
      );
    }
    try {
      for await (const row of cursor) {
        if (stopping) break;
        batch.push(mapDocument(key, row, parents));
        if (batch.length >= BATCH_SIZE) await flush();
      }
      await flush();
    } finally {
      await cursor.close();
    }
    console.log(
      JSON.stringify({
        event: "migration_finished",
        table: table.target,
        processed,
        written,
        unchanged,
        ...(table.incremental
          ? { new_records: newRecords, changed_records: changedRecords }
          : {}),
        stopping,
      }),
    );
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    await mongo.close();
  }
}
