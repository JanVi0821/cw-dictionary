"use client";

import { useLocale, useTranslations } from "next-intl";
import { CW_LOGO_URL } from "@/consts";
import { SearchResults } from "./SearchResults";
import { SearchIcon } from "lucide-react";
import { cn } from "cn";

export function HomeContent({ query = "" }: { query?: string }) {
  const t = useTranslations("Home");
  const locale = useLocale();
  const searching = query.length > 0;

  return (
    <section
      className={
        searching
          ? "mx-auto w-full max-w-content px-page-x py-section pb-bottom-nav lg:pb-section"
          : "mx-auto flex min-h-home w-full max-w-content flex-col items-center justify-start gap-section px-page-x pb-bottom-nav pt-12 lg:pb-section"
      }
      aria-labelledby="home-heading"
    >
      <div
        className={
          searching
            ? "w-full"
            : "w-full max-w-reading text-center flex flex-col gap-4 items-center"
        }
      >
        {!searching && (
          <img src={CW_LOGO_URL} alt="" className="h-auto w-full max-w-36" />
        )}
        <h1
          id="home-heading"
          className="text-display font-bold tracking-tight text-foreground"
        >
          {t("heading")}
        </h1>
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
          className="focus-ring min-w-0 flex-1 rounded-control border border-border bg-surface px-control-x py-3 text-body text-foreground shadow-control"
        />
        <button
          type="submit"
          className={cn(
            "focus-ring shrink-0 rounded-control bg-brand-red px-control-x text-label font-semibold text-primary-foreground hover:bg-brand-red-hover",
            "flex gap-2 items-center cursor-pointer",
          )}
        >
          <SearchIcon />
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
