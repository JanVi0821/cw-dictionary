import { routing, type AppLocale } from "@/i18n/routing";
import { cacheRequest, withCache } from "@/lib/cache";
import { MAX_SEARCH_LENGTH, searchCatalog } from "@/lib/search";
import { captureError } from "@/lib/sentry";

const LOCALES = new Set<string>(routing.locales);
const SEARCH_CACHE_SECONDS = 60 * 60;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").normalize("NFKC").trim();
  const locale = url.searchParams.get("locale") ?? routing.defaultLocale;

  if (!LOCALES.has(locale)) {
    return Response.json({ error: "Invalid locale" }, { status: 400 });
  }
  if (Array.from(query).length > MAX_SEARCH_LENGTH) {
    return Response.json({ error: "Search query too long" }, { status: 400 });
  }

  try {
    return await withCache(cacheRequest(request, { locale, q: query }), async () =>
      Response.json(await searchCatalog(query, locale as AppLocale), {
        headers: { "Cache-Control": `public, s-maxage=${SEARCH_CACHE_SECONDS}` },
      }),
    );
  } catch (error) {
    void captureError(error, { tags: { area: "search" } });
    return Response.json({ error: "Search failed" }, { status: 500 });
  }
}
