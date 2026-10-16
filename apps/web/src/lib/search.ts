import "server-only";

import type { ProductCardItem } from "@/components/ProductCard";
import type { AppLocale } from "@/i18n/routing";
import { supabase } from "@/lib/supabase/server";

type CardRow = {
  kind: string;
  id: string;
  name: string;
  original_name: string | null;
};

const RESULT_LIMIT = 20;
export const MAX_SEARCH_LENGTH = 120;
const REQUEST_TIMEOUT_MS = 10_000;

function toCard(row: CardRow, href: string, images: string[] | null): ProductCardItem {
  return {
    id: row.id,
    name: row.name,
    originalName:
      row.original_name && row.original_name !== row.name
        ? row.original_name
        : null,
    images: (images ?? []).filter((src) => /^https?:\/\//.test(src)),
    href,
  };
}

export async function searchCatalog(query: string, locale: AppLocale) {
  const trimmed = query.normalize("NFKC").trim();
  if (Array.from(trimmed).length < 2) {
    return {
      collections: [] as ProductCardItem[],
      products: [] as ProductCardItem[],
      tooShort: trimmed.length > 0,
    };
  }

  if (Array.from(trimmed).length > MAX_SEARCH_LENGTH)
    throw new Error("Search query too long");
  const { data, error } = await supabase
    .rpc("search_catalog", {
      p_query: trimmed,
      p_locale: locale,
      p_limit: RESULT_LIMIT,
    })
    .abortSignal(AbortSignal.timeout(REQUEST_TIMEOUT_MS));
  if (error) throw error;
  const productIds = (data ?? []).flatMap((row) => row.kind === "product" ? [row.id] : []);
  const imagesById = new Map<string, string[]>();
  if (productIds.length > 0) {
    const pictures = await supabase
      .from("products")
      .select("sid, images")
      .in("sid", productIds)
      .abortSignal(AbortSignal.timeout(REQUEST_TIMEOUT_MS));
    if (pictures.error) throw pictures.error;
    for (const picture of pictures.data ?? []) imagesById.set(picture.sid, picture.images ?? []);
  }
  const collections: ProductCardItem[] = [];
  const products: ProductCardItem[] = [];
  for (const row of data ?? []) {
    if (row.kind === "collection")
      collections.push(toCard(row, `/explore/${row.id}`, []));
    else if (row.kind === "product")
      products.push(toCard(row, `/product/${row.id}`, imagesById.get(row.id) ?? []));
  }
  return { collections, products, tooShort: false };
}
