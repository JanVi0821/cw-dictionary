/** 连接信息只从本应用 .env 读取，日志不输出 URI。 */
export const ENV = {
  mongoUri: "MONGODB_URI",
  supabaseUrl: "NEXT_PUBLIC_SUPABASE_URL",
  secretKey: "SUPABASE_SECRET_KEY",
  publishableKey: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  jwksUrl: "SUPABASE_JWKS_URL",
} as const;
export const MONGO_DATABASE = "cw_data";
export const SCHEMA = "public";
export const EXTENSION_SCHEMA = "extensions";
export const BATCH_SIZE = 100;
/** Data API 比较目标记录时的请求页大小；实际返回更少时按返回条数继续。 */
export const LOOKUP_PAGE_SIZE = 100;
export const LIMIT = Infinity;
export const CONNECTION_TIMEOUT_MS = 10_000;
export const REQUEST_TIMEOUT_MS = 120_000;
export const SCHEMA_FILE = new URL("../sql/schema.sql", import.meta.url);

export type Column = {
  name: string;
  type:
    | "text"
    | "text[]"
    | "integer"
    | "integer[]"
    | "boolean"
    | "jsonb"
    | "numeric(12,2)";
  constraints: string;
  source?: string;
};
export type TableConfig = {
  source: string;
  target: string;
  translated: boolean;
  unique: readonly string[];
  columns: readonly Column[];
  parentIndex?: boolean;
  categoryIndex?: boolean;
  /** 每批先比较目标，仅 upsert 新记录和发生变化的记录。 */
  incremental?: boolean;
};
const name: Column = {
  name: "name",
  type: "text",
  constraints: "not null check (btrim(name) <> '')",
};
const sid: Column = {
  name: "sid",
  type: "text",
  constraints: "not null check (sid ~ '^[0-9]+$')",
};
const collectionId: Column = {
  name: "collection_id",
  type: "integer",
  constraints: "not null check (collection_id > 0)",
};
const parentId: Column = {
  name: "parent_id",
  type: "integer",
  constraints: "check (parent_id > 0 and parent_id <> collection_id)",
};
const locale: Column = {
  name: "locale",
  source: "translation.lang",
  type: "text",
  constraints: "not null check (btrim(locale) <> '')",
};
const additionalInfo: Column = {
  name: "additional_info",
  type: "text[]",
  constraints: "not null default '{}'::text[]",
};
const info: Column = {
  name: "info",
  type: "jsonb",
  constraints:
    "not null default '{}'::jsonb check (jsonb_typeof(info) = 'object')",
};
const attributes: Column = {
  name: "feature_attributes",
  type: "jsonb",
  constraints:
    "not null default '[]'::jsonb check (jsonb_typeof(feature_attributes) = 'array')",
};
const keyFeatures: Column = {
  name: "key_features",
  type: "text[]",
  constraints: "not null default '{}'::text[]",
};

/** 建表、索引、批量 upsert 和字段白名单使用同一份配置；不包含 Mongo 过程字段。 */
export const TABLES = {
  products: {
    source: "data_raw",
    target: "products",
    translated: false,
    unique: ["sid"],
    categoryIndex: true,
    incremental: true,
    columns: [
      sid,
      name,
      {
        name: "price",
        type: "numeric(12,2)",
        constraints: "not null check (price >= 0)",
      },
      {
        name: "images",
        type: "text[]",
        constraints: "not null default '{}'::text[]",
      },
      { name: "supplier", type: "text", constraints: "" },
      { name: "product_id", type: "text", constraints: "" },
      {
        name: "is_prescription",
        source: "isPrescription",
        type: "boolean",
        constraints: "not null default false",
      },
      {
        name: "category_ids",
        type: "integer[]",
        constraints: "not null default '{}'::integer[]",
      },
      additionalInfo,
      info,
      attributes,
      keyFeatures,
      {
        name: "related_sids",
        type: "text[]",
        constraints: "not null default '{}'::text[]",
      },
    ],
  },
  productTranslations: {
    source: "data_raw_translated",
    target: "product_translations",
    translated: true,
    unique: ["sid", "locale"],
    incremental: true,
    columns: [sid, locale, name, additionalInfo, info, attributes, keyFeatures],
  },
  collections: {
    source: "collection_raw",
    target: "collections",
    translated: false,
    unique: ["collection_id"],
    parentIndex: true,
    columns: [collectionId, name, parentId],
  },
  collectionTranslations: {
    source: "collection_raw_translated",
    target: "collection_translations",
    translated: true,
    unique: ["collection_id", "locale"],
    parentIndex: true,
    columns: [collectionId, locale, name, parentId],
  },
} satisfies Record<string, TableConfig>;
export type TableKey = keyof typeof TABLES;
