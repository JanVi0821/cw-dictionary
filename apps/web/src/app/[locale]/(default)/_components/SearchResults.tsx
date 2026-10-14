"use client";

import { useQuery } from "@tanstack/react-query";
import { Link } from "@/i18n/navigation";

type SearchHit = {
  kind: "collection" | "product";
  id: string;
  name: string;
};

type SearchCopy = {
  collectionsEmpty: string;
  collectionsHeading: string;
  productsEmpty: string;
  productsHeading: string;
  queryTooShort: string;
  searchFailed: string;
};

type SearchResponse = {
  collections: SearchHit[];
  products: SearchHit[];
  tooShort: boolean;
};

function HitList({
  empty,
  heading,
  hrefFor,
  hits,
}: {
  empty: string;
  heading: string;
  hrefFor: (hit: SearchHit) => string;
  hits: SearchHit[];
}) {
  return (
    <section>
      <h2 className="text-body font-semibold text-foreground">{heading}</h2>
      {hits.length === 0 ? (
        <p className="mt-control-gap text-label text-foreground-muted">{empty}</p>
      ) : (
        <ul className="mt-control-gap overflow-hidden rounded-control border border-border bg-surface">
          {hits.map((hit) => (
            <li
              key={`${hit.kind}-${hit.id}`}
              className="border-t border-border first:border-t-0"
            >
              <Link
                href={hrefFor(hit)}
                className="focus-ring flex min-h-touch items-center px-control-x py-2 text-body font-medium text-foreground hover:bg-surface-muted"
              >
                <span className="truncate">{hit.name}</span>
              </Link>
            </li>
          ))}
        </ul>
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
    return <p className="mt-section text-body text-foreground-muted">…</p>;
  }

  if (isError || !data) {
    return (
      <p className="mt-section text-body text-danger" role="alert">
        {copy.searchFailed}
      </p>
    );
  }

  if (data.tooShort) {
    return (
      <p className="mt-section text-body text-foreground-muted">{copy.queryTooShort}</p>
    );
  }

  return (
    <div className="mt-section flex w-full flex-col gap-section">
      <HitList
        heading={copy.collectionsHeading}
        empty={copy.collectionsEmpty}
        hrefFor={(hit) => `/explore/${hit.id}`}
        hits={data.collections}
      />
      <HitList
        heading={copy.productsHeading}
        empty={copy.productsEmpty}
        hrefFor={(hit) => `/product/${hit.id}`}
        hits={data.products}
      />
    </div>
  );
}
