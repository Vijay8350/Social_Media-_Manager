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
pnpm dev:worker   # worker (heartbeat every 60s, proves Redis wiring)
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

## Status

**M0 — Scaffold** (current): monorepo, Supabase schema + RLS + storage, auth
(signup/login/logout, protected dashboard), worker + Redis wiring, docker-compose.

Next: M1 Instagram connect → M2 Account DNA + prompt library → M3+ generation
pipeline. See the milestone roadmap for details.
