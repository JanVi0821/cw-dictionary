import { routing, type AppLocale } from "@/i18n/routing";
import { cacheRequest, withCache } from "@/lib/cache";
import { listCollectionChildren } from "@/lib/collections";
import { captureError } from "@/lib/sentry";
import { supabase } from "@/lib/supabase/server";

const LOCALES = new Set<string>(routing.locales);
const PARENT_ID_PATTERN = /^[1-9]\d*$/;
const COLLECTION_CACHE_SECONDS = 60 * 60 * 48;

function cachedJson(body: unknown) {
  return Response.json(body, {
    headers: { "Cache-Control": `public, s-maxage=${COLLECTION_CACHE_SECONDS}` },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const locale = url.searchParams.get("locale") ?? routing.defaultLocale;
  const parent = url.searchParams.get("parent");
  const ids = url.searchParams.get("ids");

  if (!LOCALES.has(locale) || (parent !== null && !PARENT_ID_PATTERN.test(parent))) {
    return Response.json({ error: "Invalid collection request" }, { status: 400 });
  }

  if (ids !== null) {
    const collectionIds = [...new Set(ids.split(","))]
      .filter((id) => PARENT_ID_PATTERN.test(id))
      .map(Number)
      .sort((left, right) => left - right);
    try {
      return await withCache(cacheRequest(request, { locale, ids: collectionIds.join(",") }), () =>
        loadCollectionsByIds(locale, collectionIds),
      );
    } catch (error) {
      void captureError(error, { tags: { area: "collections" } });
      return Response.json({ error: "Couldn't load collections" }, { status: 500 });
    }
  }

  try {
    return await withCache(
      cacheRequest(request, parent === null ? { locale } : { locale, parent }),
      () => loadCollectionChildren(locale, parent),
    );
  } catch (error) {
    void captureError(error, { tags: { area: "collections" } });
    return Response.json({ error: "Couldn't load collections" }, { status: 500 });
  }
}

async function loadCollectionChildren(locale: string, parent: string | null) {
  return cachedJson(
    await listCollectionChildren(
      supabase,
      parent === null ? null : Number(parent),
      locale as AppLocale,
    ),
  );
}

async function loadCollectionsByIds(locale: string, collectionIds: number[]) {
  if (collectionIds.length === 0) return cachedJson({ collections: [], translations: [] });

  const [collections, translations] = await Promise.all([
    supabase.from("collections").select("collection_id, name").in("collection_id", collectionIds),
    supabase
      .from("collection_translations")
      .select("collection_id, name")
      .eq("locale", locale)
      .in("collection_id", collectionIds),
  ]);
  if (collections.error) throw collections.error;
  if (translations.error) throw translations.error;
  return cachedJson({
    collections: collections.data ?? [],
    translations: translations.data ?? [],
  });
}
