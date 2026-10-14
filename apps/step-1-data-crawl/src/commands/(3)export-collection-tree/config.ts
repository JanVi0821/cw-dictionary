export const DATABASE = "cw_data";
export const COLLECTION = "collection_raw";
export const DEFAULT_MONGODB_URI = "mongodb://127.0.0.1:27017";
export const CONNECTION_TIMEOUT_MS = 5000;

/** 路径固定在本应用内，不受从仓库根目录或应用目录执行的影响。 */
export const OUTPUT_DIRECTORY = new URL(
  "../../../storage/collection-tree/",
  import.meta.url,
);
export const TREE_FILE = "tree.json";
export const LEAVES_FILE = "leaves.json";
