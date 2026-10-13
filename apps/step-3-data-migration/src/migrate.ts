import { parseArgs } from "node:util";
import { MongoClient } from "mongodb";
import {
  BATCH_SIZE,
  CONNECTION_TIMEOUT_MS,
  ENV,
  LIMIT,
  MONGO_DATABASE,
  REQUEST_TIMEOUT_MS,
  SCHEMA,
  TABLES,
  type TableConfig,
  type TableKey,
} from "./config.ts";
import { createSupabaseClient, requiredEnv } from "./database.ts";
import { mapDocument } from "./mapping.ts";

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
      `${table.source} -> ${SCHEMA}.${table.target}\n--limit=100|all：本次读取数量；默认全部。重复执行按业务唯一键 upsert。`,
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
    async function flush() {
      if (!batch.length) return;
      const { error, status } = await supabase
        .from(table.target)
        .upsert(batch, {
          onConflict: table.unique.join(","),
          ignoreDuplicates: false,
          // 不传 id，自增列使用数据库默认值；已存在记录按业务唯一键更新。
          defaultToNull: false,
        })
        .abortSignal(AbortSignal.timeout(REQUEST_TIMEOUT_MS));
      if (error)
        throw new Error(
          `Migration request failed: ${table.target}, ${error.code || status}, ${error.message}`,
        );
      processed += batch.length;
      batch = [];
      console.log(
        JSON.stringify({
          event: "migration_batch_completed",
          table: table.target,
          processed,
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
        stopping,
      }),
    );
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    await mongo.close();
  }
}
