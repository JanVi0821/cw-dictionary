import { load, type CheerioAPI } from "cheerio";

type Selection = ReturnType<CheerioAPI>;
type DomNode = Selection[0];
export type CollectionRecord = {
  collection_id: number;
  name: string;
  parent_id: number | null;
};
export type InfoBlock = {
  title: string | null;
  html: string;
  source_hidden: boolean | null;
};
export type ProductDetail = {
  sid: string;
  name: string;
  category_ids: number[];
  images: string[];
  supplier: string | null;
  product_id: string | null;
  additional_info: string[];
  info: Record<string, InfoBlock>;
  feature_attributes: { label: string; value: string | string[] }[];
  key_features: string[];
  price: number | null;
  related_sids: string[];
  fetched_at: string;
};

const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
const unique = <T>(values: T[]) => [...new Set(values)];

/** 分类以数字存储；拒绝空值、负数和不安全整数，避免静默产生错误关联。 */
export function collectionId(value: unknown): number {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error("Invalid collection ID type");
  }
  if (!/^\d+$/.test(String(value)))
    throw new Error(`Invalid collection ID: ${value}`);
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new Error(`Invalid collection ID: ${value}`);
  return id;
}

/** URL 只作为运行期的抓取及校验输入，不写入商品文档。 */
export function productSid(url: string): string {
  const parsed = new URL(url);
  const sid = parsed.pathname.match(/^\/buy\/(\d+)(?:\/|$)/i)?.[1];
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "www.chemistwarehouse.co.nz" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    !sid
  ) {
    throw new Error(`Invalid product URL: ${url}`);
  }
  return sid;
}

/** 有效内容不能仅靠标题或布局撑起：忽略空白、脚本、注释和 NoImage。 */
function meaningful($: CheerioAPI, nodes: Selection): boolean {
  const copy = nodes.clone();
  copy.find("script, style, template, noscript").remove();
  if (normalize(copy.text())) return true;
  return copy
    .find(
      "img[src], video[src], audio[src], source[src], iframe[src], object[data]",
    )
    .toArray()
    .some((node) => {
      const address = $(node).attr("src") ?? $(node).attr("data") ?? "";
      return address.trim() !== "" && !/noimage/i.test(address);
    });
}

/** 只检查原 HTML 明确声明的隐藏状态，不猜测外部 CSS 的计算结果。 */
function hidden($: CheerioAPI, node: DomNode, boundary?: DomNode): boolean {
  for (let current: DomNode | null = node; current; current = current.parent) {
    const element = $(current);
    const style = element.attr("style") ?? "";
    if (
      element.hasClass("hidden") ||
      element.attr("hidden") !== undefined ||
      /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!important\s*)?(?:;|$)/i.test(
        style,
      )
    ) {
      return true;
    }
    if (current === boundary) break;
  }
  return false;
}

/** 从 DOM 生成逻辑行；p / li / br 等保留边界，内联节点仍属于同一行。 */
type LogicalLine = { text: string; heading: boolean };
function logicalLines($: CheerioAPI, content: Selection): LogicalLine[] {
  let text = "";
  // 显式标题标签及独立加粗段落也构成标题边界，不要求全部使用大写。
  const headings = new Set<string>();
  content.find("h1,h2,h3,h4,h5,h6,p,div").each((_, node) => {
    const element = $(node);
    const label = normalize(element.text());
    if (
      /^h[1-6]$/.test(node.name) ||
      (element.children().length === 1 &&
        element.children().is("strong,b") &&
        normalize(element.children().text()) === label)
    )
      headings.add(label);
  });
  function visit(node: DomNode): void {
    if (node.type === "text") {
      // 源码排版换行不是正文换行，实际段落边界由元素提供。
      text += node.data.replace(/\s+/g, " ");
      return;
    }
    if (node.type !== "tag") return;
    if (["script", "style", "template", "noscript"].includes(node.name)) return;
    if (node.name === "br") {
      text += "\n";
      return;
    }
    const block = /^(p|div|li|ul|ol|h[1-6]|tr|section|blockquote)$/.test(
      node.name,
    );
    if (block) text += "\n";
    node.children.forEach(visit);
    if (block) text += "\n";
  }
  content.each((_, node) => {
    $(node).contents().toArray().forEach(visit);
    text += "\n";
  });
  return text
    .split("\n")
    .map(normalize)
    .filter(Boolean)
    .map((line) => ({ text: line, heading: headings.has(line) }));
}

/** 特征提取只读正文；绝不从 info 的富文本中删除 KV 或 bullet。 */
function extractFeatures(lines: LogicalLine[]) {
  const attributes: Record<string, string | string[]> = Object.create(null);
  const bullets: string[] = [];
  let inFeatures = false;
  let bullet: string | null = null;
  const flush = () => {
    if (bullet) bullets.push(bullet);
    bullet = null;
  };
  for (const entry of lines) {
    const line = entry.text;
    if (/^KEY FEATURES\s*[:：]?$/i.test(line)) {
      flush();
      inFeatures = true;
      continue;
    }
    // 完整逻辑行才可作为 KV；排除 bullet、URL 和含句末标点的叙述标签。
    const pair =
      !line.startsWith("•") && !/^https?:\/\//i.test(line)
        ? line.match(/^([^:：.!?]+)[:：]\s*(.+)$/)
        : null;
    if (pair) {
      const key = normalize(pair[1]!);
      const value = normalize(pair[2]!);
      if (key && value) {
        const previous = attributes[key];
        const values = unique([
          ...(Array.isArray(previous) ? previous : previous ? [previous] : []),
          value,
        ]);
        attributes[key] = values.length === 1 ? values[0]! : values;
      }
    }
    if (!inFeatures) continue;
    if (line.startsWith("•")) {
      flush();
      bullet = normalize(line.slice(1));
      continue;
    }
    // 新独立标题或 KV 结束 KEY FEATURES；普通续行并入当前 bullet。
    const heading =
      entry.heading ||
      (/[A-Z]/.test(line) && line === line.toUpperCase()) ||
      /[:：]$/.test(line);
    if (heading || pair) {
      flush();
      inFeatures = false;
      continue;
    }
    if (bullet) bullet += ` ${line}`;
  }
  flush();
  return {
    feature_attributes: Object.entries(attributes).map(([label, value]) => ({
      label,
      value,
    })),
    key_features: unique(bullets),
  };
}

/** 解析一份 SSR 商品 HTML，返回商品字段及需要写入分类表的面包屑名称。 */
export function parseDetail(
  html: string,
  finalUrl: string,
  expectedSid: string,
): {
  isPrescription: boolean;
  product: ProductDetail;
  collections: CollectionRecord[];
} {
  // 1. 校验最终 URL，防止缺货跳首页、错误页或请求被重定向到其他商品。
  const sid = productSid(finalUrl);
  if (sid !== expectedSid)
    throw new Error(`Unexpected sid: ${sid}, expected ${expectedSid}`);
  const $ = load(html);
  const sku = normalize($("input#skuId").attr("value") ?? "");
  if (sku && sku !== sid) throw new Error(`skuId conflict: ${sid} / ${sku}`);

  // 2. 去除注释及无关代码。不会解析注释中的 miscellaneous / druginteractions 模板。
  $.root()
    .find("*")
    .addBack()
    .contents()
    .filter((_, node) => node.type === "comment")
    .remove();
  $("script, style, template, noscript").remove();
  // 处方药使用独立的新布局；隐藏旧模板的名称可能是 div，不能按普通商品 h1 校验。
  const prescription = $(".prescription-pdp");
  const isPrescription = prescription.length > 0;
  if (prescription.length > 1)
    throw new Error(`Ambiguous prescription layout: ${sid}`);
  const names = isPrescription
    ? prescription.find("h1.prescription-pdp-details__name")
    : $(".product-name h1");
  const name = normalize(names.first().text());
  if (names.length !== 1 || !name)
    throw new Error(`Missing or ambiguous product name: ${sid}`);
  const legacyMain = isPrescription
    ? $(".product_details")
    : names.closest(".product_details");
  const main = isPrescription ? prescription : legacyMain;
  const containers = $(".product-info-container");
  // 处方药允许没有旧模板详情容器，但普通商品仍保持原来的严格结构校验。
  if (
    main.length !== 1 ||
    legacyMain.length > 1 ||
    (isPrescription ? containers.length > 1 : containers.length !== 1)
  ) {
    throw new Error(`Unexpected product page structure: ${sid}`);
  }

  // 3. 只从面包屑读取分类 ID 和 Name，不混入全站导航、推荐区分类。
  const collections = new Map<number, CollectionRecord>();
  let parentId: number | null = null;
  $(".breadcrumbs a[href]").each((_, node) => {
    const link = new URL($(node).attr("href")!, finalUrl);
    const id = link.pathname.match(/^\/shop-online\/(\d+)(?:\/|$)/i)?.[1];
    if (link.hostname !== "www.chemistwarehouse.co.nz" || !id) return;
    const collection_id = collectionId(id);
    const categoryName = normalize($(node).text());
    if (!categoryName) throw new Error(`Empty category name: ${id}`);
    const previous = collections.get(collection_id);
    if (previous && previous.name !== categoryName)
      throw new Error(`Conflicting category names: ${id}`);
    // 面包屑是父子链；首个分类为根，其余分类指向左侧相邻分类。
    // 同一 ID 重复出现时不生成自引用或覆盖首次确认的父级。
    if (previous) return;
    collections.set(collection_id, {
      collection_id,
      name: categoryName,
      parent_id: parentId,
    });
    parentId = collection_id;
  });
  if (!collections.size)
    throw new Error(`Missing breadcrumb categories: ${sid}`);

  // 4. 大图限定在主商品画廊，只使用实际 href，不从缩略图推测文件名。
  const images: string[] = [];
  (isPrescription
    ? $([])
    : $("#product_details_left, .image-preview-container")
  )
    .find("a.image_enlarger[href]")
    .each((_, node) => {
      const href = $(node).attr("href")?.trim();
      if (!href || /noimage/i.test(href)) return;
      const url = new URL(href, finalUrl);
      if (/^https?:$/.test(url.protocol)) images.push(url.href);
    });

  // 5. Product ID 与 sid 分开，按标签识别；其余非空信息保留原始标签。
  let productId: string | null = null;
  const additional: string[] = [];
  // 处方药可见元数据中的 Active Ingredient Name 同样作为额外信息保留。
  // 旧模板 Product ID 仍参与核对；重复的同一编号不重复记录。
  const metadata = legacyMain
    .find(".product-id.product-information")
    .add(
      isPrescription
        ? prescription.find(".prescription-pdp-details__additional-info > span")
        : $([]),
    );
  metadata.each((_, node) => {
    const value = normalize($(node).text());
    const match = value.match(/^Product\s+ID\s*[:：]\s*(.*)$/i);
    if (match) {
      const id = normalize(match[1]!);
      if (productId && id && productId !== id)
        throw new Error(`Conflicting Product IDs: ${sid}`);
      if (id) productId = id;
    } else if (value) additional.push(value);
  });
  const supplier =
    normalize(
      legacyMain.find(".manufacturer-name.product-information").first().text(),
    )
      .replace(/^Supplier\s*[:：]\s*/i, "")
      .trim() || null;

  // 6. 按 section 保存完整富文本；有效内容判断只针对 details，不靠 hidden 过滤。
  const container = containers.first();
  const info: Record<string, InfoBlock> = Object.create(null);
  const generalLines: LogicalLine[] = [];
  container.find("section").each((index, node) => {
    // 嵌套 section 归属外层，防止同一正文在多个 info 字段中重复存储。
    if ($(node).parentsUntil(container).filter("section").length) return;
    const section = $(node);
    const details = section.find('.details[itemprop="description"]');
    if (!details.length || !meaningful($, details)) return;
    const semantic = (section.attr("class") ?? "")
      .split(/\s+/)
      .find(
        (value) => value && !["product-info-section", "hidden"].includes(value),
      );
    const semanticKey =
      semantic && /^[a-z][a-z0-9_-]*$/i.test(semantic)
        ? semantic.replace(/-/g, "_")
        : `section_${index + 1}`;
    // unsectioned 留给兜底正文，避免来源 class 恰好同名时被覆盖。
    const key =
      semanticKey === "unsectioned" ? `section_${index + 1}` : semanticKey;
    const block: InfoBlock = {
      title:
        normalize(section.find("h1,h2,h3,h4,h5,h6").first().text()) || null,
      html: $.html(node),
      source_hidden: hidden($, node, container[0]),
    };
    const previous = info[key];
    if (previous) {
      previous.html += `\n${block.html}`;
      previous.title ??= block.title;
      previous.source_hidden =
        previous.source_hidden === true && block.source_hidden === true;
    } else info[key] = block;
    if (key === "general_info") generalLines.push(...logicalLines($, details));
  });

  // 7. 在克隆 DOM 上移除所有 section，再保留有效的非 section 正文及必要包装。
  // 原始 DOM 不改动，因此已保存的 info 与特征提取不受影响。
  const fallback = container.clone();
  fallback.find("section").remove();
  if (meaningful($, fallback)) {
    info.unsectioned = {
      title: null,
      html: fallback.html() ?? "",
      source_hidden: null,
    };
  }

  // 8. 处方药保存 Use 及其他商品专属 section；跳过通用处方声明和配送说明。
  // Use 嵌套于处方声明包装中，仍独立提取其标题、class 和正文。
  if (isPrescription) {
    const appendBlock = (key: string, block: InfoBlock) => {
      const previous = info[key];
      if (!previous) {
        info[key] = block;
        return;
      }
      previous.html += `\n${block.html}`;
      previous.title ??= block.title;
      previous.source_hidden =
        previous.source_hidden === true && block.source_hidden === true;
    };
    const sections = prescription.find(".prescription-pdp-section");
    if (!sections.length)
      throw new Error(`Missing prescription information: ${sid}`);
    sections.each((index, node) => {
      const section = $(node);
      const content = section.find(".prescription-pdp-section__content");
      if (!content.length)
        throw new Error(`Missing prescription content: ${sid}`);
      section.find(".prescription-pdp-section__usage").each((_, usageNode) => {
        const usage = $(usageNode);
        const body = usage.clone();
        body.find("h1,h2,h3,h4,h5,h6").remove();
        if (!meaningful($, body)) return;
        appendBlock("use", {
          title:
            normalize(
              usage
                .find(".prescription-pdp-section__subheading")
                .first()
                .text(),
            ) || null,
          html: $.html(usageNode),
          source_hidden: hidden($, usageNode, prescription[0]),
        });
        // 旧隐藏模板的 description 若与可见 Use 正文完全相同，正文已完整保存在 use。
        // 只对同文本副本去重，不因 hidden 状态删除任何不同的有效内容。
        const legacyDescription = container.find(
          "section.description .details[itemprop=description]",
        );
        if (
          legacyDescription.length === 1 &&
          normalize(legacyDescription.text()) === normalize(body.text())
        ) {
          delete info.description;
        }
      });
      const title =
        normalize(
          section.find(".prescription-pdp-section__heading").first().text(),
        ) || null;
      if (title && /^Prescription Information$/i.test(title)) return;
      const standalone = section.clone();
      standalone.find(".prescription-pdp-section__usage").remove();
      if (!meaningful($, standalone.find(".prescription-pdp-section__content")))
        return;
      appendBlock(`prescription_section_${index + 1}`, {
        title,
        html: $.html(standalone),
        source_hidden: hidden($, node, prescription[0]),
      });
    });
  }

  // 9. 从 General Information 的逻辑行独立提取属性，不从 Use 推断特征。
  const features = extractFeatures(generalLines);

  // 10. 普通商品读取 offers；处方药读取可见专用价格，不误取隐藏旧模板或替代药价格。
  const offers = main.find('[itemprop="offers"]');
  offers.find('[itemprop="priceCurrency"]').each((_, node) => {
    const currency = normalize($(node).attr("content") ?? $(node).text());
    if (currency && currency !== "NZD")
      throw new Error(`Unexpected currency: ${currency}`);
  });
  const prices: number[] = [];
  let priceNodes = offers.find('[itemprop="price"] .product__price');
  if (isPrescription) {
    const pricing = prescription.find(".prescription-pdp-details__price");
    if (pricing.length > 1)
      throw new Error(`Ambiguous prescription pricing: ${sid}`);
    pricing.each((_, node) => {
      const currency = normalize($(node).children("span").eq(1).text());
      if (currency && currency !== "NZD")
        throw new Error(`Unexpected currency: ${currency}`);
    });
    priceNodes = pricing.children("span").first();
  }
  priceNodes.each((_, node) => {
    if (hidden($, node)) return;
    const raw = normalize($(node).text());
    if (!raw) return;
    if (!/^\$?\s*(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(raw)) {
      throw new Error(`Invalid price for ${sid}: ${raw}`);
    }
    const price = Number(raw.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(price) || price < 0)
      throw new Error(`Invalid price: ${sid}`);
    prices.push(price);
  });
  if (prices.length > 1) throw new Error(`Ambiguous product prices: ${sid}`);

  // 11. 普通关联商品取推荐区；处方药同时取 Alternative Product(s) 标题链接。
  // 只保存关联 sid，不保存替代商品的名称、价格或任何用药替代结论。
  const related: string[] = [];
  const relatedLinks = $(".product-list-container a[href]").add(
    isPrescription
      ? $(".alternative-drug .alternative-drug-item__title a[href]")
      : $([]),
  );
  relatedLinks.each((_, node) => {
    const url = new URL($(node).attr("href")!, finalUrl);
    const relatedSid = url.pathname.match(/^\/buy\/(\d+)(?:\/|$)/i)?.[1];
    if (
      url.hostname === "www.chemistwarehouse.co.nz" &&
      relatedSid &&
      relatedSid !== sid
    )
      related.push(relatedSid);
  });

  // 12. 抓取时间代表本次成功解析；只有分类表写入成功后，调用方才保存这份商品。
  return {
    isPrescription,
    collections: [...collections.values()],
    product: {
      sid,
      name,
      category_ids: [...collections.keys()],
      images: unique(images),
      supplier,
      product_id: productId,
      additional_info: unique(additional),
      info,
      ...features,
      price: prices[0] ?? null,
      related_sids: unique(related),
      fetched_at: new Date().toISOString(),
    },
  };
}
