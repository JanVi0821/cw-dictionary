import type { DeeplOptions } from "../../deepl.ts";

export const DATABASE = "cw_data";
export const SOURCE_COLLECTION = "collection_raw";
export const TARGET_COLLECTION = "collection_raw_translated";
export const LIMIT = Infinity;
export const VERSION = 1;
export const TRANSLATION_FIELDS = ["name"] as const;
export const CHILD_EXAMPLE_LIMIT = 8;

/** 与商品命令共享 key 文件，因此必须竞争同一运行锁；不使用任何翻译缓存。 */
export const RUN_LOCK_KEY = "cw:translation:run:cw_data:data_raw_translated";

export const CONTEXT_PREFIX =
  "This is an English navigation category label in the Chemist Warehouse New Zealand online pharmacy catalogue. The catalogue covers medicines, vitamins and supplements, skincare, beauty, personal care and household products. The hierarchy below is background for disambiguating the label, not text to translate.";

/** 分类专用指令：只翻译标签本身，不把路径或解释追加进结果。 */
export const DEEPL_OPTIONS: DeeplOptions = {
  sourceLang: "EN",
  targetLang: "zh",
  customInstructions: [
    "Translate the category label into concise, natural Simplified Chinese suitable for an e-commerce navigation menu. Return only the translated label, without explanations, quotation marks or added parent category names.",
    "Use the parent hierarchy and child category examples to resolve ambiguous words. Use standard Chinese terminology for medicines, nutritional ingredients, skincare, cosmetics and personal care; do not expand a category into a product description or add claims.",
    "Keep brand names and manufacturer names unchanged, including within mixed brand-and-category labels. Translate generic product types and ingredient names rather than treating them as brands. Preserve numbers, units and meaningful abbreviations.",
  ],
  requestIntervalMs: 100,
  requestTimeoutMs: 30_000,
  retryDelaysMs: [4000, 8000, 8000, 16000],
};
