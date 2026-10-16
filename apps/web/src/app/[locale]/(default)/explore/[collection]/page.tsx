import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { GET as getProducts } from "@/app/api/products/route";
import { getCollectionName } from "@/lib/collections";
import { COLLECTION_PAGE_SIZE, type ProductListRows } from "@/lib/products";
import { supabase } from "@/lib/supabase/server";
import { CollectionPagination } from "./_components/CollectionPagination";
import { CollectionProducts } from "./_components/CollectionProducts";

const COLLECTION_ID_PATTERN = /^[1-9]\d*$/;

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/explore/[collection]">): Promise<Metadata> {
  const { locale, collection: collectionParam } = await params;
  if (!COLLECTION_ID_PATTERN.test(collectionParam)) notFound();

  const collection = await getCollectionName(
    supabase,
    Number(collectionParam),
    locale,
  );
  if (!collection) notFound();

  return { title: collection.name };
}

function pageNumber(value: string | string[] | undefined) {
  if (value === undefined) return 1;
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^[1-9]\d*$/.test(raw)) return null;
  return Number(raw);
}

export default async function CollectionPage({
  params,
  searchParams,
}: PageProps<"/[locale]/explore/[collection]">) {
  const { locale, collection: collectionParam } = await params;
  if (!COLLECTION_ID_PATTERN.test(collectionParam)) notFound();

  const page = pageNumber((await searchParams).page);
  if (page === null) notFound();

  const collectionId = Number(collectionParam);
  const t = await getTranslations("Collection");
  const collection = await getCollectionName(supabase, collectionId, locale);
  if (!collection) notFound();

  const response = await getProducts(
    new Request(
      `http://internal/api/products?collection=${collectionId}&page=${page}&locale=${encodeURIComponent(locale)}`,
    ),
  );
  if (!response.ok) throw new Error("Couldn't load products");
  const rows = (await response.json()) as ProductListRows;
  const pageCount = Math.ceil(rows.total / COLLECTION_PAGE_SIZE);
  if (page > 1 && page > pageCount) notFound();

  return (
    <section className="min-h-home bg-background pb-bottom-nav lg:pb-section">
      <div className="mx-auto w-full max-w-content px-page-x py-section">
        <h1 className="flex flex-wrap items-baseline gap-x-3 text-heading font-bold tracking-tight text-foreground">
          <span>{collection.name}</span>
          {collection.originalName ? (
            <span className="text-body font-normal text-foreground-muted">{collection.originalName}</span>
          ) : null}
        </h1>
        {rows.products.length === 0 ? (
          <p className="mt-copy-gap text-body text-foreground-muted">
            {t("productsEmpty")}
          </p>
        ) : (
          <CollectionProducts rows={rows} />
        )}
        <CollectionPagination collectionId={collectionParam} page={page} total={rows.total} />
      </div>
    </section>
  );
}
