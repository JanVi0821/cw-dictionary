import type { Document } from "mongodb";

export type CollectionNode = {
  collection_id: number;
  name: string;
  parent_id: number | null;
  children: CollectionNode[];
};
export type CollectionLeaf = {
  collection_id: number;
  name: string;
  parent_id: number | null;
  /** 从根到直接父级，不包含叶子本身；根节点若也是叶子，此数组为空。 */
  ancestor_ids: number[];
  /** 从根到叶子，包含叶子本身。 */
  path_ids: number[];
};

/** 仅依据 collection_raw 的 parent_id 构建森林，不推测或修复分类关系。 */
export function buildCollectionTree(rows: Document[]) {
  const byId = new Map<number, CollectionNode>();

  // 1. 校验所有记录后再连接父子关系，避免依赖 MongoDB 返回顺序。
  for (const row of rows) {
    if (!Number.isSafeInteger(row.collection_id) || row.collection_id <= 0)
      throw new Error("Invalid collection_id");
    if (typeof row.name !== "string" || !row.name.trim())
      throw new Error(`Invalid collection name: ${row.collection_id}`);
    if (
      row.parent_id !== null &&
      (!Number.isSafeInteger(row.parent_id) || row.parent_id <= 0)
    )
      throw new Error(`Invalid or missing parent_id: ${row.collection_id}`);
    if (byId.has(row.collection_id))
      throw new Error(`Duplicate collection_id: ${row.collection_id}`);
    if (row.parent_id === row.collection_id)
      throw new Error(`Collection is its own parent: ${row.collection_id}`);
    byId.set(row.collection_id, {
      collection_id: row.collection_id,
      name: row.name,
      parent_id: row.parent_id,
      children: [],
    });
  }

  // 2. 按 ID 排序连接，确保相同数据每次生成相同的根、子节点和叶子顺序。
  const nodes = [...byId.values()].sort(
    (a, b) => a.collection_id - b.collection_id,
  );
  const roots: CollectionNode[] = [];
  for (const node of nodes) {
    if (node.parent_id === null) roots.push(node);
    else {
      const parent = byId.get(node.parent_id);
      if (!parent)
        throw new Error(
          `Missing parent: collection_id=${node.collection_id}, parent_id=${node.parent_id}`,
        );
      parent.children.push(node);
    }
  }

  // 3. 深度优先遍历根节点，记录叶子的完整路径。使用显式栈避免递归调用栈限制。
  const leaves: CollectionLeaf[] = [];
  const visited = new Set<number>();
  const stack = roots
    .slice()
    .reverse()
    .map((node) => ({ node, ancestor_ids: [] as number[] }));
  while (stack.length) {
    const { node, ancestor_ids } = stack.pop()!;
    visited.add(node.collection_id);
    const path_ids = [...ancestor_ids, node.collection_id];
    if (node.children.length === 0) {
      leaves.push({
        collection_id: node.collection_id,
        name: node.name,
        parent_id: node.parent_id,
        ancestor_ids,
        path_ids,
      });
    }
    for (let i = node.children.length - 1; i >= 0; i--)
      stack.push({ node: node.children[i]!, ancestor_ids: path_ids });
  }

  // 4. 每个节点只有一个父级且父级都存在，无法从根到达的节点必然属于循环分支。
  if (visited.size !== byId.size) {
    const unreachable = nodes.filter(
      (node) => !visited.has(node.collection_id),
    );
    throw new Error(
      `Parent cycle detected; unreachable collection_ids: ${unreachable.map((node) => node.collection_id).join(",")}`,
    );
  }
  return { roots, leaves };
}
