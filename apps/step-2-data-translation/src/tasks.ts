import type { Collection, Db, Document, Filter, ObjectId } from "mongodb";
import { PROGRESS_COLLECTION, TARGET_COLLECTION } from "./config.ts";
import type { ProductDocument } from "./types.ts";

export type PendingTask = Document & {
  _id: ObjectId | string;
  source_id?: ObjectId;
  sid: string;
  generation: string;
  owner?: string;
  flag?: string;
};
export type PrepareOptions = {
  limit: number;
  assertRunning: () => void;
  stopping: () => boolean;
};
export type TaskPlan = {
  tasks: Collection<PendingTask>;
  selection: Filter<PendingTask>;
  retranslate: boolean;
  markCompleted: (task: PendingTask) => Promise<void>;
};
export type PrepareTasks = (
  db: Db,
  options: PrepareOptions,
) => Promise<TaskPlan>;
export type ResumeProgress = { _id: string; last_id: ObjectId | null };

/** 首次从历史目标表初始化；之后普通续跑只看自身进度，不受 filter 写入影响。 */
export async function initializeResumeProgress(db: Db) {
  const progress = db.collection<ResumeProgress>(PROGRESS_COLLECTION);
  let saved = await progress.findOne({ _id: "products" });
  if (!saved) {
    const latest = await db
      .collection<ProductDocument>(TARGET_COLLECTION)
      .findOne(
        {},
        {
          sort: { _id: -1 },
          projection: { _id: 1 },
        },
      );
    saved = { _id: "products", last_id: latest?._id ?? null };
    await progress.insertOne(saved);
  }
  return { progress, saved };
}

/** MongoDB 原子领取；同一任务只允许一个 worker 持有。调用方必须持有全局运行锁。 */
export async function claimTask(
  tasks: Collection<PendingTask>,
  selection: Filter<PendingTask>,
  owner: string,
) {
  return tasks.findOneAndUpdate(
    { ...selection, owner: { $exists: false } },
    { $set: { owner } },
    { sort: { source_id: 1, _id: 1 }, returnDocument: "after" },
  );
}
