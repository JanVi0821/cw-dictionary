# Catalogue search

Apply `catalog-search.sql` in the target project's Supabase SQL Editor. It requires the already enabled PGroonga extension with `fuzzy_max_distance_ratio` support (3.2.1+); the script checks support before changing anything. It resolves the extension's installed schema and creates four `name` PGroonga indexes, one for each original/translation table.

The script atomically recreates `public.search_catalog(p_query, p_locale, p_limit)` with `images text[]`. It does not use CASCADE, modify catalogue rows, or change existing table RLS/write policies. Existing trigram indexes are retained for literal substring searches. The four obsolete `name_fts_idx` expression indexes are removed because the RPC no longer uses `to_tsvector`.

## Matching

- NFKC normalization, lowercasing, and punctuation-to-space normalization.
- Split only at explicit whitespace. PGroonga's default TokenBigram handles mixed scripts within each term. No custom brand, dosage, or numeric word-boundary inference remains.
- Each normalized, lowercase alphanumeric user term is escaped before being passed to PGroonga; user input cannot introduce Groonga operators or query syntax.
- Search original names and every available translation. All distinct query terms must match somewhere among the names of the same business item, irrespective of term order or display locale.
- Ordinary matches and typo-tolerant matches use separate PGroonga queries. `fuzzy_ratio` in the RPC is the edit-distance ratio, currently `0.2`; this is NOT the former trigram similarity threshold. Larger values allow more spelling differences, including potentially different numeric/model terms.
- Independently preserve literal continuous substring matches, including `A2全脂` inside `A2全脂奶粉 1公斤`. These matches cannot be discarded by the term coverage step.
- Match tiers, in order: entire name, continuous substring, all terms matched ordinarily, terms requiring typo tolerance. Within a tier, use aggregated PGroonga scores, then display name length and business ID as deterministic tie-breakers.
- Terms are aggregated by sid/collection_id before limiting, so matching several translations does not produce duplicate cards. Each term uses the strongest ordinary score if available, otherwise its strongest fuzzy score; term scores are summed. Returned `score` is the engine score, not an encoding of the match tier.
- PGroonga scores can be zero when PostgreSQL chooses a sequential scan. Tier ordering and deterministic tie-breakers still apply; inspect execution plans if score-based ranking is ineffective.

This is lexical search, not semantic search or a synonym dictionary. It does not infer medical equivalence, recognize doses, or promise that numerically similar product variants are equivalent.

## API and permissions

The application continues using the Publishable Key Supabase client and `rpc`. No application change or additional request is needed. The RPC returns `kind`, `id`, `name`, `original_name`, `images`, and `score`; only `images` is supported, not the old `image` field. Product image arrays are fetched after ranking and limiting; categories return an empty array.

`p_locale` supports `en` and `zh`, controlling only the displayed translation, with original-name fallback. The RPC allows 1–50 results per kind; the application requests 20 products and 20 categories. Queries shorter than two normalized characters return no results; inputs longer than 120 characters are rejected. The client has a 10-second request timeout.

`SECURITY INVOKER` retains caller table permissions and RLS. Execute is explicitly granted to anon, authenticated, and service_role, and revoked from PUBLIC. The function's search path includes the actual extension schema. The schema cache reload notification is committed together with the function update.

## Deployment status

Deployed to project `xrubgevqbtdnynyntqcn` on 2026-10-16 through the Jan0822 Dashboard session (PGroonga 3.2.5, schema `extensions`). The SQL Editor confirmed success. Publishable Key RPC requests returned `A2全脂奶粉 1公斤` for `A2全脂` with four images, and Blackmores products/categories for the misspelled `blackmors`. These are individual operational checks, not a search quality benchmark.

Apply this file to other target databases before using the application. Writing this file alone does not deploy the RPC; the deployed return field must be `images text[]`.
