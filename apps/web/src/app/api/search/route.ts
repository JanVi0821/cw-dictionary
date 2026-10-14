import { routing, type AppLocale } from "@/i18n/routing";
import { searchCatalog } from "@/lib/search";

const LOCALES = new Set<string>(routing.locales);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const locale = url.searchParams.get("locale") ?? routing.defaultLocale;

  if (!LOCALES.has(locale)) {
    return Response.json({ error: "Invalid locale" }, { status: 400 });
  }

  try {
    return Response.json(await searchCatalog(query, locale as AppLocale));
  } catch {
    return Response.json({ error: "Search failed" }, { status: 500 });
  }
}
