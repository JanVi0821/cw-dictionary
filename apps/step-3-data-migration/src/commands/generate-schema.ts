import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMA_FILE } from "../config.ts";
import { buildSchemaSql } from "../schema.ts";

// Supabase client 的 Data API 不提供建表 DDL；此命令仅生成 SQL，绝不执行。
async function main() {
  await mkdir(dirname(fileURLToPath(SCHEMA_FILE)), { recursive: true });
  await writeFile(SCHEMA_FILE, buildSchemaSql(), "utf8");
  console.log("Generated sql/schema.sql; no database changes.");
}
main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "SQL generation failed",
  );
  process.exitCode = 1;
});
