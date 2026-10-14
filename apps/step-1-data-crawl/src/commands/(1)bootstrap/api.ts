export const PAGE_SIZE = 48;
export const SORT = "packageid";

export type ListProduct = {
  sid: string;
  name: string | null;
  price: number | null;
};
export type ListPage = {
  products: ListProduct[];
  total: number;
  offset: number;
};
type Obj = Record<string, unknown>;

function object(value: unknown, label: string): Obj {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid object: ${label}`);
  }
  return value as Obj;
}
function array(value: unknown): unknown[] {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}
function integer(value: unknown, label: string): number {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    value === ""
  ) {
    throw new Error(`Invalid integer: ${label}`);
  }
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error(`Invalid integer: ${label}`);
  }
  return result;
}

export function categoryId(url: string): string {
  const parsed = new URL(url);
  const id = parsed.pathname.match(/^\/shop-online\/(\d+)(?:\/|$)/)?.[1];
  if (parsed.hostname !== "www.chemistwarehouse.co.nz" || !id) {
    throw new Error(`Invalid category URL: ${url}`);
  }
  return id;
}

export function pageUrl(id: string, offset: number): string {
  const url = new URL("https://www.chemistwarehouse.co.nz/searchapiv2/search");
  url.searchParams.set("identifier", "nz");
  url.searchParams.set(
    "fh_location",
    `//catalog01/en_AU/categories<{catalog01_chemnz}/categories<{chemnz${id}}`,
  );
  url.searchParams.set("fh_start_index", String(offset));
  url.searchParams.set("fh_sort", SORT);
  return url.href;
}

function parseProduct(value: unknown, readPrice: boolean): ListProduct {
  const item = object(value, "item");
  const attributes = new Map<string, Obj>();
  for (const value of array(item.attribute)) {
    const attr = object(value, "attribute");
    if (typeof attr.name !== "string" || attributes.has(attr.name)) {
      throw new Error("Missing or duplicate attribute name");
    }
    attributes.set(attr.name, attr);
  }
  function field(name: string): string | null {
    const attr = attributes.get(name);
    if (!attr || attr.isnull === true) return null;
    const values = array(attr.value)
      .map((entry) => {
        const value = object(entry, name).value;
        if (typeof value !== "string" && typeof value !== "number") {
          throw new Error(`Invalid value: ${name}`);
        }
        return String(value).trim();
      })
      .filter(Boolean);
    const unique = [...new Set(values)];
    if (unique.length > 1) throw new Error(`Multiple values: ${name}`);
    return unique[0] ?? null;
  }
  const sid = String(item.id ?? "").trim();
  if (!/^\d+$/.test(sid)) throw new Error("Invalid sid");
  const secondid = field("secondid");
  if (secondid !== null && secondid !== sid) {
    throw new Error(`ID conflict: ${sid} / ${secondid}`);
  }
  const rawUrl = field("producturl");
  if (!rawUrl) throw new Error(`Missing producturl: ${sid}`);
  const url = new URL(rawUrl);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "www.chemistwarehouse.co.nz" ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname.match(/^\/buy\/(\d+)(?:\/|$)/)?.[1] !== sid
  )
    throw new Error(`Invalid producturl for sid ${sid}`);
  const rawPrice = readPrice ? field("price_cw_nz") : null;
  const price = rawPrice === null ? null : Number(rawPrice);
  if (price !== null && (!Number.isFinite(price) || price < 0)) {
    throw new Error(`Invalid price: ${sid}`);
  }
  return {
    sid,
    name: field("name")?.replace(/\s+/g, " ") ?? null,
    price,
  };
}

export function parsePage(
  body: string,
  requestedOffset: number,
  requestedCategory: string,
  options: { readPrice?: boolean } = {},
): ListPage {
  let decoded: unknown = JSON.parse(body);
  if (typeof decoded === "string") decoded = JSON.parse(decoded);
  const root = object(decoded, "response");
  const info = object(root.info, "info");
  const query = typeof info.query === "string" ? info.query : "";
  const ids = [...query.matchAll(/chemnz(\d+)/g)].map((match) => match[1]);
  if (ids.at(-1) !== requestedCategory)
    throw new Error("Response category mismatch");
  const universes = object(root.universes, "universes");
  const universe = object(array(universes.universe)[0], "universe[0]");
  const section = object(universe["items-section"], "items-section");
  const results = object(section.results, "results");
  const total = integer(results["total-items"], "total-items");
  const offset = integer(results["start-index"], "start-index");
  if (offset !== requestedOffset) throw new Error("Response offset mismatch");
  const expected = Math.min(PAGE_SIZE, Math.max(0, total - offset));
  const viewSize = integer(results["view-size"], "view-size");
  // 不足一页时，接口可能返回实际条数；非末页仍必须返回完整页。
  if (viewSize !== PAGE_SIZE && viewSize !== expected) {
    throw new Error(
      `Unexpected page size: view-size=${viewSize}, expected=${expected}, page-size=${PAGE_SIZE}; refusing to skip items`,
    );
  }
  const ranking = object(results.ranking, "ranking");
  const fields = object(ranking["sort-fields"], "sort-fields");
  const sort = array(fields["sort-field"]);
  if (sort.length !== 1) throw new Error("Unexpected API sorting");
  const rule = object(sort[0], "sort-field");
  if (rule["sort-attribute"] !== SORT || rule["sort-direction"] !== "asc") {
    throw new Error("API did not apply packageid ascending sort");
  }
  const items = section.items == null ? {} : object(section.items, "items");
  const products = array(items.item).map((item) =>
    parseProduct(item, options.readPrice !== false),
  );
  if (products.length !== expected) {
    throw new Error(
      `Page ${offset}: expected ${expected}, received ${products.length}`,
    );
  }
  if (new Set(products.map((p) => p.sid)).size !== products.length) {
    throw new Error(`Duplicate sid within page ${offset}`);
  }
  return { products, total, offset };
}
