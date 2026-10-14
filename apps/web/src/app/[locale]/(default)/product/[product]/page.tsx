import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getProductName } from "@/lib/products";
import { supabase } from "@/lib/supabase/server";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/product/[product]">): Promise<Metadata> {
  const { locale, product: productParam } = await params;
  const name = await getProductName(supabase, productParam, locale);
  if (!name) notFound();
  return { title: name };
}

export default async function ProductPage({
  params,
}: PageProps<"/[locale]/product/[product]">) {
  const { locale, product: productParam } = await params;
  const name = await getProductName(supabase, productParam, locale);
  if (!name) notFound();

  return (
    <section className="min-h-home bg-background pb-bottom-nav lg:pb-section">
      <div className="mx-auto w-full max-w-content px-page-x py-section">
        <h1 className="text-heading font-bold tracking-tight text-foreground">
          {name}
        </h1>
      </div>
    </section>
  );
}
