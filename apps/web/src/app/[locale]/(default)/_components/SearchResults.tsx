"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  ProductCardGrid,
  type ProductCardItem,
} from "@/components/ProductCard";
import { Link } from "@/i18n/navigation";
import { ChevronRight, LoaderCircle } from "lucide-react";

type SearchCopy = {
  collectionsEmpty: string;
  collectionsHeading: string;
  productsEmpty: string;
  productsHeading: string;
  queryTooShort: string;
  searchFailed: string;
};

type SearchResponse = {
  collections: ProductCardItem[];
  products: ProductCardItem[];
  tooShort: boolean;
};

function CollectionList({ items }: { items: ProductCardItem[] }) {
  return (
    <ul className="mt-copy-gap gap-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <li key={item.id}>
          <Link
            href={item.href}
            className="focus-ring flex h-full min-h-touch items-center gap-3 rounded-control border border-border bg-surface px-control-x py-2 hover:bg-surface-muted"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-label font-semibold text-foreground">
                {item.name}
              </span>
              {item.originalName ? (
                <span className="block truncate text-sm text-foreground-muted">
                  {item.originalName}
                </span>
              ) : null}
            </span>
            <span
              aria-hidden="true"
              className="shrink-0 text-label text-foreground-muted"
            >
              <ChevronRight className="size-nav-icon" />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ResultGrid({
  empty,
  emptyLabel,
  heading,
  items,
}: {
  empty: string;
  emptyLabel: string;
  heading: string;
  items: ProductCardItem[];
}) {
  const t = useTranslations("Product");

  return (
    <section>
      <h2 className="text-body font-semibold text-foreground">{heading}</h2>
      {items.length === 0 ? (
        <p className="mt-control-gap text-label text-foreground-muted">
          {empty}
        </p>
      ) : (
        <ProductCardGrid
          emptyLabel={emptyLabel}
          imageAlt={(name) => t("imageAlt", { name })}
          items={items}
        />
      )}
    </section>
  );
}

export function SearchResults({
  copy,
  locale,
  query,
}: {
  copy: SearchCopy;
  locale: string;
  query: string;
}) {
  const product = useTranslations("Product");
  const { data, isError, isPending } = useQuery({
    queryKey: ["search", locale, query],
    staleTime: Infinity,
    queryFn: async () => {
      const response = await fetch(
        `/api/search?q=${encodeURIComponent(query)}&locale=${encodeURIComponent(locale)}`,
      );
      if (!response.ok) throw new Error("Search failed");
      return response.json() as Promise<SearchResponse>;
    },
  });

  if (isPending) {
    return (
      <p className="mt-section text-body text-foreground-muted">
        <LoaderCircle className="size-8 animate-spin" aria-hidden="true" />
      </p>
    );
  }

  if (isError || !data) {
    return (
      <p
        className="mt-section rounded-control bg-danger-background px-3 py-2 text-body text-danger-foreground"
        role="alert"
      >
        {copy.searchFailed}
      </p>
    );
  }

  if (data.tooShort) {
    return (
      <p className="mt-section text-body text-foreground-muted">
        {copy.queryTooShort}
      </p>
    );
  }

  return (
    <div className="my-section flex w-full flex-col gap-section">
      <section>
        <h2 className="text-body font-semibold text-foreground">
          {copy.collectionsHeading}
        </h2>
        {data.collections.length === 0 ? (
          <p className="mt-control-gap text-label text-foreground-muted">
            {copy.collectionsEmpty}
          </p>
        ) : (
          <CollectionList items={data.collections} />
        )}
      </section>
      <ResultGrid
        heading={copy.productsHeading}
        empty={copy.productsEmpty}
        emptyLabel={product("imageUnavailable")}
        items={data.products}
      />
    </div>
  );
}
