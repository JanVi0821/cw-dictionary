import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import {
  CATEGORY_CONTEXT_PREFIX,
  COLLECTION_COLLECTION,
  CONTEXT_PRODUCT_FIELDS,
  CONTEXT_MAX_CHARS,
} from "./config.ts";
import type { ProductDocument } from "./types.ts";

export const contextHash = (context: string) =>
  createHash("sha256").update(context).digest("hex");

/** 启动时一次加载分类名称，避免每个商品或每个字段都访问 collection_raw。 */
export async function loadCollectionNames(
  db: Db,
): Promise<Map<number, string>> {
  const rows = await db
    .collection(COLLECTION_COLLECTION)
    .find(
      {},
      {
        projection: { _id: 0, collection_id: 1, name: 1 },
      },
    )
    .toArray();
  const names = new Map<number, string>();
  for (const row of rows) {
    const id = Number(row.collection_id);
    if (
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      typeof row.name !== "string" ||
      !row.name.trim()
    )
      throw new Error("Invalid collection_raw record");
    const name = row.name.replace(/\s+/g, " ").trim();
    if (names.has(id) && names.get(id) !== name)
      throw new Error(`Conflicting collection names: ${id}`);
    names.set(id, name);
  }
  console.log(
    JSON.stringify({
      event: "translation_collections_loaded",
      count: names.size,
    }),
  );
  return names;
}

/** 分类与原始英文属性组成商品背景，不使用已有译文或由 ID 推测商品信息。 */
export function buildProductContext(
  row: ProductDocument,
  names: Map<number, string>,
): string {
  if (!Array.isArray(row.category_ids) || !row.category_ids.length)
    throw new Error(`Missing category_ids for context: ${row.sid}`);
  const labels: string[] = [];
  for (const value of row.category_ids) {
    if (
      !/^[1-9]\d*$/.test(String(value)) ||
      !Number.isSafeInteger(Number(value))
    )
      throw new Error(`Invalid category ID for context: ${row.sid}`);
    const name = names.get(Number(value));
    if (!name)
      throw new Error(
        `Missing collection_raw category: sid=${row.sid}, id=${value}`,
      );
    if (!labels.includes(name)) labels.push(name);
  }
  const lines = [`${CATEGORY_CONTEXT_PREFIX}${labels.join(", ")}.`];
  for (const { field, label } of CONTEXT_PRODUCT_FIELDS) {
    const value: unknown = row[field];
    let content = "";
    if (typeof value === "string") content = value;
    else if (Array.isArray(value)) {
      content = value
        .map((item: unknown) => {
          if (typeof item === "string") return item;
          if (
            field === "feature_attributes" &&
            item &&
            typeof item === "object"
          ) {
            const attribute = item as { label?: unknown; value?: unknown };
            if (typeof attribute.label !== "string") return "";
            const values = Array.isArray(attribute.value)
              ? attribute.value
                  .filter((entry): entry is string => typeof entry === "string")
                  .join("; ")
              : typeof attribute.value === "string"
                ? attribute.value
                : "";
            return values.trim() ? `${attribute.label}: ${values}` : "";
          }
          return "";
        })
        .filter((item) => item.trim())
        .join("; ");
    }
    content = content.replace(/\s+/g, " ").trim();
    if (content) lines.push(`${label}: ${content}`);
  }
  if (!Number.isSafeInteger(CONTEXT_MAX_CHARS) || CONTEXT_MAX_CHARS < 1)
    throw new Error("CONTEXT_MAX_CHARS must be a positive integer");
  const chars = Array.from(lines.join("\n"));
  return chars.length <= CONTEXT_MAX_CHARS
    ? chars.join("")
    : `${chars.slice(0, CONTEXT_MAX_CHARS - 1).join("")}…`;
}
