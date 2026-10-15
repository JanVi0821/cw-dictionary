import type { Filter } from "mongodb";
import type { ProductDocument } from "./types.ts";

/** 数据库名称显式指定；MongoDB URI 负责连接，集合名称不从 URI 路径解析。 */
export const DATABASE = "cw_data";
export const SOURCE_COLLECTION = "data_raw";
export const TARGET_COLLECTION = "data_raw_translated";
export const COLLECTION_COLLECTION = "collection_raw";
/** 分类是背景事实；使用平铺标签，避免将继承的大分类误当成 breadcrumb 父子链。 */
export const CATEGORY_CONTEXT_PREFIX =
  "This text describes a product sold by Chemist Warehouse New Zealand. Its product categories are: ";
/** 原始英文属性用于补充背景；缺失或空属性不加入 context。 */
export const CONTEXT_PRODUCT_FIELDS = [
  { field: "name", label: "Product name" },
  { field: "supplier", label: "Supplier" },
  { field: "additional_info", label: "Additional information" },
  { field: "feature_attributes", label: "Product attributes" },
  { field: "key_features", label: "Key features" },
];
/** 仅限制补充背景的长度，不截断实际待翻译字段。 */
export const CONTEXT_MAX_CHARS = 6000;
export const SOURCE_LANG = "EN";
/** DeepL 术语规则；使用说明和警告保持忠实，品牌专名保留。 */
export const CUSTOM_INSTRUCTIONS = [
  "Use standard Simplified Chinese terminology for nutritional, pharmaceutical and cosmetic ingredients, including ingredient names in product titles and quoted product names.",
  "Keep manufacturer and brand names unchanged. Distinguish these proper names from generic ingredient names using the product context.",
  "Preserve dosages, concentrations, quantities and measurement units. Translate directions, warnings and claims faithfully without adding or strengthening claims.",
];
export const LANG = "zh";
export const PROVIDER = "deepl";
/** 翻译策略版本，用于记录元数据和区分缓存文件；不触发默认续跑重译。 */
export const VERSION = 2;

/** 所有 worker 合计最多完成的商品数；跳过已完成商品不计数。Infinity 表示全部。 */
export const LIMIT = 10000;
export const BATCH_SIZE = 100;
/** API 网络任务使用异步 worker 并发；每个商品内的字段仍按顺序翻译。 */
export const CONCURRENCY = 2;
export const TASK_COLLECTION = "translation_pending";
export const FILTER_TASK_COLLECTION = "translation_filter_pending";
export const PROGRESS_COLLECTION = "translation_progress";
/** Filter 模式筛选原表；空对象表示所有已完成详情的商品。 */
export const TRANSLATION_FILTER: Filter<ProductDocument> = {
  $or: [
    {
      fetched_at: {
        $gt: "2026-10-14T00:00:00.000Z",
      },
    },
  ],
};
/** 原表 translation_flags 下的完成标记；更换常量值即开启新一轮 filter 重译。 */
export const FILTER_COMPLETION_FLAG = "products_v1";
export const REDIS_NAMESPACE = "cw:translation";
export const REDIS_LOCK_TTL_MS = 60_000;
export const CACHE_LOCK_WAIT_MS = 300_000;
export const GLOBAL_CACHE_MAX_CHARS = 100;
export const API_REQUEST_INTERVAL_MS = 100;
export const REQUEST_TIMEOUT_MS = 30_000;
export const RETRY_DELAYS_MS = [4000, 8000, 8000, 16000];

export type FieldRule = {
  path: string;
  mode: "text" | "html" | "attributes";
};

/** * 遍历数组或对象的每一项；attributes 翻译 {label,value}[]，保留条目顺序及 value 类型。 */
export const TRANSLATION_FIELDS: readonly FieldRule[] = [
  { path: "name", mode: "text" },
  { path: "additional_info.*", mode: "text" },
  { path: "info.*.title", mode: "text" },
  { path: "info.*.html", mode: "html" },
  { path: "feature_attributes", mode: "attributes" },
  { path: "key_features.*", mode: "text" },
];

/** 历史残留的通用处方声明不翻译，也不复制到目标；源集合保持原样。 */
export const EXCLUDED_INFO_KEYS = [
  "prescription_information",
  "prescription_note",
];
