import { routing } from "@/i18n/routing";
import { COLLECTION_PAGE_SIZE } from "@/lib/products";
import { supabase } from "@/lib/supabase/server";

const LOCALES = new Set<string>(routing.locales);
const ID_PATTERN = /^[1-9]\d*$/;
const SID_PATTERN = /^\d+$/;

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

  try {
    const sids = url.searchParams.get("sids");
    if (sids !== null) {
      const ids = [...new Set(sids.split(","))].filter((id) => SID_PATTERN.test(id));
      const { data, error } = ids.length === 0
        ? { data: [], error: null }
        : await supabase.from("products").select("sid, name, images").in("sid", ids);
      if (error) throw error;
      return Response.json({
        products: data ?? [],
        translations: await names(locale, (data ?? []).map((row) => row.sid)),
      });
    }

    const collection = url.searchParams.get("collection");
    const page = Number(url.searchParams.get("page") ?? "1");
    if (!collection || !ID_PATTERN.test(collection) || !Number.isInteger(page) || page < 1) {
      return Response.json({ error: "Invalid product request" }, { status: 400 });
    }

    const from = (page - 1) * COLLECTION_PAGE_SIZE;
    const { data, error, count } = await supabase
      .from("products")
      .select("sid, name, images", { count: "exact" })
      .contains("category_ids", [Number(collection)])
      .order("name")
      .order("sid")
      .range(from, from + COLLECTION_PAGE_SIZE - 1);
    if (error?.code === "PGRST103") {
      const { count: total, error: countError } = await supabase
        .from("products")
        .select("sid", { count: "exact", head: true })
        .contains("category_ids", [Number(collection)]);
      if (countError) throw countError;
      return Response.json({ products: [], translations: [], total: total ?? 0 });
    }
    if (error) throw error;

    const products = data ?? [];
    return Response.json({
      products,
      translations: await names(locale, products.map((row) => row.sid)),
      total: count ?? 0,
    });
  } catch {
    return Response.json({ error: "Couldn't load products" }, { status: 500 });
  }
}
