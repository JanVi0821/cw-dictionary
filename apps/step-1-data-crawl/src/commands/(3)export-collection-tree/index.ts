import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { MongoClient } from "mongodb";
import {
  COLLECTION,
  CONNECTION_TIMEOUT_MS,
  DATABASE,
  DEFAULT_MONGODB_URI,
  LEAVES_FILE,
  OUTPUT_DIRECTORY,
  TREE_FILE,
} from "./config.ts";
import { buildCollectionTree } from "./tree.ts";

async function main() {
  const { values } = parseArgs({
    options: {
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) {
    console.log(`Usage: pnpm export-collection-tree

只读查询 ${DATABASE}.${COLLECTION}，导出完整分类树和所有叶子路径。
输出：${fileURLToPath(OUTPUT_DIRECTORY)}
${TREE_FILE}：全部根节点和嵌套 children。
${LEAVES_FILE}：全部叶子及 ancestor_ids（不含自身）、path_ids（含自身）。
MONGODB_URI 默认 ${DEFAULT_MONGODB_URI}；不自动加载 .env。
不会修改 MongoDB、请求官网或补全商品分类。`);
    return;
  }
  const uri = process.env.MONGODB_URI ?? DEFAULT_MONGODB_URI;
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: CONNECTION_TIMEOUT_MS,
  });
  try {
    // 只读取构树所需的三列，不创建索引、不写入商品或分类表。
    await client.connect();
    const rows = await client
      .db(DATABASE)
      .collection(COLLECTION)
      .find(
        {},
        {
          projection: { _id: 0, collection_id: 1, name: 1, parent_id: 1 },
        },
      )
      .toArray();
    const { roots, leaves } = buildCollectionTree(rows);

    // 全部校验和序列化成功后才输出；每次执行重新生成两份文件。
    const treeJson = JSON.stringify(roots, null, 2) + "\n";
    const leavesJson = JSON.stringify(leaves, null, 2) + "\n";
    await mkdir(OUTPUT_DIRECTORY, { recursive: true });
    const treePath = new URL(TREE_FILE, OUTPUT_DIRECTORY);
    const leavesPath = new URL(LEAVES_FILE, OUTPUT_DIRECTORY);
    await writeFile(treePath, treeJson, "utf8");
    await writeFile(leavesPath, leavesJson, "utf8");
    console.log(
      JSON.stringify(
        {
          event: "collection_tree_exported",
          collection_count: rows.length,
          root_count: roots.length,
          leaf_count: leaves.length,
          tree_file: fileURLToPath(treePath),
          leaves_file: fileURLToPath(leavesPath),
        },
        null,
        2,
      ),
    );
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  let message =
    error instanceof Error ? error.message : "Collection tree export failed";
  if (process.env.MONGODB_URI)
    message = message.replaceAll(process.env.MONGODB_URI, "[redacted]");
  console.error(message);
  process.exitCode = 1;
});
