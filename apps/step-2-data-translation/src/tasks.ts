import type { Collection, Db, Document, Filter, ObjectId } from "mongodb";
import {
  BATCH_SIZE,
  SOURCE_COLLECTION,
  TARGET_COLLECTION,
  TASK_COLLECTION,
} from "./config.ts";
import type { ProductDocument } from "./types.ts";
import { randomUUID } from "node:crypto";

export type PendingTask = Document & {
  _id: ObjectId;
  sid: string;
  force: boolean;
  generation: string;
  owner?: string;
};

/** 调用方必须持有运行锁；恢复历史 pending，防止并发完成顺序导致断点跳过失败任务。 */
export async function prepareTasks(
  db: Db,
  options: {
    sid?: string;
    force: boolean;
    limit: number;
    assertRunning: () => void;
    stopping: () => boolean;
  },
) {
  const tasks = db.collection<PendingTask>(TASK_COLLECTION);
  const selection: Filter<PendingTask> = options.sid
    ? { sid: options.sid }
    : {};
  await tasks.createIndex({ owner: 1, _id: 1 });
  // 全局运行锁保证其他进程不在处理这些任务，可恢复上次强制退出的 owner。
  await tasks.updateMany(selection, { $unset: { owner: "" } });
  const latest =
    !options.sid && !options.force
      ? await db.collection<ProductDocument>(TARGET_COLLECTION).findOne(
          {},
          {
            sort: { _id: -1 },
            projection: { _id: 1, sid: 1 },
          },
        )
      : null;
  console.log(
    JSON.stringify({
      event: "translation_resume",
      after_id: latest?._id ?? null,
      after_sid: latest?.sid ?? null,
    }),
  );
  const source = db.collection<ProductDocument>(SOURCE_COLLECTION);
  const query = {
    fetched_at: { $type: "string" as const, $ne: "" },
    ...(options.sid ? { sid: options.sid } : {}),
    ...(latest ? { _id: { $gt: latest._id } } : {}),
  };
  const cursor = source
    .find(query, { projection: { _id: 1, sid: 1 } })
    .sort({ _id: 1 })
    .batchSize(BATCH_SIZE);
  if (options.limit !== Infinity) cursor.limit(options.limit);
  let rows: ProductDocument[] = [];
  async function flush() {
    if (!rows.length) return;
    options.assertRunning();
    await tasks.bulkWrite(
      rows.map((row) => ({
        updateOne: {
          filter: { _id: row._id },
          update: options.force
            ? {
                $set: { sid: row.sid, force: true },
                $setOnInsert: { generation: randomUUID() },
              }
            : {
                $setOnInsert: {
                  sid: row.sid,
                  force: false,
                  generation: randomUUID(),
                },
              },
          upsert: true,
        },
      })),
      { ordered: false },
    );
    rows = [];
  }
  try {
    for await (const row of cursor) {
      if (options.stopping()) break;
      rows.push(row);
      if (rows.length >= BATCH_SIZE) await flush();
    }
    await flush();
  } finally {
    await cursor.close();
  }
  return { tasks, selection };
}

/** MongoDB 原子领取；同一条任务只有一个 worker 能从无 owner 状态变为自己持有。 */
export async function claimTask(
  tasks: Collection<PendingTask>,
  selection: Filter<PendingTask>,
  owner: string,
) {
  return tasks.findOneAndUpdate(
    { ...selection, owner: { $exists: false } },
    { $set: { owner } },
    { sort: { _id: 1 }, returnDocument: "after" },
  );
}
