import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/generated/database.types";
import { routing } from "@/i18n/routing";

export type ProductListItem = {
  sid: string;
  name: string;
};

export async function getProductName(
  client: SupabaseClient<Database>,
  sid: string,
  locale: string,
) {
  if (locale !== routing.defaultLocale) {
    const { data, error } = await client
      .from("product_translations")
      .select("name")
      .eq("sid", sid)
      .eq("locale", locale)
      .maybeSingle();
    if (error) throw error;
    if (data?.name) return data.name as string;
  }

  const { data, error } = await client
    .from("products")
    .select("name")
    .eq("sid", sid)
    .maybeSingle();
  if (error) throw error;
  return (data?.name as string | undefined) ?? null;
}

export async function listCollectionProducts(
  client: SupabaseClient<Database>,
  collectionId: number,
  locale: string,
): Promise<ProductListItem[]> {
  const { data, error } = await client
    .from("products")
    .select("sid, name")
    .contains("category_ids", [collectionId])
    .order("name")
    .limit(40);
  if (error) throw error;

  const products = (data ?? []) as ProductListItem[];
  if (locale === routing.defaultLocale || products.length === 0) return products;

  const { data: translations, error: translationError } = await client
    .from("product_translations")
    .select("sid, name")
    .eq("locale", locale)
    .in(
      "sid",
      products.map((product) => product.sid),
    );
  if (translationError) throw translationError;

  const names = new Map(
    (translations ?? []).map((row: ProductListItem) => [row.sid, row.name]),
  );

  return products.map((product) => ({
    ...product,
    name: names.get(product.sid) ?? product.name,
  }));
}
