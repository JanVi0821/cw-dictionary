import type { ProductCardItem } from "@/components/ProductCard";
import { routing } from "@/i18n/routing";
import type { Database, Json } from "@/types/generated/database.types";

export const COLLECTION_PAGE_SIZE = 24;

export type ProductRecord = Pick<
  Database["public"]["Tables"]["products"]["Row"],
  | "sid"
  | "name"
  | "price"
  | "images"
  | "supplier"
  | "is_prescription"
  | "category_ids"
  | "additional_info"
  | "info"
  | "feature_attributes"
  | "key_features"
  | "related_sids"
>;

export type ProductListRecord = Pick<ProductRecord, "sid" | "name" | "images">;

export type ProductTranslationRecord = Pick<
  Database["public"]["Tables"]["product_translations"]["Row"],
  "name" | "additional_info" | "info" | "feature_attributes" | "key_features"
>;

export type NameRow = {
  id: string;
  name: string;
};

export type CollectionNameRows = {
  collections: { collection_id: number; name: string }[];
  translations: { collection_id: number; name: string }[];
};

export type ProductNameRows = {
  products: ProductListRecord[];
  translations: { sid: string; name: string }[];
};

export type ProductListRows = {
  products: ProductListRecord[];
  translations: { sid: string; name: string }[];
  total: number;
};

export type ProductAttribute = {
  label: string;
  value: string;
};

export type ProductSection = {
  key: string;
  html: string;
  originalHtml: string | null;
};

export type ProductLink = {
  id: string;
  name: string;
  originalName: string | null;
  href: string;
};

export type ProductDetail = {
  sid: string;
  name: string;
  originalName: string | null;
  price: number | null;
  images: string[];
  supplier: string | null;
  isPrescription: boolean;
  translationMissing: boolean;
  additionalInfo: string[];
  additionalInfoOriginal: string[] | null;
  keyFeatures: string[];
  keyFeaturesOriginal: string[] | null;
  attributes: ProductAttribute[];
  attributesOriginal: { label: string; value: string }[] | null;
  sections: ProductSection[];
  categories: ProductLink[];
};

function httpImages(images: string[] | null) {
  return images?.filter((src) => /^https?:\/\//.test(src)) ?? [];
}

export function productCards(
  rows: { products: ProductListRecord[]; translations: { sid: string; name: string }[] },
  ids?: string[],
): ProductCardItem[] {
  const names = new Map(rows.translations.map((row) => [row.sid, row.name]));
  const listed = new Map(rows.products.map((product) => [product.sid, product]));
  const products = (ids ?? rows.products.map((product) => product.sid)).flatMap((id) => {
    const product = listed.get(id);
    return product ? [product] : [];
  });
  return products.map((product) => {
    const translated = names.get(product.sid);
    return {
      id: product.sid,
      name: translated ?? product.name,
      originalName: translated && translated !== product.name ? product.name : null,
      images: httpImages(product.images),
      href: `/product/${product.sid}`,
    };
  });
}

function links(
  ids: string[],
  names: Map<string, string>,
  translated: Map<string, string>,
  href: (id: string) => string,
): ProductLink[] {
  return ids.flatMap((id) => {
    const original = names.get(id);
    if (!original) return [];
    const name = translated.get(id) ?? original;
    return [{
      id,
      name,
      originalName: name === original ? null : original,
      href: href(id),
    }];
  });
}

export function collectionLinks(ids: number[], rows: CollectionNameRows) {
  return links(
    ids.map(String),
    new Map(rows.collections.map((row) => [String(row.collection_id), row.name])),
    new Map(rows.translations.map((row) => [String(row.collection_id), row.name])),
    (id) => `/explore/${id}`,
  );
}

const INFO_ORDER = [
  "description",
  "commonuses",
  "indications",
  "directions",
  "use",
  "ingredients",
  "warnings",
  "general_info",
  "prescription_information",
  "prescription_note",
  "unsectioned",
];

type InfoBlock = {
  title: string | null;
  html: string;
  source_hidden: boolean | null;
};

type Attribute = {
  label: string;
  value: string | string[];
};

function strings(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

function infoMap(value: Json | null | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const blocks: Record<string, InfoBlock> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const block = raw as Record<string, unknown>;
    if (typeof block.html !== "string" || !block.html.trim()) continue;
    blocks[key] = {
      title: typeof block.title === "string" ? block.title : null,
      html: block.html,
      source_hidden: block.source_hidden === true,
    };
  }
  return blocks;
}

function attributes(value: Json | null | undefined): Attribute[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): Attribute[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    if (typeof row.label !== "string" || !row.label.trim()) return [];
    if (typeof row.value === "string" && row.value.trim()) {
      return [{ label: row.label, value: row.value }];
    }
    if (Array.isArray(row.value)) {
      const values = strings(row.value);
      if (values.length > 0) return [{ label: row.label, value: values }];
    }
    return [];
  });
}

function attributeText(value: string | string[]) {
  return Array.isArray(value) ? value.join(", ") : value;
}

function plainAttributes(items: Attribute[]): ProductAttribute[] {
  return items.map((item) => ({ label: item.label, value: attributeText(item.value) }));
}

function sameList(left: string[], right: string[]) {
  return left.join("\n") === right.join("\n");
}

function sameAttributes(left: ProductAttribute[], right: ProductAttribute[]) {
  return left.length === right.length && left.every((item, index) => item.label === right[index]?.label && item.value === right[index]?.value);
}

function sectionRank(key: string) {
  const listed = INFO_ORDER.indexOf(key);
  if (listed >= 0) return listed;
  const numbered = key.match(/^(?:prescription_)?section_(\d+)$/);
  if (numbered) return INFO_ORDER.length + Number(numbered[1]);
  return INFO_ORDER.length + 1000;
}

function orderedSectionKeys(keys: string[]) {
  return [...keys].sort(
    (left, right) => sectionRank(left) - sectionRank(right) || left.localeCompare(right),
  );
}

function money(value: unknown) {
  const amount = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(amount) ? amount : null;
}

export function productDetailView(
  product: ProductRecord,
  translation: ProductTranslationRecord | null,
  locale: string,
  categories: ProductLink[],
): ProductDetail {
  const showOriginal = locale !== routing.defaultLocale && translation !== null;
  const sourceInfo = infoMap(product.info);
  const translatedInfo = infoMap(translation?.info);
  const sourceAttributes = attributes(product.feature_attributes);
  const translatedAttributes = attributes(translation?.feature_attributes);
  const sourceAdditional = strings(product.additional_info);
  const sourceFeatures = strings(product.key_features);
  const translatedAdditional = strings(translation?.additional_info);
  const translatedFeatures = strings(translation?.key_features);
  const currentAdditional = showOriginal && translatedAdditional.length > 0 ? translatedAdditional : sourceAdditional;
  const currentFeatures = showOriginal && translatedFeatures.length > 0 ? translatedFeatures : sourceFeatures;
  const hasTranslatedAttributes = showOriginal && translatedAttributes.length > 0;
  const currentAttributes = plainAttributes(hasTranslatedAttributes ? translatedAttributes : sourceAttributes);
  const sourceAttributeRows = plainAttributes(sourceAttributes);
  const sectionKeys = orderedSectionKeys([
    ...new Set([...Object.keys(sourceInfo), ...Object.keys(translatedInfo)]),
  ]).filter((key) => sourceInfo[key]?.source_hidden !== true);

  return {
    sid: product.sid,
    name: showOriginal && translation.name ? translation.name : product.name,
    originalName: showOriginal && translation.name && translation.name !== product.name ? product.name : null,
    price: money(product.price),
    images: httpImages(strings(product.images)),
    supplier: product.supplier,
    isPrescription: product.is_prescription,
    translationMissing: locale !== routing.defaultLocale && translation === null,
    additionalInfo: currentAdditional,
    additionalInfoOriginal: showOriginal && translatedAdditional.length > 0 && !sameList(sourceAdditional, translatedAdditional)
      ? sourceAdditional
      : null,
    keyFeatures: currentFeatures,
    keyFeaturesOriginal: showOriginal && translatedFeatures.length > 0 && !sameList(sourceFeatures, translatedFeatures)
      ? sourceFeatures
      : null,
    attributes: currentAttributes,
    attributesOriginal: hasTranslatedAttributes && sourceAttributeRows.length > 0 && !sameAttributes(sourceAttributeRows, currentAttributes)
      ? sourceAttributeRows
      : null,
    sections: sectionKeys.flatMap((key) => {
      const current = (showOriginal ? translatedInfo[key] : undefined) ?? sourceInfo[key];
      if (!current) return [];
      const original = sourceInfo[key];
      return [{
        key,
        html: current.html,
        originalHtml: showOriginal && original && original.html !== current.html ? original.html : null,
      }];
    }),
    categories,
  };
}
