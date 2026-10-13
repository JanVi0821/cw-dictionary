import {
  EXTENSION_SCHEMA,
  SCHEMA,
  TABLES,
  type TableConfig,
} from "./config.ts";
/** 仅用于生成 SQL 文件，不连接或操作数据库。 */
function q(value: string) {
  if (!/^[a-z_][a-z0-9_]*$/.test(value))
    throw new Error(`Invalid SQL identifier: ${value}`);
  return `"${value}"`;
}

/** 建表脚本不修改已有表。任意同名表存在会报错，事务整体回滚。 */
export function buildSchemaSql() {
  const sql = [
    "-- Generated from src/config.ts. All four tables have identity IDs and no foreign keys.",
    "begin;",
    `create schema if not exists ${q(EXTENSION_SCHEMA)};`,
    `create extension if not exists pg_trgm with schema ${q(EXTENSION_SCHEMA)};`,
    `set local search_path to ${q(SCHEMA)}, ${q(EXTENSION_SCHEMA)};`,
    `grant usage on schema ${q(SCHEMA)} to anon, authenticated, service_role;`,
  ];
  for (const table of Object.values(TABLES) as TableConfig[]) {
    const target = `${q(SCHEMA)}.${q(table.target)}`;
    sql.push(
      `create table ${target} (\n  id bigint generated always as identity primary key,\n  ${table.columns.map((c) => `${q(c.name)} ${c.type} ${c.constraints}`).join(",\n  ")}\n);`,
      `create unique index ${q(`${table.target}_business_key_idx`)} on ${target} (${table.unique.map(q).join(", ")});`,
      `create index ${q(`${table.target}_name_trgm_idx`)} on ${target} using gin (name gin_trgm_ops);`,
    );
    if (table.parentIndex)
      sql.push(
        `create index ${q(`${table.target}_parent_id_idx`)} on ${target} (parent_id, collection_id);`,
      );
    if (table.categoryIndex)
      sql.push(
        `create index ${q(`${table.target}_category_ids_idx`)} on ${target} using gin (category_ids);`,
      );
    sql.push(
      `alter table ${target} enable row level security;`,
      `revoke all privileges on table ${target} from public, anon, authenticated;`,
      `grant select on table ${target} to anon, authenticated;`,
      `grant all privileges on table ${target} to service_role;`,
      `create policy public_read on ${target} for select to anon, authenticated using (true);`,
      `revoke all privileges on sequence ${q(SCHEMA)}.${q(`${table.target}_id_seq`)} from public, anon, authenticated;`,
      `grant usage, select on sequence ${q(SCHEMA)}.${q(`${table.target}_id_seq`)} to service_role;`,
    );
  }
  sql.push("commit;", "");
  return sql.join("\n\n");
}
