import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { SearchResults } from "./_components/SearchResults";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Home" });

  return {
    title: t("heading"),
    description: t("description"),
  };
}

export default async function HomePage({
  searchParams,
}: PageProps<"/[locale]">) {
  const t = await getTranslations("Home");
  const locale = await getLocale();
  const { q: rawQuery } = await searchParams;
  const query = typeof rawQuery === "string" ? rawQuery : "";
  const searching = query.length > 0;

  return (
    <section
      className={
        searching
          ? "mx-auto w-full max-w-content px-page-x py-section pb-bottom-nav lg:pb-section"
          : "mx-auto flex min-h-home w-full max-w-content flex-col items-center justify-center gap-section px-page-x pb-bottom-nav pt-section lg:pb-section"
      }
      aria-labelledby="home-heading"
    >
      <div className={searching ? "w-full" : "w-full max-w-reading text-center"}>
        <h1
          id="home-heading"
          className="text-display font-bold tracking-tight text-foreground"
        >
          {t("heading")}
        </h1>
        {!searching && (
          <p className="mt-copy-gap text-body text-foreground-muted">
            {t("description")}
          </p>
        )}
      </div>
      <form
        className={
          searching
            ? "mt-copy-gap flex w-full gap-control-gap"
            : "flex w-full max-w-reading gap-control-gap"
        }
      >
        <label className="sr-only" htmlFor="home-search">
          {t("searchPlaceholder")}
        </label>
        <input
          id="home-search"
          name="q"
          type="search"
          defaultValue={query}
          placeholder={t("searchPlaceholder")}
          className="focus-ring min-w-0 flex-1 rounded-control border border-border bg-surface px-control-x py-3 text-body shadow-control"
        />
        <button
          type="submit"
          className="focus-ring shrink-0 rounded-control bg-primary px-control-x text-label font-semibold text-primary-foreground"
        >
          {t("searchSubmit")}
        </button>
      </form>
      {searching ? (
        <SearchResults
          locale={locale}
          query={query}
          copy={{
            collectionsEmpty: t("collectionsEmpty"),
            collectionsHeading: t("collectionsHeading"),
            productsEmpty: t("productsEmpty"),
            productsHeading: t("productsHeading"),
            queryTooShort: t("queryTooShort"),
            searchFailed: t("searchFailed"),
          }}
        />
      ) : null}
    </section>
  );
}
