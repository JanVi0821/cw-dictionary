import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/generated/database.types";
import { routing } from "@/i18n/routing";

export type CollectionListItem = {
  collectionId: number;
  name: string;
  originalName: string | null;
  hasChildren: boolean;
};

type NamedCollection = {
  collection_id: number;
  name: string;
  originalName: string | null;
};

async function namedCollections(
  client: SupabaseClient<Database>,
  parentId: number | null,
  locale: string,
) {
  const query = client.from("collections").select("collection_id, name");
  const { data, error } = await (parentId === null
    ? query.is("parent_id", null).order("collection_id")
    : query.eq("parent_id", parentId).order("name"));
  if (error) throw error;

  const rows = (data ?? []).map((row) => ({
    collection_id: row.collection_id,
    name: row.name,
    originalName: null,
  }));
  if (locale === routing.defaultLocale || rows.length === 0) return rows;

  const { data: translations, error: translationError } = await client
    .from("collection_translations")
    .select("collection_id, name")
    .eq("locale", locale)
    .in(
      "collection_id",
      rows.map((row) => row.collection_id),
    );
  if (translationError) throw translationError;

  const names = new Map(
    (translations ?? []).map((row) => [
      row.collection_id,
      row.name,
    ]),
  );

  return rows.map((row) => {
    const translated = names.get(row.collection_id);
    return {
      ...row,
      name: translated ?? row.name,
      originalName: translated && translated !== row.name ? row.name : null,
    };
  });
}

export async function listCollectionChildren(
  client: SupabaseClient<Database>,
  parentId: number | null,
  locale: string,
): Promise<CollectionListItem[]> {
  const rows = await namedCollections(client, parentId, locale);
  if (rows.length === 0) return [];

  const { data, error } = await client
    .from("collections")
    .select("parent_id")
    .in(
      "parent_id",
      rows.map((row) => row.collection_id),
    );
  if (error) throw error;

  const parents = new Set(
    (data ?? []).map((row: { parent_id: number | null }) => row.parent_id),
  );

  return rows.map((row) => ({
    collectionId: row.collection_id,
    name: row.name,
    originalName: row.originalName,
    hasChildren: parents.has(row.collection_id),
  }));
}

export async function getCollectionName(
  client: SupabaseClient<Database>,
  collectionId: number,
  locale: string,
) {
  const { data, error } = await client
    .from("collections")
    .select("name")
    .eq("collection_id", collectionId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.name) return null;

  if (locale === routing.defaultLocale) {
    return { name: data.name, originalName: null };
  }

  const { data: translation, error: translationError } = await client
    .from("collection_translations")
    .select("name")
    .eq("collection_id", collectionId)
    .eq("locale", locale)
    .maybeSingle();
  if (translationError) throw translationError;

  const translated = translation?.name;
  if (!translated || translated === data.name) {
    return { name: data.name, originalName: null };
  }
  return { name: translated, originalName: data.name };
}
