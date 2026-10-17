"use client";

import { Collapsible, Tag } from "@douyinfe/semi-ui-19";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ImagePreview } from "@/components/ImagePreview";
import { ProductCardGrid } from "@/components/ProductCard";
import { tagColor } from "@/components/StringTags";
import { Link } from "@/i18n/navigation";
import {
  collectionLinks,
  productCards,
  productDetailView,
  type CollectionNameRows,
  type ProductAttribute,
  type ProductRecord,
  type ProductNameRows,
  type ProductTranslationRecord,
} from "@/lib/products";
import { cn } from "cn";

const htmlClass =
  "text-body text-foreground [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-bold [&_img]:my-2 [&_img]:max-w-full [&_li]:ml-5 [&_ol]:list-decimal [&_p+p]:mt-2 [&_table]:w-full [&_td]:border [&_td]:border-separator [&_td]:px-2 [&_td]:py-1 [&_ul]:list-disc";

function FactList({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1">
      {items.map((item) => (
        <li key={item} className="break-words">
          {item}
        </li>
      ))}
    </ul>
  );
}

function OriginalBlock({ children }: { children: ReactNode }) {
  const t = useTranslations("Product");
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        className="cursor-pointer focus-ring text-label text-brand-blue underline underline-offset-2 hover:text-brand-blue-hover"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {t("viewOriginal")}
      </button>
      <Collapsible isOpen={open}>{children}</Collapsible>
    </div>
  );
}

function AttributeList({ items }: { items: ProductAttribute[] }) {
  if (items.length === 0) return null;
  return (
    <dl className="mt-2 grid gap-3">
      {items.map((item) => (
        <div key={`${item.label}-${item.value}`}>
          <dt className="font-semibold">{item.label}</dt>
          <dd className="mt-1 break-words">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ProductDetail({
  locale,
  product: record,
  translation,
}: {
  locale: string;
  product: ProductRecord;
  translation: ProductTranslationRecord | null;
}) {
  const t = useTranslations("Product");
  const categoryIds = record.category_ids ?? [];
  const relatedSids = record.related_sids ?? [];
  const categories = useQuery({
    queryKey: ["collection-names", locale, categoryIds],
    enabled: categoryIds.length > 0,
    staleTime: Infinity,
    queryFn: async () => {
      const response = await fetch(
        `/api/collections?ids=${categoryIds.join(",")}&locale=${encodeURIComponent(locale)}`,
      );
      if (!response.ok) throw new Error("Couldn't load collections");
      return response.json() as Promise<CollectionNameRows>;
    },
  });
  const related = useQuery({
    queryKey: ["product-names", locale, relatedSids],
    enabled: relatedSids.length > 0,
    staleTime: Infinity,
    queryFn: async () => {
      const response = await fetch(
        `/api/products?sids=${relatedSids.join(",")}&locale=${encodeURIComponent(locale)}`,
      );
      if (!response.ok) throw new Error("Couldn't load products");
      return response.json() as Promise<ProductNameRows>;
    },
  });
  const product = productDetailView(
    record,
    translation,
    locale,
    categories.data ? collectionLinks(categoryIds, categories.data) : [],
  );
  const relatedCards = related.data
    ? productCards(related.data, relatedSids)
    : [];
  const price =
    product.price === null
      ? null
      : new Intl.NumberFormat("en-NZ", {
          style: "currency",
          currency: "NZD",
        }).format(product.price);

  return (
    <article>
      {product.categories.length > 0 ? (
        <ul className="mb-section flex flex-wrap gap-2">
          {product.categories.map((item) => (
            <li key={item.id} className="max-w-full min-w-0">
              <Link
                href={item.href}
                className="focus-ring inline-flex max-w-full min-w-0"
              >
                <Tag
                  color={tagColor(item.name)}
                  className="max-w-full min-w-0 !h-6 underline [&_.semi-tag-content]:!min-w-0 [&_.semi-tag-content]:!overflow-hidden"
                >
                  <span className="min-w-0 truncate">
                    {item.name}
                    {item.originalName ? (
                      <span className="font-normal">
                        {" "}
                        ({item.originalName})
                      </span>
                    ) : null}
                  </span>
                </Tag>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <header className="flex flex-col gap-section lg:flex-row">
        {product.images.length > 0 ? (
          <div className="w-full max-w-sm shrink-0">
            <ImagePreview
              images={product.images}
              alt={t("imageAlt", { name: product.name })}
              className="h-80 w-full rounded-surface bg-surface"
              thumbnails
            />
          </div>
        ) : null}

        <div className="min-w-0 flex-1">
          <h1 className="break-words text-heading font-bold tracking-tight text-foreground">
            {product.name}
          </h1>
          {product.originalName ? (
            <p className="mt-1 break-words text-body font-normal text-foreground-muted">
              {product.originalName}
            </p>
          ) : null}
          {product.translationMissing ? (
            <p className="mt-control-gap text-label text-warning-foreground">
              {t("translationUnavailable")}
            </p>
          ) : null}
          <div className="mt-copy-gap flex flex-wrap items-center gap-3">
            {price ? (
              <p className="text-heading font-bold text-brand-red">{price}</p>
            ) : null}
            <a
              href={`https://www.chemistwarehouse.co.nz/buy/${product.sid}`}
              target="_blank"
              rel="noopener noreferrer"
              className="focus-ring text-label text-brand-blue underline underline-offset-2 hover:text-brand-blue-hover"
            >
              {t("buy")}
            </a>
          </div>
          {product.isPrescription ? (
            <div className="mt-control-gap">
              <p className="inline-flex rounded-pill bg-warning-background px-3 py-1 text-label font-semibold text-warning-foreground">
                {t("prescription")}
              </p>
              <p className="mt-2 text-label text-brand-red">
                {t("prescriptionShipping")}
              </p>
            </div>
          ) : null}

          {product.supplier ? (
            <dl
              className={cn("mt-copy-gap py-copy-gap text-label", {
                "border-y border-separator":
                  product.attributes.length > 0 ||
                  product.additionalInfo.length > 0 ||
                  product.keyFeatures.length > 0,
              })}
            >
              <div>
                <dt className="font-semibold text-foreground-muted">
                  {t("supplier")}
                </dt>
                <dd className="mt-1 break-words text-foreground">
                  {product.supplier}
                </dd>
              </div>
            </dl>
          ) : null}

          {product.additionalInfo.length > 0 ? (
            <section className="mt-copy-gap">
              <FactList items={product.additionalInfo} />
            </section>
          ) : null}
          {product.keyFeatures.length > 0 ? (
            <section className="mt-copy-gap">
              <FactList items={product.keyFeatures} />
            </section>
          ) : null}
          {product.attributes.length > 0 ? (
            <section className="mt-copy-gap">
              <AttributeList items={product.attributes} />
            </section>
          ) : null}

          {product.additionalInfoOriginal ||
          product.keyFeaturesOriginal ||
          product.attributesOriginal ? (
            <OriginalBlock>
              <div className="text-sm leading-5 text-foreground-muted flex flex-col gap-copy-gap">
                {product.additionalInfoOriginal ? (
                  <section>
                    <FactList items={product.additionalInfoOriginal} />
                  </section>
                ) : null}
                {product.keyFeaturesOriginal ? (
                  <section>
                    <FactList items={product.keyFeaturesOriginal} />
                  </section>
                ) : null}
                {product.attributesOriginal ? (
                  <section>
                    <AttributeList items={product.attributesOriginal} />
                  </section>
                ) : null}
              </div>
            </OriginalBlock>
          ) : null}
        </div>
      </header>

      {product.isPrescription || product.sections.length > 0 ? (
        <div className="mt-section divide-y divide-separator border-y border-separator">
          {product.isPrescription ? (
            <section className="py-copy-gap">
              <h2 className="mb-2 text-base font-bold">
                {t("prescriptionInformation.title")}
              </h2>
              <p className="text-body text-foreground">
                {t("prescriptionInformation.content")}
              </p>
            </section>
          ) : null}
          {product.sections.map((section) => (
            <section key={section.key} className="py-copy-gap">
              <div
                className={htmlClass}
                dangerouslySetInnerHTML={{ __html: section.html }}
              />
              {section.originalHtml ? (
                <OriginalBlock>
                  <div
                    className={`${htmlClass} mt-2 text-sm leading-6 text-foreground-muted`}
                    dangerouslySetInnerHTML={{ __html: section.originalHtml }}
                  />
                </OriginalBlock>
              ) : null}
            </section>
          ))}
        </div>
      ) : null}

      {relatedCards.length > 0 ? (
        <section className="mt-section">
          <h2 className="text-base font-bold">{t("related")}</h2>
          <ProductCardGrid
            emptyLabel={t("imageUnavailable")}
            imageAlt={(name) => t("imageAlt", { name })}
            items={relatedCards}
          />
        </section>
      ) : null}
    </article>
  );
}
