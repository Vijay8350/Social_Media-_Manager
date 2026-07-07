# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

**All milestones M0–M10 are built** and the app is deployed live at **https://social.apanjob.com** (single AWS EC2: web + worker + Redis + nginx + HTTPS via PM2 — see [DEPLOY.md](DEPLOY.md)). The repo is a pnpm-workspaces monorepo: `apps/web` (Next.js App Router + Tailwind + Supabase auth + the full generation/publish UI), `apps/worker` (BullMQ scheduler + daily pipeline + analytics), `packages/shared` (types, env, crypto, Supabase clients, provider impls, prompt builders), and `supabase/migrations/0001_init.sql`.

- **Providers implemented in `packages/shared/src/providers`:** `llm.ts` (DeepSeek text), `image.ts` (Gemini image), `vision.ts` (Gemini quality gate), `instagram.ts` (Graph publish + insights).
- **Manual flow** lives in `apps/web` server actions (`.../accounts/[id]/content/actions.ts`): generate text → image+QA → publish. **Autonomous flow** lives in `apps/worker` (`scheduler.ts` + `pipeline.ts`) running the same stages via the service role.
- **Runtime config still needed for full posting:** real Gemini key, Stripe keys (billing), and re-enabling `instagram_content_publish` (add the Instagram product in the Meta app, drop the `FACEBOOK_SCOPES` override). See the memory files under this project for live-state details.

The [build prompt](instagram-quote-saas-build-prompt.md) remains the authoritative spec. Redeploy after changes: `git pull && pnpm install && set -a; . ./.env; set +a && pnpm --filter @insta/web build && pm2 restart ecosystem.config.cjs --update-env`.

## What is being built

A multi-tenant SaaS that autonomously generates AI quote images and auto-posts them to Instagram on a daily, per-account schedule, with **zero human intervention per post** — protected by an automated AI quality gate that blocks/regenerates bad posts before they go live.

## Intended architecture

A typed monorepo with two deployable units:
- **Web app** — Next.js (App Router) + React + TypeScript + Tailwind. Server actions / route handlers are the backend.
- **Worker** — separate Node process running the pipeline via **BullMQ + Redis**, scheduled with BullMQ repeatable jobs (`apps/worker/src/scheduler.ts`).

**Actual deployment (not Vercel/Railway):** both units run on **one AWS EC2** box managed by **PM2** (`ecosystem.config.cjs`, fork mode) behind **nginx** (`deploy/nginx.conf`) with Let's Encrypt HTTPS; Redis runs on the same box. The box is **shared with other apps**, so this app is isolated: web on **port 3200** (`WEB_PORT`), Redis keyed to a **dedicated db index + `BULLMQ_PREFIX`**, and its own nginx server block. Full runbook in [DEPLOY.md](DEPLOY.md). The build brief's original targets (Vercel / Railway / docker-compose) were superseded by this single-box setup.

**Data + Auth + Storage:** Supabase (Postgres + Auth + Storage). Tenant isolation is enforced with Postgres **Row Level Security**; every domain table carries `user_id`, and account-scoped tables join through `instagram_accounts`. The worker uses the service role and must **explicitly scope every query by `user_id`** (RLS does not protect service-role queries).

### Provider routing (keep all three behind interfaces so models are swappable via env)
- **`LLMProvider` → DeepSeek** — all text: idea generation, quote text, captions, hashtags, and the reasoning/scoring half of the quality gate.
- **`ImageProvider` → Google Gemini** — generates the finished image with the quote text baked into the artwork.
- **`VisionProvider` → Google Gemini** — the quality gate's multimodal read-back of the rendered image. One Gemini key serves both image gen and vision.

### The two foundations (build before generation — milestone M2)
Every generation call is conditioned on these; they are not an afterthought:
1. **Account DNA** (`account_dna` table) — per-account persona/voice, audience, niche, content pillars, visual identity (palette/mood/style/font/layout), language, do's/don'ts, example posts, posting defaults.
2. **Prompt library** (`prompt_library` table) — the manager's own reusable `quote_idea` and `image_idea` prompts, each enable/disable-able, with `last_used_at`/`use_count` for fair, de-duplicated rotation.

### The pipeline (per account; stages are discrete, independently-testable job steps)
1. **Idea discovery** (DeepSeek) — one fresh idea from DNA + a rotated active quote-idea prompt; de-dup against a per-account `normalized_hash`, never repeat.
2. **Content generation** (DeepSeek) — returns **strict JSON** `{ headline, lines[], caption, hashtags[] }`; validate and retry on malformed output; enforce DNA do's/don'ts.
3. **Image generation** (Gemini) — prompt built from DNA visual identity + active image-idea prompt + exact `headline`/`lines` to render; save to Supabase Storage.
4. **Quality gate** (Gemini vision) — scores text fidelity (most important — text is baked into the image), legibility, on-DNA/on-topic, safety. Verdict `{ pass, reasons[], score }`. On fail → regenerate (Stage 3) up to `MAX_REGEN_ATTEMPTS` (default 3); if still failing → **skip the post, log, notify**. **Never publish a failed post.**
5. **Publish** (Instagram Graph API Content Publishing) — create media container → publish container. Respect ~25 posts/account/24h with exponential backoff; post at the account's configured time/timezone; stagger accounts.
6. **Analytics pull** — fetch insights for recent posts, store metrics, feed top-performing themes/prompts back into Stage 1.

Two run modes share this pipeline: the **autonomous daily loop** (rotates active prompts) and on-demand **"Generate now from this prompt/point"** (one account, immediate).

## Hard constraints (from the brief — do not violate)

- **Official Instagram Graph API only.** No browser automation, headless login, or private Instagram APIs.
- **Fail closed:** never publish on uncertainty. The quality gate is the safety net for unattended posting — make it strict, especially on text fidelity.
- Each Instagram account must be a **Business/Creator** account linked to a Facebook Page; auth via Facebook Login OAuth. Build for Meta **dev-mode** now (only owner + whitelisted test accounts can post); document App Review for later but **do not gate the codebase on it**.
- Encrypt Instagram access tokens at rest (`TOKEN_ENCRYPTION_KEY`); refresh long-lived tokens before expiry; handle re-auth gracefully.
- Daily jobs must be **idempotent** (re-running a day must not double-post) and retry transient failures with backoff. All outcomes go to `jobs_log`.
- The scheduler only runs for accounts whose manager has an active/trialing Stripe subscription.
- Validate and sanitize all model JSON before use. Never log secrets or full tokens.

## Data model

See §8 of the brief for table shapes: `profiles`, `instagram_accounts`, `account_dna`, `prompt_library`, `content_ideas`, `posts`, `post_metrics`, `jobs_log`, `subscriptions`. Enable RLS on all user-owned tables.

## Environment variables

See §15 of the brief. Maintain a `.env.example` with every key and a one-line description. Key groups: Supabase (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`), `DEEPSEEK_API_KEY`, `GEMINI_API_KEY`, Facebook (`FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `FACEBOOK_OAUTH_REDIRECT_URI`), `REDIS_URL`, Stripe (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*`), `TOKEN_ENCRYPTION_KEY`, `MAX_REGEN_ATTEMPTS` (default 3).

Deploy/isolation-specific (see `.env.example` + DEPLOY.md): `WEB_PORT` (default 3200), `BULLMQ_PREFIX` (namespaces queue keys on the shared Redis), and `FACEBOOK_SCOPES` (comma-separated override — currently drops `instagram_content_publish` until the Instagram product is added to the Meta app; must be restored for publishing). NEXT_PUBLIC_* vars are inlined at **build** time, so `set -a; . ./.env; set +a` before `pnpm --filter @insta/web build`.

## Commands

Run from the repo root (pnpm workspaces). Node ≥ 20; `pnpm install` first.

- `pnpm dev` — web app at http://localhost:3000 (`apps/web`)
- `pnpm dev:worker` — worker: scheduler (enqueues daily per-account pipeline runs) + analytics puller; needs Redis running
- `pnpm build` / `pnpm typecheck` / `pnpm lint` — across all packages (`pnpm -r`)
- `pnpm test` — all tests; single package: `pnpm --filter @insta/shared test`
- single test file: `pnpm --filter @insta/shared exec vitest run src/crypto.test.ts`
- Redis (local): `docker compose up redis -d` **or**, on this machine (no Docker), a portable Redis lives in `%LOCALAPPDATA%\Redis` — start it with `pwsh -File scripts/start-redis.ps1` (Redis 5.0.14.1; does not auto-start on boot)

**Env:** copy `.env.example` → `.env` (root, for the worker) **and** → `apps/web/.env.local` (Next.js reads `.env.local`). The web build requires `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` to be present.

**DB:** apply `supabase/migrations/0001_init.sql` via Supabase Studio SQL editor (or `supabase db push`).

### Conventions worth knowing
- `packages/shared` is consumed as TypeScript source (not built); `apps/web` lists it under `transpilePackages`. ESM throughout — use **extensionless** relative imports inside `shared` (e.g. `export * from "./types"`), so tsc, Next/webpack, and tsx all resolve them. Do not add `.js` extensions: Next's webpack build can't map them back to `.ts` and fails with "Module not found".
- The worker passes BullMQ a **connection-options object** (`apps/worker/src/redis.ts`), not an ioredis instance, so it uses BullMQ's bundled ioredis and avoids dual-version type clashes. Don't add a direct `ioredis` dependency back.
- `noUncheckedIndexedAccess` is on — array/record index access is `T | undefined`.
- **UI theming:** light/dark via CSS-variable tokens (`apps/web/app/globals.css`, `tailwind.config.ts` `darkMode:"class"`). A no-flash script in `layout.tsx` sets the class before paint; `ThemeToggle` (footer) persists to `localStorage`. Style with the **semantic** Tailwind classes — `bg-background`, `text-foreground`, `bg-card`, `text-muted-foreground`, `border-border`, `bg-primary`/`text-primary-foreground`, `bg-muted`, `text-accent`, or the `.card`/`.btn-primary`/`.btn-secondary` component classes — **never** hardcoded `neutral-*`/`white`, or dark mode breaks.
- The web app writes generated images to the private `post-images` bucket using the **service-role** client (`createServiceRoleClient`) because bucket writes bypass RLS; DB access stays on the user's RLS session. Owners read images via short-lived signed URLs.
- **Server env changes need `pm2 restart ecosystem.config.cjs --update-env`** — a plain `pm2 reload <name>` keeps the env cached from process start (this bit us with `FACEBOOK_APP_ID`). Code-only changes are fine with `pnpm --filter @insta/web build && pm2 reload insta-web`.
- Free-tier Supabase **pauses after inactivity** (DNS stops resolving) — if auth/DB suddenly fails everywhere, resume the project in the Supabase dashboard.
