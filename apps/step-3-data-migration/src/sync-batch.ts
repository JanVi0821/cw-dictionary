import { isDeepStrictEqual } from "node:util";
import {
  LOOKUP_PAGE_SIZE,
  REQUEST_TIMEOUT_MS,
  type TableConfig,
} from "./config.ts";
import type { createSupabaseClient } from "./database.ts";

type Row = Record<string, unknown>;
const businessKey = (table: TableConfig, row: Row) =>
  JSON.stringify(table.unique.map((field) => row[field]));

/** 商品每批比较完整业务字段，包括旧商品更新后的 category_ids；不按最大 ID 截断。 */
export async function syncBatch(
  supabase: ReturnType<typeof createSupabaseClient>,
  table: TableConfig,
  rows: Row[],
) {
  let pending = rows;
  let newRecords = 0;
  let changedRecords = 0;
  if (table.incremental) {
    const existing = new Map<string, Row>();
    const fields = table.columns.map((column) => column.name).join(",");
    // 同一 SID 可以有多语言译文；按全部业务键过滤，比较时仍用联合键匹配。
    let offset = 0;
    for (;;) {
      let query = supabase
        .from(table.target)
        .select(fields, { count: "exact" });
      for (const field of table.unique)
        query = query.in(field, [...new Set(rows.map((row) => row[field]))]);
      const { data, error, status, count } = await query
        .order("id", { ascending: true })
        .range(offset, offset + LOOKUP_PAGE_SIZE - 1)
        .abortSignal(AbortSignal.timeout(REQUEST_TIMEOUT_MS));
      if (error)
        throw new Error(
          `Migration lookup failed: ${table.target}, ${error.code || status}, ${error.message}`,
        );
      if (!Array.isArray(data) || count === null)
        throw new Error(`Invalid migration lookup response: ${table.target}`);
      for (const row of data as unknown as Row[])
        existing.set(businessKey(table, row), row);
      offset += data.length;
      if (offset >= count) break;
      if (!data.length)
        throw new Error(
          `Migration lookup returned an incomplete page: ${table.target}`,
        );
    }

    const seen = new Set<string>();
    pending = rows.filter((row) => {
      const key = businessKey(table, row);
      if (seen.has(key))
        throw new Error(
          `Duplicate source business key: ${table.target} ${key}`,
        );
      seen.add(key);
      const previous = existing.get(key);
      if (!previous) {
        newRecords++;
        return true;
      }
      // JSONB 返回的对象键顺序可能不同，深比较避免因键顺序变化反复写入。
      if (
        table.columns.every(({ name }) =>
          isDeepStrictEqual(row[name], previous[name]),
        )
      )
        return false;
      changedRecords++;
      return true;
    });
  }

  if (pending.length) {
    const { error, status } = await supabase
      .from(table.target)
      .upsert(pending, {
        onConflict: table.unique.join(","),
        ignoreDuplicates: false,
        // 不传自增 id；冲突时只更新业务字段，保留目标 id。
        defaultToNull: false,
      })
      .abortSignal(AbortSignal.timeout(REQUEST_TIMEOUT_MS));
    if (error)
      throw new Error(
        `Migration request failed: ${table.target}, ${error.code || status}, ${error.message}`,
      );
  }
  return {
    written: pending.length,
    unchanged: rows.length - pending.length,
    // 基于写入前的快照分类；其他管理进程并发写入时，实际 insert/update 比例可能变化。
    ...(table.incremental
      ? { new_records: newRecords, changed_records: changedRecords }
      : {}),
  };
}
