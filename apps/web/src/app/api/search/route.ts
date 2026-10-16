import { routing, type AppLocale } from "@/i18n/routing";
import { MAX_SEARCH_LENGTH, searchCatalog } from "@/lib/search";

const LOCALES = new Set<string>(routing.locales);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const locale = url.searchParams.get("locale") ?? routing.defaultLocale;

  if (!LOCALES.has(locale)) {
    return Response.json({ error: "Invalid locale" }, { status: 400 });
  }
  if (Array.from(query.normalize("NFKC").trim()).length > MAX_SEARCH_LENGTH) {
    return Response.json({ error: "Search query too long" }, { status: 400 });
  }

  try {
    return Response.json(await searchCatalog(query, locale as AppLocale));
  } catch {
    return Response.json({ error: "Search failed" }, { status: 500 });
  }
}
