import { MongoClient } from "mongodb";
import { parseArgs } from "node:util";
import { crawlPrescriptionLists } from "./crawl.ts";

async function main(): Promise<void> {
  // 1. 独立命令，仅采集处方药 SSR 列表，不调用商品详情或通用 bootstrap。
  const { values } = parseArgs({
    options: {
      fresh: { type: "boolean", default: false },
      "max-pages": { type: "string" },
      help: { type: "boolean", default: false, short: "h" },
    },
  });
  if (values.help) {
    console.log(`Usage: pnpm bootstrap-prescription [--fresh] [--max-pages=N]

采集处方药 SSR 列表到 cw_data.data_raw，补充 images 和 isPrescription。
默认读取 config.ts 的 MAX_PAGES，并恢复未完成的分页进度。
--fresh       从第 1 页重新扫描，不删除数据库商品
--max-pages=N 本次最多处理 N 页
--help        仅显示帮助，不连接数据库
MONGODB_URI 默认 mongodb://127.0.0.1:27017`);
    return;
  }
  const maxPages =
    values["max-pages"] === undefined ? undefined : Number(values["max-pages"]);
  if (
    maxPages !== undefined &&
    (!Number.isSafeInteger(maxPages) || maxPages < 1)
  ) {
    throw new Error("--max-pages must be a positive integer");
  }

  // 2. 沿用本地 MongoDB 商品表，以 sid 唯一索引保证已有商品只打补丁。
  const client = new MongoClient(
    process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017",
    { serverSelectionTimeoutMS: 5000 },
  );
  try {
    await client.connect();
    await crawlPrescriptionLists(client.db("cw_data").collection("data_raw"), {
      fresh: values.fresh,
      maxPages,
    });
  } finally {
    // 3. 失败、暂停或完成时都释放连接，未完成页下次会重试。
    await client.close();
  }
}
await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
