import { getRequestConfig } from "next-intl/server";
import { locale as getRootLocale } from "next/root-params";
import { routing } from "./routing";

export default getRequestConfig(async () => {
  const requestedLocale = await getRootLocale();
  const resolvedLocale =
    routing.locales.find((candidate) => candidate === requestedLocale) ??
    routing.defaultLocale;

  return {
    locale: resolvedLocale,
    messages: (await import(`../../messages/${resolvedLocale}.json`)).default,
  };
});
