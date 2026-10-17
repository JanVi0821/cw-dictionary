import { routing } from "@/i18n/routing";
import { cacheRequest, withCache } from "@/lib/cache";
import { COLLECTION_PAGE_SIZE } from "@/lib/products";
import { captureError } from "@/lib/sentry";
import { supabase } from "@/lib/supabase/server";

const LOCALES = new Set<string>(routing.locales);
const ID_PATTERN = /^[1-9]\d*$/;
const SID_PATTERN = /^\d+$/;
const PRODUCT_CACHE_SECONDS = 60 * 60;

async function names(locale: string, sids: string[]) {
  if (sids.length === 0) return [];
  const { data, error } = await supabase
    .from("product_translations")
    .select("sid, name")
    .eq("locale", locale)
    .in("sid", sids);
  if (error) throw error;
  return data ?? [];
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const locale = url.searchParams.get("locale") ?? routing.defaultLocale;
  if (!LOCALES.has(locale)) {
    return Response.json({ error: "Invalid product request" }, { status: 400 });
  }

  const sids = url.searchParams.get("sids");
  if (sids !== null) {
    const ids = [...new Set(sids.split(","))]
      .filter((id) => SID_PATTERN.test(id))
      .sort((left, right) => Number(left) - Number(right));
    try {
      return await withCache(cacheRequest(request, { locale, sids: ids.join(",") }), () =>
        loadProductsBySids(locale, ids),
      );
    } catch (error) {
      void captureError(error, { tags: { area: "products" } });
      return Response.json({ error: "Couldn't load products" }, { status: 500 });
    }
  }

  const collection = url.searchParams.get("collection");
  const page = Number(url.searchParams.get("page") ?? "1");
  if (!collection || !ID_PATTERN.test(collection) || !Number.isInteger(page) || page < 1) {
    return Response.json({ error: "Invalid product request" }, { status: 400 });
  }

  try {
    return await withCache(
      cacheRequest(request, { locale, collection, page: String(page) }),
      () => loadCollectionProducts(locale, Number(collection), page),
    );
  } catch (error) {
    void captureError(error, { tags: { area: "products" } });
    return Response.json({ error: "Couldn't load products" }, { status: 500 });
  }
}

function cachedJson(body: unknown) {
  return Response.json(body, {
    headers: { "Cache-Control": `public, s-maxage=${PRODUCT_CACHE_SECONDS}` },
  });
}

async function loadProductsBySids(locale: string, ids: string[]) {
  const { data, error } =
    ids.length === 0
      ? { data: [], error: null }
      : await supabase.from("products").select("sid, name, images").in("sid", ids);
  if (error) throw error;
  return cachedJson({
    products: data ?? [],
    translations: await names(locale, (data ?? []).map((row) => row.sid)),
  });
}

async function loadCollectionProducts(locale: string, collection: number, page: number) {
  const from = (page - 1) * COLLECTION_PAGE_SIZE;
  const { data, error, count } = await supabase
    .from("products")
    .select("sid, name, images", { count: "exact" })
    .contains("category_ids", [collection])
    .order("name")
    .order("sid")
    .range(from, from + COLLECTION_PAGE_SIZE - 1);
  if (error?.code === "PGRST103") {
    const { count: total, error: countError } = await supabase
      .from("products")
      .select("sid", { count: "exact", head: true })
      .contains("category_ids", [collection]);
    if (countError) throw countError;
    return cachedJson({ products: [], translations: [], total: total ?? 0 });
  }
  if (error) throw error;

  const products = data ?? [];
  return cachedJson({
    products,
    translations: await names(locale, products.map((row) => row.sid)),
    total: count ?? 0,
  });
}
