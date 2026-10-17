import { routing } from "@/i18n/routing";
import { cacheRequest, withCache } from "@/lib/cache";
import { captureError } from "@/lib/sentry";
import { supabase } from "@/lib/supabase/server";

const LOCALES = new Set<string>(routing.locales);
const SID_PATTERN = /^\d+$/;
const PRODUCT_CACHE_SECONDS = 60 * 60;

export async function GET(request: Request, context: { params: Promise<{ sid: string }> }) {
  const { sid } = await context.params;
  const locale = new URL(request.url).searchParams.get("locale") ?? routing.defaultLocale;
  if (!SID_PATTERN.test(sid) || !LOCALES.has(locale)) {
    return Response.json({ error: "Invalid product request" }, { status: 400 });
  }

  try {
    return await withCache(cacheRequest(request, { locale }), async () => {
      const [productResult, translationResult] = await Promise.all([
        supabase
          .from("products")
          .select("sid, name, price, images, supplier, is_prescription, category_ids, additional_info, info, feature_attributes, key_features, related_sids")
          .eq("sid", sid)
          .maybeSingle(),
        supabase
          .from("product_translations")
          .select("name, additional_info, info, feature_attributes, key_features")
          .eq("sid", sid)
          .eq("locale", locale)
          .maybeSingle(),
      ]);
      if (productResult.error) throw productResult.error;
      if (translationResult.error) throw translationResult.error;
      if (!productResult.data) return Response.json({ error: "Product not found" }, { status: 404 });

      return Response.json(
        { product: productResult.data, translation: translationResult.data },
        { headers: { "Cache-Control": `public, s-maxage=${PRODUCT_CACHE_SECONDS}` } },
      );
    });
  } catch (error) {
    void captureError(error, { tags: { area: "product" } });
    return Response.json({ error: "Couldn't load product" }, { status: 500 });
  }
}
