-- One-time catalogue search deployment. Application reads through Supabase RPC.
-- Does not change products, translations, existing table policies, or write grants.
begin;
create extension if not exists pg_trgm with schema extensions;
set local search_path = pg_catalog, public, extensions;

create index if not exists products_name_fts_idx
  on public.products using gin (to_tsvector('simple'::regconfig, name));
create index if not exists product_translations_name_fts_idx
  on public.product_translations using gin (to_tsvector('simple'::regconfig, name));
create index if not exists collections_name_fts_idx
  on public.collections using gin (to_tsvector('simple'::regconfig, name));
create index if not exists collection_translations_name_fts_idx
  on public.collection_translations using gin (to_tsvector('simple'::regconfig, name));

create or replace function public.search_catalog(
  p_query text,
  p_locale text default 'en',
  p_limit integer default 20
)
returns table (
  kind text,
  id text,
  name text,
  original_name text,
  image text,
  score double precision
)
language plpgsql volatile security invoker
set search_path = pg_catalog, public, extensions
set statement_timeout = '8s'
as $function$
declare
  normalized_query text;
begin
  -- Load pg_trgm before setting its USERSET parameter. A fresh backend does not
  -- register extension GUCs until the library is loaded; function SET clauses
  -- would be checked before that and can fail for non-superuser roles.
  perform word_similarity('', '');
  perform set_config('pg_trgm.word_similarity_threshold', '0.35', true);
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
  with tokens as materialized (
    select distinct token,
      -- Short tokens and numeric/dosage tokens must not be corrected fuzzily.
      char_length(token) >= 3 and token !~ '[0-9]' as allow_fuzzy
    from regexp_split_to_table(normalized_query, ' +') as token
  ), parameters as (
    select array_agg('%' || token || '%') as patterns,
      coalesce(array_agg(token) filter (where allow_fuzzy), array[]::text[]) as fuzzy_terms,
      plainto_tsquery('simple'::regconfig, normalized_query) as tsquery
    from tokens
  ), all_names as not materialized (
    -- Search every available language; only the output label follows p_locale.
    select 'product'::text as item_kind, p.sid as item_id, p.name as search_name
      from public.products p
    union all
    select 'product', t.sid, t.name from public.product_translations t
    union all
    select 'collection', c.collection_id::text, c.name from public.collections c
    union all
    select 'collection', t.collection_id::text, t.name from public.collection_translations t
  ), candidates as materialized (
    select n.* from all_names n cross join parameters v
    where n.search_name ilike any(v.patterns)
       or n.search_name %> any(v.fuzzy_terms)
       or to_tsvector('simple'::regconfig, n.search_name) @@ v.tsquery
  ), per_token as (
    select c.item_kind, c.item_id, t.token, t.allow_fuzzy,
      bool_or(case
        -- A query for 75 should not count 750 as an exact dosage match.
        when t.token ~ '^[0-9]+$'
          then c.search_name ~* ('(^|[^0-9])' || t.token || '([^0-9]|$)')
        when t.token ~ '[0-9]'
          then c.search_name ~* ('(^|[^[:alnum:]])' || t.token || '([^[:alnum:]]|$)')
        else c.search_name ilike ('%' || t.token || '%')
      end) as exact_token,
      max(case when t.allow_fuzzy then word_similarity(t.token, c.search_name) else 0 end) as fuzzy_score
    from candidates c cross join tokens t
    group by c.item_kind, c.item_id, t.token, t.allow_fuzzy
  ), token_scores as (
    select t.item_kind, t.item_id,
      bool_and(t.exact_token) as all_exact,
      avg(case when t.exact_token then 1.0 else t.fuzzy_score end) as token_score
    from per_token t
    group by t.item_kind, t.item_id
    -- Require coverage of ALL query tokens, independent of token order.
    having bool_and(t.exact_token or (t.allow_fuzzy and t.fuzzy_score >= 0.45))
  ), phrase_scores as (
    select c.item_kind, c.item_id,
      bool_or(lower(c.search_name) = normalized_query) as exact_name,
      bool_or(strpos(lower(c.search_name), normalized_query) > 0) as exact_phrase
    from candidates c group by c.item_kind, c.item_id
  ), scores as (
    select t.item_kind, t.item_id,
      (case when p.exact_name then 300 when p.exact_phrase then 200
        when t.all_exact then 100 else 0 end + 20 * t.token_score)::double precision as item_score
    from token_scores t join phrase_scores p using (item_kind, item_id)
  ), labels as (
    select s.item_kind, s.item_id, coalesce(t.name, p.name) as display_name,
      case when t.name is not null and t.name <> p.name then p.name end as english_name,
      p.images[1] as display_image, s.item_score
    from scores s join public.products p on s.item_kind='product' and p.sid=s.item_id
      left join public.product_translations t on t.sid=p.sid and t.locale=p_locale
    union all
    select s.item_kind, s.item_id, coalesce(t.name, c.name),
      case when t.name is not null and t.name <> c.name then c.name end,
      null::text, s.item_score
    from scores s join public.collections c on s.item_kind='collection' and c.collection_id::text=s.item_id
      left join public.collection_translations t on t.collection_id=c.collection_id and t.locale=p_locale
  ), ranked as (
    select l.*, row_number() over (partition by l.item_kind
      order by l.item_score desc, char_length(l.display_name), l.item_id) as position
    from labels l
  )
  select r.item_kind, r.item_id, r.display_name, r.english_name, r.display_image, r.item_score
    from ranked r where r.position <= p_limit
    order by r.item_kind, r.position;
end;
$function$;

revoke all on function public.search_catalog(text, text, integer) from public;
grant execute on function public.search_catalog(text, text, integer) to anon, authenticated, service_role;
notify pgrst, 'reload schema';
commit;
