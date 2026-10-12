import { load } from "cheerio";
import {
  EXCLUDED_NAME_KEYWORDS,
  PAGE_SIZE,
  url as configuredUrl,
} from "./config.ts";

export type PrescriptionListProduct = {
  sid: string;
  name: string;
  price: number | null;
  images: string[];
};
export type PrescriptionListPage = {
  page: number;
  total: number;
  lastPage: number;
  products: PrescriptionListProduct[];
  rawSids: string[];
};
const text = (value: string) => value.replace(/\s+/g, " ").trim();

/** 从共享配置构造分页 URL，保留既有参数，只替换 page。 */
export function pageUrl(page: number): string {
  if (!Number.isSafeInteger(page) || page < 1)
    throw new Error("Invalid page number");
  const parsed = new URL(configuredUrl);
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "www.chemistwarehouse.co.nz" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    !/^\/v1\/shop-online\/\d+\/[^/]+\/?$/i.test(parsed.pathname)
  ) {
    throw new Error("Invalid prescription list URL configuration");
  }
  parsed.searchParams.set("page", String(page));
  return parsed.href;
}

export function categoryId(): string {
  return new URL(pageUrl(1)).pathname.match(/\/shop-online\/(\d+)\//i)![1]!;
}

/** 限定列表主体解析商品，不能从导航、广告或 Important Information 图标收集图片。 */
export function parsePage(
  html: string,
  responseUrl: string,
  requestedPage: number,
): PrescriptionListPage {
  const actual = new URL(responseUrl);
  const expected = new URL(pageUrl(requestedPage));
  if (
    actual.origin !== expected.origin ||
    actual.pathname.toLowerCase() !== expected.pathname.toLowerCase() ||
    Number(actual.searchParams.get("page") ?? "1") !== requestedPage
  ) {
    throw new Error("Prescription response URL mismatch");
  }
  const $ = load(html);
  $("script,style,template,noscript").remove();
  const main = $("#Left-Content");
  const list = main.find(".product-list-container");
  const pager = main.find(".Pager").first();
  if (main.length !== 1 || list.length !== 1 || !pager.length) {
    throw new Error("Unexpected prescription list structure");
  }

  // 1. 从服务端分页控件核对页号、总数和最后一页，防止参数无效时反复抓首屏。
  const current = Number(text(pager.find(".pager-results font b").text()));
  if (current !== requestedPage)
    throw new Error("Prescription response page mismatch");
  const count = text(pager.find(".pager-count > b").text()).match(
    /^([\d,]+)\s+Results?$/i,
  );
  if (!count) throw new Error("Missing prescription total count");
  const total = Number(count[1]!.replace(/,/g, ""));
  if (!Number.isSafeInteger(total) || total < 0)
    throw new Error("Invalid prescription total");
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (requestedPage > lastPage)
    throw new Error("Requested page exceeds last page");
  const lastHref = pager.find("a.last-page[href]").attr("href");
  if (
    lastHref &&
    Number(new URL(lastHref, responseUrl).searchParams.get("page")) !== lastPage
  ) {
    throw new Error("Prescription last-page mismatch; check PAGE_SIZE");
  }
  const nextHref = pager.find("a.next-page[href]").attr("href");
  if (
    requestedPage < lastPage &&
    (!nextHref ||
      Number(new URL(nextHref, responseUrl).searchParams.get("page")) !==
        requestedPage + 1)
  ) {
    throw new Error("Prescription next-page mismatch");
  }
  // 末页 Next 实际指向自身；用 lastPage 控制结束，不跟随这个链接无限循环。

  // 2. 每张商品卡片提取 sid、完整 title、当前价格和实际商品图 src。
  const products: PrescriptionListProduct[] = [];
  const rawSids: string[] = [];
  list.find("a.product-container[href]").each((_, node) => {
    const card = $(node);
    const productUrl = new URL(card.attr("href")!, responseUrl);
    const sid = productUrl.pathname.match(/^\/buy\/(\d+)(?:\/|$)/i)?.[1];
    if (
      productUrl.protocol !== "https:" ||
      productUrl.hostname !== expected.hostname ||
      productUrl.username ||
      productUrl.password ||
      productUrl.port ||
      !sid
    ) {
      throw new Error("Invalid prescription product URL");
    }
    const analyticsSid = card.attr("data-analytics-sku");
    if (analyticsSid && analyticsSid !== sid)
      throw new Error(`Product ID mismatch: ${sid}`);
    // 卡片 .product-name 可能被省略号截断，优先使用链接 title，其次图片 alt。
    const name =
      text(card.attr("title") ?? "") ||
      text(card.find(".product-image img[alt]").first().attr("alt") ?? "") ||
      text(card.find(".product-name").text());
    if (!name || /(?:\.\.\.|…)\s*$/.test(name))
      throw new Error(`Missing complete product name: ${sid}`);
    // 广告占分页条数，只留原始 ID 核对进度；不提取价格、图片或写商品表。
    rawSids.push(sid);
    if (
      EXCLUDED_NAME_KEYWORDS.some((keyword) =>
        name.toLowerCase().includes(keyword.toLowerCase()),
      )
    )
      return;
    const priceNodes = card.find(".prices .Price");
    if (priceNodes.length > 1) throw new Error(`Ambiguous list price: ${sid}`);
    const rawPrice = text(priceNodes.text());
    // Free 表示免费商品，按 0 入库；匹配时忽略大小写。
    const isFree = /^free$/i.test(rawPrice);
    if (
      rawPrice &&
      !isFree &&
      !/^\$\s*(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(rawPrice)
    ) {
      throw new Error(`Invalid list price: ${sid}: ${rawPrice}`);
    }
    const price = isFree
      ? 0
      : rawPrice
        ? Number(rawPrice.replace(/[$,\s]/g, ""))
        : null;
    if (price !== null && (!Number.isFinite(price) || price < 0))
      throw new Error(`Invalid list price: ${sid}`);
    const images: string[] = [];
    card.find(".product-image img[src]").each((_, image) => {
      const src = $(image).attr("src")?.trim();
      if (!src || /noimage/i.test(src) || src.toLowerCase() === "erase") return;
      const address = new URL(src, responseUrl);
      if (/^https?:$/.test(address.protocol)) images.push(address.href);
    });
    // 只保存实际出现的图片地址，不从 _150 文件名猜大图，不解析注释或 onerror。
    products.push({ sid, name, price, images: [...new Set(images)] });
  });

  // 3. 整页验证通过后才允许写库；空页、少项和页内重复不能静默当作完成。
  const expectedCount = Math.min(
    PAGE_SIZE,
    Math.max(0, total - (requestedPage - 1) * PAGE_SIZE),
  );
  if (rawSids.length !== expectedCount)
    throw new Error(
      `Page ${requestedPage}: expected ${expectedCount}, got ${rawSids.length}`,
    );
  if (new Set(rawSids).size !== rawSids.length) {
    throw new Error(`Duplicate products on prescription page ${requestedPage}`);
  }
  return { page: requestedPage, total, lastPage, products, rawSids };
}
