# Build Prompt — Autonomous Instagram Quote-Content SaaS

> Paste this whole file into an agentic coding tool (Claude Code, Cursor, etc.) as your project brief.
> Build it milestone by milestone. After each milestone, stop, summarize what was built, and give exact run/test steps before continuing.

---

## 1. Role and goal

You are a senior full-stack engineer. Build a production-grade, **multi-tenant SaaS web application** that:

- Lets each account manager (user) connect one or more Instagram accounts.
- Gives every connected account a configurable **"Account DNA"** (its persona, voice, niche, and visual identity) that drives all generation.
- **Autonomously** generates AI quote images and **auto-posts** them to each account on a daily schedule.
- Lets the manager build a **prompt library** — their own quote-idea prompts and image-idea prompts — and also **generate on demand** from any prompt/point they add.
- Runs with **zero human intervention** per post, but protected by an **automated AI quality gate** that blocks/regenerates bad posts before they go live.

Build incrementally using the milestones in section 13. Do not try to build everything at once.

---

## 2. Product summary

The product is an Instagram autopilot for quote/aesthetic content pages (launch niche: "personality / zodiac / birthday / motivational" style quote posts, but each account configures its own niche and style via its DNA).

Daily, for every active account, the system:
1. Picks a fresh content idea (no repeats), guided by the account's DNA and the manager's active quote-idea prompts.
2. Writes the on-image quote text, the caption, and hashtags.
3. Generates a finished image with the text baked into the artwork, guided by the DNA's visual identity and the manager's active image-idea prompts.
4. Runs an automated quality check; regenerates or skips if it fails.
5. Publishes the post to the account's Instagram at the configured time.
6. Pulls back performance data to inform future ideas.

The manager's job: sign up, connect Instagram, fill in the Account DNA, optionally add custom prompts, set a posting time, and pay. Everything else is automatic. The manager can also add a custom "point"/prompt at any time and have the system generate from it immediately.

---

## 3. Tech stack (use these unless you have a strong, stated reason)

- **Frontend:** Next.js (App Router) + React + TypeScript + Tailwind CSS.
- **Backend:** Next.js server actions / route handlers (Node.js, TypeScript).
- **Database + Auth + Storage:** Supabase (Postgres + Supabase Auth + Supabase Storage for generated images). Use Row Level Security for tenant isolation.
- **Background jobs + scheduling:** A separate Node worker using **BullMQ + Redis**, driven by a cron scheduler (node-cron or BullMQ repeatable jobs). Jobs must be durable and retry on failure.
- **Text generation — DeepSeek API:** all "details" writing (idea generation, quote text, captions, hashtags) and the text-reasoning part of the quality gate use the **DeepSeek API**. Put it behind an `LLMProvider` interface so another text model can be swapped via env.
- **Image generation — Google Gemini API:** generate the finished image with text baked in using the **Gemini API** (Gemini image generation / Imagen via the Gemini API). Put it behind an `ImageProvider` interface so the model can be swapped later.
- **Vision check — Google Gemini API:** the quality gate reads the text back out of the generated image using **Gemini's multimodal vision**. Put it behind a `VisionProvider` interface. Gemini covers both image generation and vision, so one Gemini key serves both.
- **Instagram posting:** **Instagram Graph API — Content Publishing**, authorized via **Facebook Login (OAuth)**. Official API only.
- **Billing:** Stripe (subscriptions + webhooks).
- **Deploy target:** Vercel for the web app; Railway/Render/Fly for the worker + Redis. Must also run locally via `docker-compose` (Postgres or Supabase local, Redis, web, worker).

> Provider summary: **DeepSeek = text**, **Gemini = image + vision**. Keep all three behind interfaces (`LLMProvider`, `ImageProvider`, `VisionProvider`) so providers are swappable without touching the pipeline.

---

## 4. Account DNA and the prompt library (manager-configurable foundation)

This is the heart of how content is tailored. Build this before the pipeline, because every generation stage reads from it.

### 4.1 Account DNA
Each connected Instagram account has one **DNA profile** the manager creates and edits. It captures the account's identity and feeds every generation call. Fields:
- Persona / brand voice and tone (e.g. "dark, witty, savage but stylish").
- Target audience.
- Niche and content pillars / recurring themes.
- Visual identity: palette, mood, style references, font feel, layout preferences.
- Language / locale.
- Do's and don'ts (hard constraints the generator must respect).
- A few example posts/captions to anchor the style.
- Default posting time + timezone + hashtag strategy.

Every idea, quote, and image generation prompt is built **from this DNA**. If multiple accounts are connected, each has its own independent DNA.

### 4.2 Prompt library (manager's own prompts)
The manager can add, edit, enable/disable, and delete their own reusable prompts, of two types:
- **Quote-idea prompts** — seed prompts/topics/angles that steer the text idea generator (e.g. "compare zodiac signs as types of friends", "monthly horoscope with a savage twist").
- **Image-idea prompts** — image style/scene prompt templates that steer the image generator (e.g. "moody neon gradient background, minimalist serif text, centered list layout").

Generation behavior:
- The **autonomous daily pipeline** rotates through the account's *active* quote-idea and image-idea prompts (blended with the DNA), avoiding recent repeats.
- The manager can also **"generate now from this prompt/point"**: pick a library prompt or type an ad-hoc point, and immediately run the pipeline (idea → text → image → QA) for that input, producing a previewed/queued post.

Store usage so the rotation is fair and de-duplicated.

---

## 5. The autonomous pipeline (runs per account, once per day)

Implement each stage as a discrete, independently-testable job step conditioned on the account's DNA + active prompts. The full daily run is a chain of these.

### Stage 1 — Idea and trend discovery
- Generate a single fresh post idea via **DeepSeek**, conditioned on the account's DNA and a selected active quote-idea prompt (rotated).
- De-duplicate against everything already posted/queued for that account (store a normalized hash of each idea/quote). Never repeat.
- Optionally enrich with lightweight, configurable seed themes. Do not scrape sites that forbid it.
- Output: a structured `idea` object (theme, angle, format).

### Stage 2 — Content generation
- **DeepSeek** takes the `idea` + DNA and returns **strict JSON**: `{ headline, lines[], caption, hashtags[] }`.
  - `headline` + `lines` = the text that goes on the image.
  - `caption` = the Instagram caption (in the DNA's voice/language).
  - `hashtags` = mix of broad/medium/niche tags per the DNA's hashtag strategy.
- Validate the JSON; retry generation if malformed. Enforce the DNA's do's and don'ts.

### Stage 3 — Image generation (Gemini, text baked in)
- Build a **Gemini** image prompt from the DNA's visual identity + a selected active image-idea prompt + the exact `headline`/`lines` text to render.
- Call the Gemini API to generate the image with the text baked in.
- Save the result to Supabase Storage; store the URL on the queued post.
- This stage may sometimes produce garbled or misspelled text — Stage 4 catches that.

### Stage 4 — Automated quality gate (critical)
This replaces a human reviewer. A post may only publish if it passes.

Run a **Gemini vision** check on the generated image plus the intended text, scoring:
1. **Text fidelity (most important):** read the text actually rendered in the image and compare it to the intended `headline` + `lines`. Fail on garbled, misspelled, missing, duplicated, or unreadable text.
2. **Legibility:** text contrasts with background and is readable.
3. **On-topic / on-DNA:** image matches the intended theme and the account's visual identity.
4. **Safety/brand:** no NSFW, offensive, or nonsensical content; no broken artifacts; respects the DNA's don'ts.

Return a structured verdict `{ pass, reasons[], score }` (Gemini vision reads the image; DeepSeek or Gemini can do the reasoning/scoring).

- If **fail** → regenerate the image (Stage 3) and re-check, up to `MAX_REGEN_ATTEMPTS` (default 3).
- If still failing → **skip today's post** for that account, log it, notify the manager. Never publish a failed post.

### Stage 5 — Publish to Instagram
- Instagram Graph API Content Publishing flow:
  1. Create a media **container** (`POST /{ig-user-id}/media` with image URL + caption).
  2. **Publish** the container (`POST /{ig-user-id}/media_publish`).
- Respect the per-account limit (~25 API posts / 24h) with exponential backoff on rate-limit errors.
- Post at the account's configured time/timezone. Stagger accounts so the worker doesn't fire everything at once.
- Store the returned media ID + timestamp on success.

### Stage 6 — Analytics pull
- Periodically fetch insights for recent posts (likes, reach, saves, comments where available).
- Store metrics. Feed top-performing themes/prompts back into Stage 1 so the idea generator favors what works.

---

## 6. Multi-tenancy and accounts

- Email/password + OAuth signup via Supabase Auth.
- Every domain table carries a `user_id`; enforce isolation with Postgres **Row Level Security**. The worker uses a service role and must scope every query by `user_id` explicitly.
- A manager can connect one or more Instagram (Business/Creator) accounts via Facebook Login (number of accounts can be gated by plan). Store each long-lived access token **encrypted at rest** and refresh before expiry.
- Managers can disconnect an account and delete their data (handle token revocation).

---

## 7. Instagram integration details (read carefully)

- Each Instagram account must be a **Business or Creator** account connected to a **Facebook Page**. Surface clear in-app instructions; detect and explain if a connected account isn't eligible.
- Auth via Facebook Login OAuth; request the permissions needed for publishing and insights (`instagram_basic`, `instagram_content_publish`, `pages_show_list`, plus insights scopes). Implement OAuth redirect + token exchange + long-lived token upgrade.
- **Meta App Review reality — build for it:** until Meta approves the app for public use, it runs in **development mode**, where only the app owner's account and explicitly added **test/role accounts** can post. So:
  - Make it work end-to-end for the owner + whitelisted test accounts now.
  - Document an App Review submission checklist (business verification, demo video, privacy policy URL) for later.
  - Do not gate the codebase on review.
- Implement token refresh, expiry handling, and graceful re-auth prompts when a token becomes invalid.

---

## 8. Data model (Postgres — adjust names as needed, keep the shape)

- `profiles` — user/manager profile, plan tier, settings.
- `instagram_accounts` — `user_id`, ig_user_id, page_id, encrypted_token, token_expiry, status.
- `account_dna` — `account_id` (FK instagram_accounts), persona, tone, audience, niche, content_pillars[], visual_identity (palette, mood, style, font, layout), language, dos[], donts[], examples[], default_post_time, timezone, hashtag_strategy.
- `prompt_library` — `account_id`, type (`quote_idea` | `image_idea`), label, prompt_text, active (bool), last_used_at, use_count.
- `content_ideas` — `account_id`, idea JSON, source_prompt_id, normalized_hash (unique per account for de-dup), status.
- `posts` — `account_id`, idea_id, headline, lines, caption, hashtags, image_url, status (`queued`|`generating`|`qa_failed`|`published`|`skipped`), qa_score, qa_reasons, ig_media_id, scheduled_for, published_at, regen_attempts, origin (`auto` | `manual`).
- `post_metrics` — post_id, likes, reach, saves, comments, fetched_at.
- `jobs_log` — audit of pipeline runs, errors, skips.
- `subscriptions` — Stripe customer/subscription IDs, plan, status.

Enable RLS on all user-owned tables (scope by `user_id`, joining through `instagram_accounts` where the table is account-scoped).

---

## 9. Dashboard / UI pages

- **Onboarding:** connect Instagram → fill Account DNA → (optional) add prompts → set post time/timezone → choose plan.
- **Dashboard home:** next scheduled post (preview), recent posts with status, quick stats. Account switcher if multiple accounts.
- **Account DNA:** create/edit the DNA profile per account (persona, voice, audience, niche, pillars, visual identity, language, do's/don'ts, examples, posting defaults).
- **Prompt library:** add/edit/enable/disable/delete quote-idea prompts and image-idea prompts; a **"Generate now"** action that runs the pipeline from a chosen prompt or an ad-hoc typed point and shows the result.
- **Content queue:** upcoming/generated posts with image preview, caption, QA status. Read-only by default (fully autonomous), with an optional "pause autopilot" toggle and per-post "regenerate"/"skip".
- **Analytics:** charts of likes/reach/saves over time; top-performing posts/themes/prompts.
- **Account/billing:** plan, Stripe customer portal, Instagram connection status, disconnect, delete account.

Clean, modern UI. Sentence-case copy, no clutter.

---

## 10. Background jobs and scheduling

- A scheduler enqueues a daily job per active, paid, non-paused account at (or shortly before) its post time, accounting for timezone.
- Each daily job runs the Stage 1→6 chain with **idempotency** (re-running a day must not double-post) and **retries with backoff** on transient failures.
- Manual "Generate now from this prompt/point" enqueues an on-demand pipeline run for one account.
- Stagger enqueues to spread load and avoid hammering external APIs.
- All job outcomes (success/skip/error) are written to `jobs_log`.
- Every external call (DeepSeek, Gemini, Graph API) is timeout-bounded and retried on transient errors only.

---

## 11. Billing (Stripe)

- Subscription plans (e.g. Free trial / Starter / Pro), gating things like posts per day, number of connected accounts, prompt-library size, or analytics depth.
- Stripe Checkout for signup, Stripe Customer Portal for management, and a **webhook** handler to keep `subscriptions` in sync (created/updated/canceled/past_due).
- The scheduler only runs the pipeline for accounts whose manager has an active/trialing subscription.

---

## 12. Security and compliance (hard requirements)

- **Never** hardcode secrets or expose them to the client. All keys in env / Supabase vault; server-side only.
- **Official Instagram Graph API only.** No browser automation, headless login, or private Instagram APIs — it violates Instagram's terms and risks bans.
- Encrypt stored Instagram access tokens at rest.
- Enforce per-user data isolation with RLS; the worker scopes every query by `user_id`.
- Respect Instagram rate limits (≤25 posts/account/24h) with backoff.
- Provide account disconnect + full data deletion (and token revocation).
- Validate and sanitize all model JSON output before use.
- Log errors with enough context to debug, but never log secrets or full tokens.

---

## 13. Build milestones (do in order; stop and report after each)

- **M0 — Scaffold:** Next.js + TS + Tailwind app, Supabase project, DB schema + RLS, auth (signup/login/logout), `docker-compose` for local (Redis + worker), `.env.example`. Running skeleton.
- **M1 — Instagram connect:** Facebook Login OAuth, token exchange + long-lived upgrade, store encrypted token, show connection status. Works for owner/test accounts in dev mode. Support multiple accounts per manager.
- **M2 — Account DNA + prompt library:** DNA management UI + table; prompt library UI + table (quote-idea + image-idea prompts, enable/disable). No generation yet — just CRUD and storage, scoped per account.
- **M3 — Content generation (DeepSeek):** Stage 1 + 2 conditioned on DNA + active quote-idea prompts → structured `{headline, lines, caption, hashtags}`, de-dup, store as a queued post, show in the content queue. Include "Generate now from a chosen prompt/point" for the text step.
- **M4 — Image generation (Gemini):** Stage 3. Gemini image gen behind `ImageProvider`, conditioned on DNA visual identity + active image-idea prompts, save to Storage, preview in queue. Wire the full "Generate now" path end-to-end (text → image).
- **M5 — Quality gate (Gemini vision):** Stage 4. Vision text-fidelity + legibility + on-DNA + safety check, regenerate loop (max attempts), skip + notify on persistent failure. Surface QA status in UI.
- **M6 — Publishing:** Stage 5. Manual "publish now" button first to verify the container→publish flow against a real test account, then confirm.
- **M7 — Autopilot:** scheduler wired to M3–M6 so the full daily loop runs automatically per account, with idempotency, retries, staggering, prompt rotation, and `jobs_log`.
- **M8 — Analytics:** Stage 6. Pull insights, store metrics, charts in UI, feed top themes/prompts back into idea generation.
- **M9 — Billing:** Stripe Checkout + Portal + webhooks; gate the scheduler on active subscription.
- **M10 — Hardening:** error handling, rate-limit backoff, logging, monitoring hooks, deploy configs (Vercel + worker host), README, and an App Review submission checklist.

---

## 14. Deliverables

- A clean, typed monorepo (web app + worker), with:
  - `README.md` — architecture overview + local setup + deploy steps.
  - `.env.example` — every required key with placeholder + one-line description.
  - Provider interfaces (`LLMProvider`, `ImageProvider`, `VisionProvider`) so models are swappable.
  - Reasonable tests for the pipeline stages and the quality gate.
- After each milestone: a short summary of what was built and exact commands to run and test it.

---

## 15. Required environment variables (fill in placeholders)

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `DEEPSEEK_API_KEY` (text generation)
- `GEMINI_API_KEY` (image generation + vision quality gate)
- `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `FACEBOOK_OAUTH_REDIRECT_URI`
- `REDIS_URL`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*`
- `TOKEN_ENCRYPTION_KEY`
- `MAX_REGEN_ATTEMPTS` (default 3)

---

## 16. Notes for the agent

- Provider routing: **DeepSeek for all text**, **Gemini for image generation and for the quality-gate vision read-back**. Keep them behind `LLMProvider` / `ImageProvider` / `VisionProvider`.
- Account DNA + the active prompt library must condition every generation call — they are the foundation, not an afterthought. Build M2 before generation.
- Support both modes: the autonomous daily pipeline (rotating active prompts) and on-demand "generate from this prompt/point."
- When you need a real API key or external account, pause and ask me — use `.env.example` placeholders meanwhile.
- Keep functions small, typed, and testable. Handle errors explicitly; fail closed (never publish on uncertainty).
- The quality gate is the safety net for unattended posting — make it strict, especially on text fidelity, since text is baked into the image.
- Build for the dev-mode Instagram constraint now; document App Review for later. Do not block on it.
