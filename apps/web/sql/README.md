# Catalogue search

`catalog-search.sql` creates `public.search_catalog(p_query, p_locale, p_limit)` and four expression GIN indexes for name full-text search. It reuses the existing pg_trgm name indexes. Apply the file through Supabase SQL Editor before deploying the matching application code; it is safe to reapply. The function is dropped and recreated within one transaction because its image return column changes to `images text[]`. Unexpected database dependencies cause the transaction to fail instead of being removed with CASCADE.

The API uses the existing Publishable Key Supabase client and `rpc`, not a PostgreSQL connection or Secret Key. `SECURITY INVOKER` retains table RLS; only anon, authenticated and service_role receive explicit EXECUTE permission. No product or translation rows are modified by this deployment.

## Matching

- NFKC normalization, lowercasing and punctuation/space tokenization.
- Search original names and every available translation, regardless of display language.
- Use substring, simple full-text search and pg_trgm for candidate retrieval.
- Require every query token to match somewhere among the names of the same product/category; token order is irrelevant.
- Short tokens and terms containing numbers must match literally. Pure numbers use digit boundaries, so 75 does not match 750; alphanumeric dosage terms use word boundaries.
- Other tokens of at least three characters can match with word_similarity >= 0.45. The candidate threshold is 0.35, set within the RPC transaction after loading the extension library.
- Rank exact names, phrases and exact token coverage ahead of fuzzy-only matches, then apply deterministic tie-breakers. Return up to 20 products and 20 categories (RPC permits 1–50 each).
- Display the requested translation when present, otherwise the original name; deduplicate by sid/category_id before limiting.

The application rejects queries over 120 Unicode characters with HTTP 400, returns the existing empty/tooShort response for queries shorter than two characters and applies a 10-second request timeout. The RPC validates its own parameters.

Chinese currently uses literal substrings and explicit separated tokens, with trigram fallback for longer terms. This is not Chinese word segmentation or a synonym dictionary. Brand aliases, semantic ingredient synonyms and arbitrary spelling errors are not guaranteed matches. Neither PGroonga nor Elasticsearch is required by this implementation.

The SQL function changes transaction-local trigram settings, so it is declared VOLATILE even though it only reads catalogue data; invoke it via the SDK's default POST RPC. Deployment leaves existing table policies and grants unchanged.

## Request performance

- One RPC returns all card data, including full product image arrays; there is no follow-up image request.
- Exact token matches skip `word_similarity` evaluation. Candidate retrieval, fuzzy thresholds and ranking rules remain unchanged.
- Ranking includes only names and scores; full image arrays are fetched after each result kind has been limited.
- No cache or candidate truncation is introduced. Actual latency improvements require measurement on the deployed database.
