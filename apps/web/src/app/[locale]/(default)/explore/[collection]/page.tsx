import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getCollectionName } from "@/lib/collections";
import { listCollectionProducts } from "@/lib/products";
import { supabase } from "@/lib/supabase/server";

const COLLECTION_ID_PATTERN = /^[1-9]\d*$/;

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/explore/[collection]">): Promise<Metadata> {
  const { locale, collection: collectionParam } = await params;
  if (!COLLECTION_ID_PATTERN.test(collectionParam)) notFound();

  const name = await getCollectionName(
    supabase,
    Number(collectionParam),
    locale,
  );
  if (!name) notFound();

  return { title: name };
}

export default async function CollectionPage({
  params,
}: PageProps<"/[locale]/explore/[collection]">) {
  const { locale, collection: collectionParam } = await params;
  if (!COLLECTION_ID_PATTERN.test(collectionParam)) notFound();

  const collectionId = Number(collectionParam);
  const t = await getTranslations("Collection");
  const name = await getCollectionName(supabase, collectionId, locale);
  if (!name) notFound();

  const products = await listCollectionProducts(supabase, collectionId, locale);

  return (
    <section className="min-h-home bg-background pb-bottom-nav lg:pb-section">
      <div className="mx-auto w-full max-w-content px-page-x py-section">
        <h1 className="text-heading font-bold tracking-tight text-foreground">
          {name}
        </h1>
        {products.length === 0 ? (
          <p className="mt-copy-gap text-body text-foreground-muted">
            {t("productsEmpty")}
          </p>
        ) : (
          <ul className="mt-copy-gap overflow-hidden rounded-control border border-border bg-surface">
            {products.map((product) => (
              <li key={product.sid} className="border-t border-border first:border-t-0">
                <Link
                  href={`/product/${product.sid}`}
                  className="focus-ring flex min-h-touch items-center px-control-x py-2 text-body font-medium text-foreground hover:bg-surface-muted"
                >
                  <span className="truncate">{product.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
