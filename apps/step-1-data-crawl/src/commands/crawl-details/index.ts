import { MongoClient } from "mongodb";
import { parseArgs } from "node:util";
import { crawlDetails, type RawProduct } from "./crawl.ts";
import { LIMIT } from "./config.ts";
import type { CollectionRecord } from "./parse.ts";

async function main(): Promise<void> {
  // 1. CLI 只决定是否刷新详情；数量统一由 config.ts 的 LIMIT 管理。
  const { values } = parseArgs({
    options: {
      refresh: { type: "boolean", default: false },
      help: { type: "boolean", default: false, short: "h" },
    },
  });
  if (values.help) {
    console.log(`Usage: pnpm crawl-details [--refresh]

默认处理未完成详情的商品，本次最多尝试 ${LIMIT} 个。
数量配置：src/commands/crawl-details/config.ts -> LIMIT
--refresh  重新采集已有详情的商品（仍受 LIMIT 限制）
--help     显示帮助，不连接数据库
MONGODB_URI 默认 mongodb://127.0.0.1:27017`);
    return;
  }

  // 2. 连接本地 MongoDB，固定沿用 cw_data，不创建新的商品数据集合。
  const client = new MongoClient(
    process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017",
    {
      serverSelectionTimeoutMS: 5000,
    },
  );
  try {
    await client.connect();
    const db = client.db("cw_data");
    // 3. data_raw 存商品；collection_raw 存去重后的分类编号及名称。
    // 显式指定文档结构，避免把商品、分类集合混用。
    await crawlDetails(
      db.collection<RawProduct>("data_raw"),
      db.collection<CollectionRecord>("collection_raw"),
      values.refresh,
    );
  } finally {
    // 4. 成功或失败都释放连接，确保命令能正常结束。
    await client.close();
  }
}

// 5. 未处理的连接或配置错误统一作为失败退出，不启动任何自动全量重跑。
await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
