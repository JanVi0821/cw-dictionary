-- Generated from src/config.ts. All four tables have identity IDs and no foreign keys.

begin;

create schema if not exists "extensions";

create extension if not exists pg_trgm with schema "extensions";

set local search_path to "public", "extensions";

grant usage on schema "public" to anon, authenticated, service_role;

create table "public"."products" (
  id bigint generated always as identity primary key,
  "sid" text not null check (sid ~ '^[0-9]+$'),
  "name" text not null check (btrim(name) <> ''),
  "price" numeric(12,2) not null check (price >= 0),
  "images" text[] not null default '{}'::text[],
  "supplier" text ,
  "product_id" text ,
  "is_prescription" boolean not null default false,
  "category_ids" integer[] not null default '{}'::integer[],
  "additional_info" text[] not null default '{}'::text[],
  "info" jsonb not null default '{}'::jsonb check (jsonb_typeof(info) = 'object'),
  "feature_attributes" jsonb not null default '[]'::jsonb check (jsonb_typeof(feature_attributes) = 'array'),
  "key_features" text[] not null default '{}'::text[],
  "related_sids" text[] not null default '{}'::text[]
);

create unique index "products_business_key_idx" on "public"."products" ("sid");

create index "products_name_trgm_idx" on "public"."products" using gin (name gin_trgm_ops);

create index "products_category_ids_idx" on "public"."products" using gin (category_ids);

alter table "public"."products" enable row level security;

revoke all privileges on table "public"."products" from public, anon, authenticated;

grant select on table "public"."products" to anon, authenticated;

grant all privileges on table "public"."products" to service_role;

create policy public_read on "public"."products" for select to anon, authenticated using (true);

revoke all privileges on sequence "public"."products_id_seq" from public, anon, authenticated;

grant usage, select on sequence "public"."products_id_seq" to service_role;

create table "public"."product_translations" (
  id bigint generated always as identity primary key,
  "sid" text not null check (sid ~ '^[0-9]+$'),
  "locale" text not null check (btrim(locale) <> ''),
  "name" text not null check (btrim(name) <> ''),
  "additional_info" text[] not null default '{}'::text[],
  "info" jsonb not null default '{}'::jsonb check (jsonb_typeof(info) = 'object'),
  "feature_attributes" jsonb not null default '[]'::jsonb check (jsonb_typeof(feature_attributes) = 'array'),
  "key_features" text[] not null default '{}'::text[]
);

create unique index "product_translations_business_key_idx" on "public"."product_translations" ("sid", "locale");

create index "product_translations_name_trgm_idx" on "public"."product_translations" using gin (name gin_trgm_ops);

alter table "public"."product_translations" enable row level security;

revoke all privileges on table "public"."product_translations" from public, anon, authenticated;

grant select on table "public"."product_translations" to anon, authenticated;

grant all privileges on table "public"."product_translations" to service_role;

create policy public_read on "public"."product_translations" for select to anon, authenticated using (true);

revoke all privileges on sequence "public"."product_translations_id_seq" from public, anon, authenticated;

grant usage, select on sequence "public"."product_translations_id_seq" to service_role;

create table "public"."collections" (
  id bigint generated always as identity primary key,
  "collection_id" integer not null check (collection_id > 0),
  "name" text not null check (btrim(name) <> ''),
  "parent_id" integer check (parent_id > 0 and parent_id <> collection_id)
);

create unique index "collections_business_key_idx" on "public"."collections" ("collection_id");

create index "collections_name_trgm_idx" on "public"."collections" using gin (name gin_trgm_ops);

create index "collections_parent_id_idx" on "public"."collections" (parent_id, collection_id);

alter table "public"."collections" enable row level security;

revoke all privileges on table "public"."collections" from public, anon, authenticated;

grant select on table "public"."collections" to anon, authenticated;

grant all privileges on table "public"."collections" to service_role;

create policy public_read on "public"."collections" for select to anon, authenticated using (true);

revoke all privileges on sequence "public"."collections_id_seq" from public, anon, authenticated;

grant usage, select on sequence "public"."collections_id_seq" to service_role;

create table "public"."collection_translations" (
  id bigint generated always as identity primary key,
  "collection_id" integer not null check (collection_id > 0),
  "locale" text not null check (btrim(locale) <> ''),
  "name" text not null check (btrim(name) <> ''),
  "parent_id" integer check (parent_id > 0 and parent_id <> collection_id)
);

create unique index "collection_translations_business_key_idx" on "public"."collection_translations" ("collection_id", "locale");

create index "collection_translations_name_trgm_idx" on "public"."collection_translations" using gin (name gin_trgm_ops);

create index "collection_translations_parent_id_idx" on "public"."collection_translations" (parent_id, collection_id);

alter table "public"."collection_translations" enable row level security;

revoke all privileges on table "public"."collection_translations" from public, anon, authenticated;

grant select on table "public"."collection_translations" to anon, authenticated;

grant all privileges on table "public"."collection_translations" to service_role;

create policy public_read on "public"."collection_translations" for select to anon, authenticated using (true);

revoke all privileges on sequence "public"."collection_translations_id_seq" from public, anon, authenticated;

grant usage, select on sequence "public"."collection_translations_id_seq" to service_role;

commit;

