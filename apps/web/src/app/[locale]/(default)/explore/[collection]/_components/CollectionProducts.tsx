"use client";

import { useTranslations } from "next-intl";
import { ProductCardGrid } from "@/components/ProductCard";
import { productCards, type ProductListRows } from "@/lib/products";

export function CollectionProducts({ rows }: { rows: ProductListRows }) {
  const t = useTranslations("Product");
  const items = productCards(rows);
  if (items.length === 0) return null;

  return (
    <ProductCardGrid
      emptyLabel={t("imageUnavailable")}
      imageAlt={(name) => t("imageAlt", { name })}
      items={items}
    />
  );
}
