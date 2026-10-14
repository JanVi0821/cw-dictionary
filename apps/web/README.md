# web

Chemist Warehouse dictionary frontend. It uses Vinext (Next.js App Router on Vite), next-intl, Supabase, shadcn/ui, and deploys to Cloudflare Workers.

## Setup

Copy `.env.example` to `.env` and fill in the Supabase values already stored in this app directory.

```bash
pnpm --filter web generate:db-types
pnpm --filter web dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

- `pnpm --filter web dev` — Vite / Vinext development server
- `pnpm --filter web build` — production build
- `pnpm --filter web preview` — Cloudflare-local preview
- `pnpm --filter web deploy` — deploy with `vinext-cloudflare`
- `pnpm --filter web generate:db-types` — generate Supabase database types to `src/types/generated/database.types.ts`

Cloudflare Worker config lives in `cloudflare.config.ts`.
