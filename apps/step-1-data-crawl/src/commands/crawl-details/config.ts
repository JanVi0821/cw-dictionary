/** 本次最多尝试多少个商品；失败也计数，避免异常时超出计划数量。 */
export const LIMIT = 10000;

/** 单请求串行采集；每个商品处理后等待，避免密集请求官网。 */
export const PRODUCT_INTERVAL_MS = 500;

/** 网络请求（含重定向和读取正文）的超时，以及单商品最大尝试次数。 */
export const REQUEST_TIMEOUT_MS = 30_000;
export const MAX_ATTEMPTS = 3;
