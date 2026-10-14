import {
  LEAVES_FILE,
  OUTPUT_DIRECTORY,
} from "../export-collection-tree/config.ts";

export const DATABASE = "cw_data";
export const PRODUCT_COLLECTION = "data_raw";
export const DEFAULT_MONGODB_URI = "mongodb://127.0.0.1:27017";
export const LEAVES_PATH = new URL(LEAVES_FILE, OUTPUT_DIRECTORY);
export const STATE_PATH = new URL(
  "../../../storage/collection-completion-state.json",
  import.meta.url,
);
/** 每次最多抓取的总页数，跨所有叶子累计。 */
export const MAX_PAGES = Infinity;
export const PAGE_INTERVAL_MS = 500;
export const REQUEST_TIMEOUT_MS = 30_000;
export const MAX_ATTEMPTS = 3;
export const RETRY_INTERVAL_MS = 1000;
