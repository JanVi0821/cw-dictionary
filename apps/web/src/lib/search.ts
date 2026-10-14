import "server-only";

import { Pool, type PoolClient } from "pg";
import { routing, type AppLocale } from "@/i18n/routing";

export type SearchHit = {
  kind: "collection" | "product";
  id: string;
  name: string;
};

type NameRow = {
  id: string;
  name: string;
};

const RESULT_LIMIT = 20;

const connectionString = process.env.SUPABASE_DB_URL;

if (!connectionString) {
  throw new Error("SUPABASE_DB_URL is not configured.");
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  max: 1,
});

async function matchingNames(
  db: PoolClient,
  locale: AppLocale,
  query: string,
  kind: SearchHit["kind"],
) {
  const translated = locale !== routing.defaultLocale;
  const sql =
    kind === "collection"
      ? translated
        ? `select collection_id::text as id, name
           from collection_translations
           where locale = $3
             and name %> $1
           order by word_similarity($1, name) desc
           limit $2`
        : `select collection_id::text as id, name
           from collections
           where name %> $1
           order by word_similarity($1, name) desc
           limit $2`
      : translated
        ? `select sid as id, name
           from product_translations
           where locale = $3
             and name %> $1
           order by word_similarity($1, name) desc
           limit $2`
        : `select sid as id, name
           from products
           where name %> $1
           order by word_similarity($1, name) desc
           limit $2`;
  const params = translated ? [query, RESULT_LIMIT, locale] : [query, RESULT_LIMIT];
  const { rows } = await db.query<NameRow>(sql, params);
  return rows.map((row) => ({ kind, id: row.id, name: row.name }));
}

export async function searchCatalog(query: string, locale: AppLocale) {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return {
      collections: [] as SearchHit[],
      products: [] as SearchHit[],
      tooShort: trimmed.length > 0,
    };
  }

  const db = await pool.connect();
  try {
    await db.query("begin");
    await db.query("select set_config('role', 'anon', true)");
    await db.query("select set_config('search_path', 'public, extensions', true)");
    const collections = await matchingNames(db, locale, trimmed, "collection");
    const products = await matchingNames(db, locale, trimmed, "product");
    await db.query("commit");
    return { collections, products, tooShort: false };
  } catch (error) {
    await db.query("rollback");
    throw error;
  } finally {
    db.release();
  }
}
