import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { GET as getProduct } from "@/app/api/products/[sid]/route";
import type { ProductRecord, ProductTranslationRecord } from "@/lib/products";
import { ProductDetail } from "./_components/ProductDetail";

const SID_PATTERN = /^\d+$/;

const loadProduct = cache(async (sid: string, locale: string) => {
  const response = await getProduct(
    new Request(`http://internal/api/products/${sid}?locale=${encodeURIComponent(locale)}`),
    { params: Promise.resolve({ sid }) },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Couldn't load product");
  return response.json() as Promise<{
    product: ProductRecord;
    translation: ProductTranslationRecord | null;
  }>;
});

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/product/[product]">): Promise<Metadata> {
  const { locale, product: productParam } = await params;
  if (!SID_PATTERN.test(productParam)) notFound();
  const loaded = await loadProduct(productParam, locale);
  if (!loaded) notFound();
  return { title: loaded.translation?.name || loaded.product.name };
}

export default async function ProductPage({
  params,
}: PageProps<"/[locale]/product/[product]">) {
  const { locale, product: productParam } = await params;
  if (!SID_PATTERN.test(productParam)) notFound();

  const loaded = await loadProduct(productParam, locale);
  if (!loaded) notFound();

  return (
    <section className="min-h-home bg-background pb-bottom-nav lg:pb-section">
      <div className="mx-auto w-full max-w-content px-page-x py-section">
        <ProductDetail locale={locale} product={loaded.product} translation={loaded.translation} />
      </div>
    </section>
  );
}
