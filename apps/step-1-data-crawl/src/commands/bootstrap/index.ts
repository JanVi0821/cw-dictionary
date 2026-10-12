import { MongoClient } from "mongodb";
import { parseArgs } from "node:util";
import { crawlSites } from "./config.ts";
import { crawlLists } from "./crawl.ts";

const { values } = parseArgs({
  options: {
    "max-pages": { type: "string" },
    fresh: { type: "boolean", default: false },
    help: { type: "boolean", default: false, short: "h" },
  },
});

// 执行脚本，下载cw的商品列表数据到mongodb
async function main(): Promise<void> {
  if (values.help) {
    console.log(`Usage: pnpm bootstrap [--fresh] [--max-pages=N]

Bootstrap product lists into MongoDB cw_data.data_raw.
  --fresh        Start a new scan without deleting existing products
  --max-pages=N  Process at most N pages, then save progress
  --help, -h     Show this help

MONGODB_URI defaults to mongodb://127.0.0.1:27017`);
    return;
  }
  const maxPages =
    values["max-pages"] === undefined ? Infinity : Number(values["max-pages"]);
  if (
    maxPages !== Infinity &&
    (!Number.isSafeInteger(maxPages) || maxPages < 1)
  ) {
    throw new Error("--max-pages must be a positive integer");
  }

  const client = new MongoClient(
    process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017",
    { serverSelectionTimeoutMS: 5000 },
  );
  try {
    await client.connect();
    const collection = client.db("cw_data").collection("data_raw");
    await collection.createIndex(
      { sid: 1 },
      { unique: true, name: "sid_unique" },
    );
    const complete = await crawlLists(collection, crawlSites, {
      fresh: values.fresh,
      maxPages,
    });
    if (!complete && maxPages === Infinity) process.exitCode = 1;
  } finally {
    await client.close();
  }
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
