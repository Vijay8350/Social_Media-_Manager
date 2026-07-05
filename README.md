# Insta Post Generator

Autonomous, multi-tenant SaaS that generates AI quote images and auto-posts them
to Instagram on a daily, per-account schedule — with zero human intervention per
post, guarded by an AI quality gate that blocks/regenerates bad posts before they
go live.

See [instagram-quote-saas-build-prompt.md](instagram-quote-saas-build-prompt.md)
for the authoritative spec and [CLAUDE.md](CLAUDE.md) for architecture notes.
Build proceeds milestone by milestone (M0–M10); the roadmap lives in the plan
file referenced in CLAUDE.md.

## Architecture

A pnpm-workspaces monorepo with two deployable units plus shared code:

```
apps/web        Next.js (App Router) + React + TS + Tailwind   → Vercel
apps/worker     BullMQ + Redis pipeline / scheduler            → Railway/Render/Fly
packages/shared types, env, provider interfaces, Supabase + crypto helpers
supabase/       SQL migrations: schema + RLS + storage bucket
```

- **Data + Auth + Storage:** Supabase (hosted). Tenant isolation via Postgres RLS;
  the worker uses the service role and scopes every query by `user_id` explicitly.
- **Providers (swappable via env):** DeepSeek = all text; Google Gemini = image
  generation + the vision quality gate.

## Prerequisites

- Node.js ≥ 20 and pnpm (`npm i -g pnpm`)
- Docker (for local Redis) — or a Redis instance
- A Supabase **cloud** project (for DB/Auth/Storage)

## Setup

```bash
pnpm install

# 1. Environment
cp .env.example .env
cp .env.example apps/web/.env.local   # Next.js reads .env.local
#   Fill in Supabase URL + keys, DeepSeek/Gemini/Meta keys, and a
#   TOKEN_ENCRYPTION_KEY:  openssl rand -base64 32

# 2. Database: apply the migration to your Supabase project
#    Supabase Studio → SQL Editor → paste supabase/migrations/0001_init.sql
#    (or use the Supabase CLI: `supabase db push`)

# 3. Redis (local)
docker compose up redis -d        # if you have Docker
# — or, no Docker (Windows): a portable Redis is installed at %LOCALAPPDATA%\Redis
pwsh -File scripts/start-redis.ps1
```

> No-Docker Windows note: a portable Redis (tporadowski build) lives in
> `%LOCALAPPDATA%\Redis`. `scripts/start-redis.ps1` starts it and pings it. It is
> Redis 5.0.14.1; BullMQ recommends 6.2+ — fine for development, upgrade to
> Memurai or WSL Redis if a later milestone needs newer features. Redis does not
> auto-start on boot — re-run the script after a reboot.

## Run (development)

```bash
pnpm dev          # web at http://localhost:3000
pnpm dev:worker   # worker: scheduler tick (15m) + analytics pull (6h)
```

Or run the worker + Redis fully in Docker:

```bash
docker compose up
```

## Useful commands

```bash
pnpm build        # build all packages
pnpm typecheck    # type-check all packages
pnpm lint         # lint all packages
pnpm test         # run tests (shared crypto, …)

# single package
pnpm --filter @insta/shared test
pnpm --filter @insta/web build
```

## Deploy

Live at **https://social.apanjob.com**. Full production runbook (single AWS EC2:
web + worker + Redis + nginx + HTTPS, PM2-managed) is in [DEPLOY.md](DEPLOY.md).
Redeploy: `git pull && pnpm install && set -a; . ./.env; set +a && pnpm --filter @insta/web build && pm2 restart ecosystem.config.cjs --update-env`.

Meta App Review checklist: [docs/APP_REVIEW.md](docs/APP_REVIEW.md).

## Status — M0–M10 built

| Milestone | What |
|-----------|------|
| M0 Scaffold | monorepo, Supabase schema + RLS + storage, auth, worker/Redis |
| M1 Instagram connect | Facebook OAuth, long-lived encrypted tokens, multi-account, disconnect |
| M2 DNA + prompts | per-account Account DNA + prompt library (CRUD) |
| M3 Content (DeepSeek) | idea → de-dup → strict-JSON text; "Generate now" |
| M4 Image (Gemini) | text baked into artwork → Supabase Storage |
| M5 Quality gate (Gemini vision) | text-fidelity/legibility/on-DNA/safety, regenerate loop, fail-closed |
| M6 Publishing | IG Graph container→publish, ≤25/24h, backoff |
| M7 Autopilot | worker scheduler + daily per-account pipeline, idempotent, jobs_log |
| M8 Analytics | insights pull → post_metrics + charts |
| M9 Billing | Stripe checkout + portal + webhook; scheduler gated on active sub |
| M10 Hardening | logging, backoff, README, App Review checklist |

**Runtime config still needed for full posting:** real Gemini key, Stripe keys
(for billing), and the `instagram_content_publish` scope (add the Instagram
product in the Meta app, then drop the `FACEBOOK_SCOPES` override).
