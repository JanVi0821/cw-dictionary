export const url =
  "https://www.chemistwarehouse.co.nz/v1/shop-online/261/prescriptions?page=";

/** SSR 列表使用 page 从 1 开始翻页，每页 24 条，不能使用 API 的 offset 规则。 */
export const PAGE_SIZE = 24;
/** 每次最多处理的页数，可改为正整数；Infinity 表示完成当前分类全部页。 */
export const MAX_PAGES = Infinity;
export const PAGE_INTERVAL_MS = 500;
export const REQUEST_TIMEOUT_MS = 30_000;
export const MAX_ATTEMPTS = 3;
/** 处方药类别混有广告，命中名称关键词时跳过该商品，大小写不敏感。 */
export const EXCLUDED_NAME_KEYWORDS = ["Blackmores"];
