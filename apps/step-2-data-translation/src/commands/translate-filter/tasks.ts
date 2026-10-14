import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import {
  BATCH_SIZE,
  FILTER_COMPLETION_FLAG,
  FILTER_TASK_COLLECTION,
  SOURCE_COLLECTION,
  TRANSLATION_FILTER,
} from "../../config.ts";
import {
  initializeResumeProgress,
  type PendingTask,
  type PrepareTasks,
} from "../../tasks.ts";
import type { ProductDocument } from "../../types.ts";

export const prepareFilterTasks: PrepareTasks = async (db, options) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(FILTER_COMPLETION_FLAG))
    throw new Error(
      "FILTER_COMPLETION_FLAG must be a nonempty field name without dots or $",
    );
  // 在第一次 filter 写入目标之前固定普通续跑起点，避免重译高 ID 改变普通进度。
  await initializeResumeProgress(db);
  const source = db.collection<ProductDocument>(SOURCE_COLLECTION);
  const tasks = db.collection<PendingTask>(FILTER_TASK_COLLECTION);
  const flagPath = `translation_flags.${FILTER_COMPLETION_FLAG}`;
  const selection = { flag: FILTER_COMPLETION_FLAG };
  await tasks.createIndex({ flag: 1, owner: 1, source_id: 1 });
  await tasks.updateMany(selection, { $unset: { owner: "" } });
  const cursor = source
    .find(
      {
        $and: [
          TRANSLATION_FILTER,
          { fetched_at: { $type: "string", $ne: "" } },
          { [flagPath]: { $ne: true } },
        ],
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
          // 标记名参与任务 ID，不同重译批次的待办不会相互覆盖。
          filter: { _id: `${FILTER_COMPLETION_FLAG}:${row._id.toHexString()}` },
          update: {
            $setOnInsert: {
              source_id: row._id,
              sid: row.sid,
              flag: FILTER_COMPLETION_FLAG,
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
  console.log(
    JSON.stringify({
      event: "translation_filter_resume",
      flag: FILTER_COMPLETION_FLAG,
      pending: await tasks.countDocuments(selection),
    }),
  );
  return {
    tasks,
    selection,
    retranslate: true,
    async markCompleted(task) {
      if (!(task.source_id instanceof ObjectId))
        throw new Error("Invalid filter source ID");
      // 先写译文，后打原表标记，最后删除 pending；中途退出由 task_id 防止重复重译。
      const result = await source.updateOne(
        { _id: task.source_id },
        { $set: { [flagPath]: true } },
      );
      if (result.matchedCount !== 1)
        throw new Error(`Filter source product disappeared: ${task.sid}`);
    },
  };
};
