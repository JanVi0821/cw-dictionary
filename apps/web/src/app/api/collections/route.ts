import { routing, type AppLocale } from "@/i18n/routing";
import { withCache } from "@/lib/cache";
import { listCollectionChildren } from "@/lib/collections";
import { captureError } from "@/lib/sentry";
import { supabase } from "@/lib/supabase/server";

const LOCALES = new Set<string>(routing.locales);
const PARENT_ID_PATTERN = /^[1-9]\d*$/;
const COLLECTION_CACHE_SECONDS = 60 * 60 * 48;

function collectionCacheRequest(
  request: Request,
  locale: string,
  parent: string | null,
  collectionIds: number[] | null,
) {
  const url = new URL(request.url);
  url.search = "";
  url.searchParams.set("locale", locale);
  if (collectionIds) url.searchParams.set("ids", collectionIds.join(","));
  else if (parent !== null) url.searchParams.set("parent", parent);
  return new Request(url, { method: "GET" });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const locale = url.searchParams.get("locale") ?? routing.defaultLocale;
  const parent = url.searchParams.get("parent");
  const ids = url.searchParams.get("ids");

  if (!LOCALES.has(locale) || (parent !== null && !PARENT_ID_PATTERN.test(parent))) {
    return Response.json({ error: "Invalid collection request" }, { status: 400 });
  }

  const collectionIds =
    ids === null
      ? null
      : [...new Set(ids.split(","))]
          .filter((id) => PARENT_ID_PATTERN.test(id))
          .map(Number)
          .sort((left, right) => left - right);
  const cacheRequest = collectionCacheRequest(request, locale, parent, collectionIds);

  try {
    return await withCache(cacheRequest, async () => {
      const body =
        collectionIds === null
          ? await listCollectionChildren(supabase, parent === null ? null : Number(parent), locale as AppLocale)
          : await loadCollectionsByIds(locale, collectionIds);
      return Response.json(body, {
        headers: { "Cache-Control": `public, s-maxage=${COLLECTION_CACHE_SECONDS}` },
      });
    });
  } catch (error) {
    void captureError(error, { tags: { area: "collections" } });
    return Response.json({ error: "Couldn't load collections" }, { status: 500 });
  }
}

async function loadCollectionsByIds(locale: string, collectionIds: number[]) {
  if (collectionIds.length === 0) return { collections: [], translations: [] };

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
  return {
    collections: collections.data ?? [],
    translations: translations.data ?? [],
  };
}
