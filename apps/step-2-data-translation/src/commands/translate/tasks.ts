import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import {
  BATCH_SIZE,
  SOURCE_COLLECTION,
  TASK_COLLECTION,
} from "../../config.ts";
import {
  initializeResumeProgress,
  type PendingTask,
  type PrepareTasks,
} from "../../tasks.ts";
import type { ProductDocument } from "../../types.ts";

export const prepareResumeTasks: PrepareTasks = async (db, options) => {
  const tasks = db.collection<PendingTask>(TASK_COLLECTION);
  await tasks.createIndex({ owner: 1, source_id: 1, _id: 1 });
  await tasks.updateMany({}, { $unset: { owner: "" } });
  const { progress, saved } = await initializeResumeProgress(db);
  console.log(
    JSON.stringify({ event: "translation_resume", after_id: saved.last_id }),
  );
  const cursor = db
    .collection<ProductDocument>(SOURCE_COLLECTION)
    .find(
      {
        fetched_at: { $type: "string", $ne: "" },
        ...(saved.last_id ? { _id: { $gt: saved.last_id } } : {}),
      },
      { projection: { _id: 1, sid: 1 } },
    )
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
          update: {
            $setOnInsert: {
              source_id: row._id,
              sid: row.sid,
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
  return {
    tasks,
    selection: {},
    retranslate: false,
    async markCompleted(task) {
      const id = task.source_id ?? task._id;
      if (!(id instanceof ObjectId))
        throw new Error("Invalid resume source ID");
      // pending 已先持久化；并发较大 ID 先完成时，较小未完成任务仍可恢复。
      await progress.updateOne({ _id: "products" }, { $max: { last_id: id } });
    },
  };
};
