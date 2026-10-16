-- One-time catalogue search deployment. Application reads through Supabase RPC.
-- Does not change products, translations, existing table policies, or write grants.
begin;
-- PGroonga 3.2.1+ is required for typo tolerance. Resolve the installed
-- extension schema (Dashboard may install it in public or extensions).
do $setup$
declare extension_schema text;
begin
  select n.nspname into extension_schema
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pgroonga';
  if extension_schema is null then
    raise exception 'Enable the pgroonga extension before applying this file';
  end if;
  perform set_config('search_path', format('pg_catalog, public, extensions, %I', extension_schema), true);
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = extension_schema and p.proname = 'pgroonga_condition'
      and 'fuzzy_max_distance_ratio' = any(p.proargnames)
  ) then
    raise exception 'PGroonga with fuzzy_max_distance_ratio support (3.2.1+) is required';
  end if;
end;
$setup$;

create index if not exists products_name_pgroonga_idx
  on public.products using pgroonga (name);
create index if not exists product_translations_name_pgroonga_idx
  on public.product_translations using pgroonga (name);
create index if not exists collections_name_pgroonga_idx
  on public.collections using pgroonga (name);
create index if not exists collection_translations_name_pgroonga_idx
  on public.collection_translations using pgroonga (name);

-- OUT columns change from image text to images text[]. Recreate atomically;
-- do not CASCADE: unexpected database dependencies must fail the transaction.
drop function if exists public.search_catalog(text, text, integer);
create function public.search_catalog(
  p_query text,
  p_locale text default 'en',
  p_limit integer default 20
)
returns table (
  kind text,
  id text,
  name text,
  original_name text,
  images text[],
  score double precision
)
language plpgsql volatile security invoker
set search_path = pg_catalog, public, extensions
set statement_timeout = '8s'
as $function$
declare
  normalized_query text;
  fuzzy_ratio constant real := 0.2;
begin
  normalized_query := btrim(regexp_replace(lower(normalize(coalesce(p_query, ''), NFKC)), '[^[:alnum:]]+', ' ', 'g'));
  if char_length(normalized_query) < 2 then return; end if;
  if char_length(p_query) > 120 then
    raise exception 'Search query exceeds 120 characters' using errcode = '22023';
  end if;
  if p_locale is null or p_locale not in ('en', 'zh') then
    raise exception 'Unsupported search locale' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'Search limit must be between 1 and 50' using errcode = '22023';
  end if;

  return query
  -- Whitespace separates explicit user terms. PGroonga handles the scripts
  -- within each term; do not infer brand/model/dosage semantics from digits.
  with tokens as materialized (
    select token, pgroonga_query_escape(token) as query_term
    from (
      select distinct token
      from regexp_split_to_table(normalized_query, ' +') as token
    ) t
  ), ordinary_products as materialized (
    select 'product'::text as item_kind, n.sid::text as item_id,
      t.token, n.name as search_name, true as ordinary,
      pgroonga_score(n.tableoid, n.ctid) as engine_score
    from tokens t cross join lateral (
      select b.sid, b.name, b.tableoid, b.ctid
      from public.products b
      where b.name &@~ pgroonga_condition(
        t.query_term, index_name => 'products_name_pgroonga_idx'
      )
    ) n
  ),
  ordinary_product_translations as materialized (
    select 'product'::text as item_kind, n.sid::text as item_id,
      t.token, n.name as search_name, true as ordinary,
      pgroonga_score(n.tableoid, n.ctid) as engine_score
    from tokens t cross join lateral (
      select b.sid, b.name, b.tableoid, b.ctid
      from public.product_translations b
      where b.name &@~ pgroonga_condition(
        t.query_term, index_name => 'product_translations_name_pgroonga_idx'
      )
    ) n
  ),
  ordinary_collections as materialized (
    select 'collection'::text as item_kind, n.collection_id::text as item_id,
      t.token, n.name as search_name, true as ordinary,
      pgroonga_score(n.tableoid, n.ctid) as engine_score
    from tokens t cross join lateral (
      select b.collection_id, b.name, b.tableoid, b.ctid
      from public.collections b
      where b.name &@~ pgroonga_condition(
        t.query_term, index_name => 'collections_name_pgroonga_idx'
      )
    ) n
  ),
  ordinary_collection_translations as materialized (
    select 'collection'::text as item_kind, n.collection_id::text as item_id,
      t.token, n.name as search_name, true as ordinary,
      pgroonga_score(n.tableoid, n.ctid) as engine_score
    from tokens t cross join lateral (
      select b.collection_id, b.name, b.tableoid, b.ctid
      from public.collection_translations b
      where b.name &@~ pgroonga_condition(
        t.query_term, index_name => 'collection_translations_name_pgroonga_idx'
      )
    ) n
  ),
  fuzzy_products as materialized (
    select 'product'::text as item_kind, n.sid::text as item_id,
      t.token, n.name as search_name, false as ordinary,
      pgroonga_score(n.tableoid, n.ctid) as engine_score
    from tokens t cross join lateral (
      select b.sid, b.name, b.tableoid, b.ctid
      from public.products b
      where b.name &@~ pgroonga_condition(
        t.query_term, index_name => 'products_name_pgroonga_idx',
        fuzzy_max_distance_ratio => fuzzy_ratio
      )
    ) n
  ),
  fuzzy_product_translations as materialized (
    select 'product'::text as item_kind, n.sid::text as item_id,
      t.token, n.name as search_name, false as ordinary,
      pgroonga_score(n.tableoid, n.ctid) as engine_score
    from tokens t cross join lateral (
      select b.sid, b.name, b.tableoid, b.ctid
      from public.product_translations b
      where b.name &@~ pgroonga_condition(
        t.query_term, index_name => 'product_translations_name_pgroonga_idx',
        fuzzy_max_distance_ratio => fuzzy_ratio
      )
    ) n
  ),
  fuzzy_collections as materialized (
    select 'collection'::text as item_kind, n.collection_id::text as item_id,
      t.token, n.name as search_name, false as ordinary,
      pgroonga_score(n.tableoid, n.ctid) as engine_score
    from tokens t cross join lateral (
      select b.collection_id, b.name, b.tableoid, b.ctid
      from public.collections b
      where b.name &@~ pgroonga_condition(
        t.query_term, index_name => 'collections_name_pgroonga_idx',
        fuzzy_max_distance_ratio => fuzzy_ratio
      )
    ) n
  ),
  fuzzy_collection_translations as materialized (
    select 'collection'::text as item_kind, n.collection_id::text as item_id,
      t.token, n.name as search_name, false as ordinary,
      pgroonga_score(n.tableoid, n.ctid) as engine_score
    from tokens t cross join lateral (
      select b.collection_id, b.name, b.tableoid, b.ctid
      from public.collection_translations b
      where b.name &@~ pgroonga_condition(
        t.query_term, index_name => 'collection_translations_name_pgroonga_idx',
        fuzzy_max_distance_ratio => fuzzy_ratio
      )
    ) n
  ), hits as materialized (
    select * from ordinary_products
    union all
    select * from ordinary_product_translations
    union all
    select * from ordinary_collections
    union all
    select * from ordinary_collection_translations
    union all
    select * from fuzzy_products
    union all
    select * from fuzzy_product_translations
    union all
    select * from fuzzy_collections
    union all
    select * from fuzzy_collection_translations
  ), per_token as (
    -- A term can match the original or ANY translation of the same item.
    select h.item_kind, h.item_id, h.token, bool_or(h.ordinary) as ordinary,
      coalesce(max(h.engine_score) filter (where h.ordinary),
        max(h.engine_score)) as engine_score
    from hits h group by h.item_kind, h.item_id, h.token
  ), covered as (
    select t.item_kind, t.item_id,
      case when bool_and(t.ordinary) then 2 else 3 end as match_tier,
      sum(t.engine_score)::double precision as engine_score
    from per_token t group by t.item_kind, t.item_id
    having count(*) = (select count(*) from tokens)
  ), literal_names as materialized (
    -- Literal substring matches survive independently of tokenization. The
    -- normalized query contains only alphanumeric characters and spaces.
    select 'product'::text as item_kind, n.sid::text as item_id, n.name as search_name
    from public.products n
    where n.name ilike ('%' || normalized_query || '%')
    union all
    select 'product'::text as item_kind, n.sid::text as item_id, n.name as search_name
    from public.product_translations n
    where n.name ilike ('%' || normalized_query || '%')
    union all
    select 'collection'::text as item_kind, n.collection_id::text as item_id, n.name as search_name
    from public.collections n
    where n.name ilike ('%' || normalized_query || '%')
    union all
    select 'collection'::text as item_kind, n.collection_id::text as item_id, n.name as search_name
    from public.collection_translations n
    where n.name ilike ('%' || normalized_query || '%')
  ), tiers as (
    select c.item_kind, c.item_id, c.match_tier, c.engine_score from covered c
    union all
    select n.item_kind, n.item_id,
      case when lower(normalize(n.search_name, NFKC)) = normalized_query
        then 0 else 1 end, 0::double precision
    from literal_names n
  ), scores as (
    select s.item_kind, s.item_id, min(s.match_tier) as match_tier,
      max(s.engine_score) as item_score
    from tiers s group by s.item_kind, s.item_id
  ), labels as (
    select s.item_kind, s.item_id, coalesce(t.name, p.name) as display_name,
      case when t.name is not null and t.name <> p.name then p.name end as english_name,
      s.match_tier, s.item_score
    from scores s join public.products p on s.item_kind='product' and p.sid=s.item_id
      left join public.product_translations t on t.sid=p.sid and t.locale=p_locale
    union all
    select s.item_kind, s.item_id, coalesce(t.name, c.name),
      case when t.name is not null and t.name <> c.name then c.name end,
      s.match_tier, s.item_score
    from scores s join public.collections c on s.item_kind='collection' and c.collection_id::text=s.item_id
      left join public.collection_translations t on t.collection_id=c.collection_id and t.locale=p_locale
  ), ranked as (
    select l.*, row_number() over (partition by l.item_kind
      order by l.match_tier, l.item_score desc, char_length(l.display_name), l.item_id) as position
    from labels l
  ), limited as materialized (
    select r.* from ranked r where r.position <= p_limit
  )
  -- Fetch full image arrays only for the final results, preserving previews.
  select r.item_kind, r.item_id, r.display_name, r.english_name,
      coalesce(p.images, array[]::text[]), r.item_score
    from limited r left join public.products p
      on r.item_kind = 'product' and p.sid = r.item_id
    order by r.item_kind, r.position;
end;
$function$;

do $configure$
declare extension_schema text;
begin
  select n.nspname into extension_schema
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pgroonga';
  execute format(
    'alter function public.search_catalog(text, text, integer) set search_path = pg_catalog, public, extensions, %I',
    extension_schema
  );
end;
$configure$;

revoke all on function public.search_catalog(text, text, integer) from public;
grant execute on function public.search_catalog(text, text, integer) to anon, authenticated, service_role;
notify pgrst, 'reload schema';
commit;
