import type { Document, ObjectId } from "mongodb";
import { CHILD_EXAMPLE_LIMIT, CONTEXT_PREFIX } from "./config.ts";

export type CollectionDocument = Document & {
  _id: ObjectId;
  collection_id: number;
  name: string;
  parent_id: number | null;
};

/** 只使用 collection_raw 的真实父子关系，不引用商品或 list_category_ids。 */
export function buildCollectionContext(
  row: CollectionDocument,
  byId: Map<number, CollectionDocument>,
  children: Map<number, string[]>,
) {
  const ancestors: string[] = [];
  const seen = new Set([row.collection_id]);
  let parentId = row.parent_id;
  while (parentId != null) {
    if (seen.has(parentId))
      throw new Error(`Category parent cycle: ${row.collection_id}`);
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) throw new Error(`Missing category parent: ${parentId}`);
    ancestors.unshift(parent.name.trim());
    parentId = parent.parent_id;
  }
  const examples = (children.get(row.collection_id) ?? []).slice(
    0,
    CHILD_EXAMPLE_LIMIT,
  );
  return [
    CONTEXT_PREFIX,
    `Current category label: ${row.name.trim()}`,
    `Parent hierarchy (root to direct parent): ${ancestors.length ? ancestors.join(" > ") : "Root category; no parent"}`,
    ...(examples.length
      ? [`Direct child category examples: ${examples.join("; ")}`]
      : []),
  ].join("\n");
}
