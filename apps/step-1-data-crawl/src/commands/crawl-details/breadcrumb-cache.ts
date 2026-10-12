import { readFile, rename, writeFile } from "node:fs/promises";

/** 与详情命令放在同一目录；只保存已确认写入分类表的原始面包屑 ID 链。 */
const cacheFile = new URL("./breadcrumb-paths.json", import.meta.url);
export const BREADCRUMB_SAVE_INTERVAL = 100;

/** 完整命中优先；已处理的更长链也覆盖其从根开始的父级前缀。 */
export function hasProcessedBreadcrumbPath(
  paths: Set<string>,
  key: string,
): boolean {
  if (paths.has(key)) {
    console.log(`已处理面包屑路径: ${key}`);
    return true;
  }
  // 必须附加逗号边界，避免 257,665,10 错误匹配 257,665,1020。
  const prefix = `${key},`;
  for (const path of paths) {
    if (path.startsWith(prefix)) {
      console.log(`已处理面包屑路径: ${key}`);
      return true;
    }
  }
  return false;
}

/** 启动时还原 Set；首次运行文件不存在时从空集合开始，损坏文件则明确报错。 */
export async function loadBreadcrumbPaths(): Promise<Set<string>> {
  try {
    const values: unknown = JSON.parse(await readFile(cacheFile, "utf8"));
    if (
      !Array.isArray(values) ||
      values.some(
        (value) =>
          typeof value !== "string" ||
          !/^[1-9]\d*(?:,[1-9]\d*)*$/.test(value) ||
          value.split(",").some((id) => !Number.isSafeInteger(Number(id))),
      )
    )
      throw new Error("Invalid breadcrumb cache: breadcrumb-paths.json");
    return new Set(values as string[]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Set();
    throw error;
  }
}

/** 先写临时文件再 rename；强制中断最多丢失最近一批缓存，重跑 upsert 可恢复。 */
export async function saveBreadcrumbPaths(paths: Set<string>): Promise<void> {
  const temporary = new URL("./breadcrumb-paths.json.tmp", import.meta.url);
  await writeFile(temporary, JSON.stringify([...paths], null, 2) + "\n");
  await rename(temporary, cacheFile);
}
