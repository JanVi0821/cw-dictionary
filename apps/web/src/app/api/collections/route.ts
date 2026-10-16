import { routing, type AppLocale } from "@/i18n/routing";
import { listCollectionChildren } from "@/lib/collections";
import { cachedCollection } from "@/lib/redis";
import { supabase } from "@/lib/supabase/server";

const LOCALES = new Set<string>(routing.locales);
const PARENT_ID_PATTERN = /^[1-9]\d*$/;

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
  const cacheKey =
    collectionIds === null
      ? `collections:${locale}:parent:${parent ?? "root"}`
      : `collections:${locale}:ids:${collectionIds.join(",")}`;

  try {
    const body = await cachedCollection(cacheKey, async () => {
      if (collectionIds !== null) {
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

      return listCollectionChildren(
        supabase,
        parent === null ? null : Number(parent),
        locale as AppLocale,
      );
    });
    return Response.json(body);
  } catch {
    return Response.json({ error: "Couldn't load collections" }, { status: 500 });
  }
}
