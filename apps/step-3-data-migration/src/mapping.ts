import type { Document } from "mongodb";
import {
  TABLES,
  type Column,
  type TableConfig,
  type TableKey,
} from "./config.ts";

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fieldValue(
  column: Column,
  value: unknown,
  translated: boolean,
): unknown {
  if (column.name === "name" || column.name === "locale") {
    if (typeof value !== "string" || !value.trim())
      throw new Error(`Empty or invalid ${column.name}`);
    return value;
  }
  if (column.name === "sid") {
    if (typeof value !== "string" || !/^\d+$/.test(value))
      throw new Error("Invalid sid");
    return value;
  }
  if (column.type === "integer") {
    if (column.name === "parent_id" && value == null) return null;
    if (
      !Number.isSafeInteger(value) ||
      Number(value) <= 0 ||
      Number(value) > 2147483647
    )
      throw new Error(`Invalid ${column.name}`);
    return value;
  }
  if (column.type === "numeric(12,2)") {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0 ||
      value >= 1e10 ||
      Math.abs(value * 100 - Math.round(value * 100)) > 0.0001
    )
      throw new Error("Invalid price");
    return value;
  }
  if (column.type === "boolean") {
    if (value === undefined) return false;
    if (typeof value !== "boolean") throw new Error(`Invalid ${column.name}`);
    return value;
  }
  if (column.type === "text[]" || column.type === "integer[]") {
    if (
      !Array.isArray(value) ||
      value.some((item) =>
        column.type === "text[]"
          ? typeof item !== "string"
          : !Number.isSafeInteger(item) || item <= 0 || item > 2147483647,
      )
    )
      throw new Error(`Invalid ${column.name}`);
    return column.name === "category_ids" ? [...new Set(value)] : value;
  }
  if (column.name === "feature_attributes") {
    if (
      !Array.isArray(value) ||
      value.some(
        (item) =>
          !object(item) ||
          typeof item.label !== "string" ||
          !(
            typeof item.value === "string" ||
            (Array.isArray(item.value) &&
              item.value.every((v) => typeof v === "string"))
          ),
      )
    )
      throw new Error("Invalid feature_attributes");
    return value.map((item) => ({ label: item.label, value: item.value }));
  }
  if (column.name === "info") {
    if (!object(value)) throw new Error("Invalid info");
    return Object.fromEntries(
      Object.entries(value).map(([key, section]) => {
        if (
          !object(section) ||
          typeof section.html !== "string" ||
          !(section.title === null || typeof section.title === "string") ||
          !(
            section.source_hidden === null ||
            typeof section.source_hidden === "boolean"
          )
        )
          throw new Error(`Invalid info.${key}`);
        return [
          key,
          {
            title: section.title,
            html: section.html,
            ...(!translated ? { source_hidden: section.source_hidden } : {}),
          },
        ];
      }),
    );
  }
  if (column.type === "text") {
    if (value == null) return null;
    if (typeof value !== "string") throw new Error(`Invalid ${column.name}`);
    return value;
  }
  throw new Error(`Unhandled field: ${column.name}`);
}

/** 白名单转换，不复制 _id、fetched_at、translation、list_category_ids 等字段。 */
export function mapDocument(
  key: TableKey,
  row: Document,
  originalParents?: Map<number, number | null>,
) {
  const table: TableConfig = TABLES[key];
  try {
    if (table.translated && row.translation?.status !== "completed")
      throw new Error("Missing completed translation");
    const output: Record<string, unknown> = {};
    for (const column of table.columns) {
      // source 支持 translation.lang 等嵌套路径；语言直接沿用每条源记录的值。
      let value = (column.source ?? column.name)
        .split(".")
        .reduce<unknown>(
          (current, field) => (object(current) ? current[field] : undefined),
          row,
        );
      if (key === "collectionTranslations" && column.name === "parent_id") {
        // 按用户要求，译文分类的 parent_id 从原表读取，不依赖译文快照。
        if (!originalParents?.has(row.collection_id))
          throw new Error("Missing original category");
        value = originalParents.get(row.collection_id);
      }
      output[column.name] = fieldValue(column, value, table.translated);
    }
    return output;
  } catch (error) {
    throw new Error(
      `Invalid ${table.source} record ${row.sid ?? row.collection_id}: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}
