# Deploy — GitHub + AWS EC2 (single box) + custom domain

This deploys the **whole stack on one EC2 instance**: the Next.js web app, the
BullMQ worker, Redis, and nginx (reverse proxy + HTTPS) for your domain. Source
lives on GitHub; you pull + build + run on the instance with PM2.

> Domain: **social.apanjob.com** · Repo: **github.com/Vijay8350/Social_Media-_Manager**
> Use your EC2's public IP / Elastic IP where noted.

> ⚠️ **Shared server (other projects already running).** This guide is
> **additive and non-destructive** — it does not remove existing nginx sites,
> does not change the default web port (uses **3100**, not 3000), and isolates
> Redis keys with a dedicated db index + `BULLMQ_PREFIX`. Before installing
> system packages, it checks what's already there so your other projects'
> Node/nginx/Redis versions aren't disturbed.

## Architecture on the box

```
Internet ──443──> nginx ──> 127.0.0.1:3100  (PM2: insta-web  / next start)
                              127.0.0.1:6379/3  (Redis db 3, prefix "insta")
                                              <── PM2: insta-worker (BullMQ)
                       both processes read the repo-root .env
```

---

## 1. Push the code to GitHub (from your Windows machine)

The repo is already git-initialised with a first commit (see bottom of this
file if not). Create an empty GitHub repo, then:

```bash
git remote add origin https://github.com/Vijay8350/Social_Media-_Manager.git
git branch -M main
git push -u origin main
```

`.env` and all secrets are git-ignored — only `.env.example` is committed.
(Already pushed — on the EC2 you just `git clone` in §4.)

---

## 2. Launch / prepare the EC2 instance

- Ubuntu 22.04 or 24.04 LTS (this guide uses `apt`; Amazon Linux works too with `dnf`).
- Instance type: `t3.small` or larger (Next build + worker + Redis).
- **Security group inbound:** `22` (SSH, your IP), `80` (HTTP), `443` (HTTPS).
- Allocate an **Elastic IP** and associate it — so the IP survives reboots (your DNS points here).

SSH in:
```bash
ssh -i your-key.pem ubuntu@<EC2_PUBLIC_IP>
```

---

## 3. Install runtime dependencies (CHECK before installing — shared box)

Run these checks first; only install what's missing so you don't change
versions your other projects rely on:

```bash
node -v        # need >= 20. If present and >=20, DO NOT reinstall.
nginx -v       # if present, it's already serving your other sites — keep it.
redis-cli ping # if PONG, reuse it (we isolate via db 3 + prefix). 
pnpm -v; pm2 -v
```

Install ONLY the missing pieces, e.g.:
```bash
# Node 20 — ONLY if node is absent or < 20 (this changes the global node!):
#   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs
# nginx / redis — ONLY if the checks above showed them missing:
#   sudo apt-get install -y nginx redis-server && sudo systemctl enable --now redis-server
# git (usually present):
#   sudo apt-get install -y git
# pnpm + pm2 are global npm tools, safe to add:
sudo npm i -g pnpm pm2
```

> If your other projects use Redis as a cache with key eviction
> (`maxmemory-policy` not `noeviction`), don't share it — run a second Redis
> for this app instead (see the note at the bottom) and point `REDIS_URL` at it.

---

## 4. Clone, configure env, install, build

```bash
cd ~
git clone https://github.com/Vijay8350/Social_Media-_Manager.git
cd Social_Media-_Manager

# Create the root .env (the source of truth for BOTH apps).
cp .env.example .env
nano .env     # fill in real values (see §7 for domain + isolation settings)

pnpm install

# NEXT_PUBLIC_* vars are inlined at build time, so load .env into the shell first:
set -a; . ./.env; set +a
pnpm --filter @insta/web build
```

---

## 5. Run with PM2

```bash
pm2 start ecosystem.config.cjs     # starts insta-web + insta-worker
pm2 logs                           # verify: web ready, worker "connected to Redis"
pm2 save                           # persist process list
pm2 startup                        # run the printed command so PM2 restarts on reboot
```

`ecosystem.config.cjs` loads the root `.env` and injects it into both processes.

---

## 6. nginx + HTTPS

Our config is a **standalone server block** matched by `server_name
social.apanjob.com`, so it lives alongside your existing vhosts without
touching them. **Do not** remove the default site or other configs.

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/insta
sudo ln -sf /etc/nginx/sites-available/insta /etc/nginx/sites-enabled/insta
# (NOTE: we do NOT touch sites-enabled/default or your other sites.)
sudo nginx -t && sudo systemctl reload nginx   # reload, not restart

# TLS (after DNS in §8 has propagated) — only issues a cert for our host:
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d social.apanjob.com
```

Certbot auto-renews via a systemd timer.

---

## 7. Domain-specific env values

In the root `.env` on the EC2, set these to your domain (then rebuild web, §4):

```
NEXT_PUBLIC_APP_URL=https://social.apanjob.com
FACEBOOK_OAUTH_REDIRECT_URI=https://social.apanjob.com/api/instagram/callback

# Isolation on the shared box:
WEB_PORT=3100                          # must match nginx proxy_pass + your free port
REDIS_URL=redis://localhost:6379/3     # dedicated db index (not 0)
BULLMQ_PREFIX=insta                    # namespaces all queue keys
```

> Confirm port 3100 is free first: `sudo ss -ltnp | grep :3100` (no output = free).
> If taken, pick another and set WEB_PORT + the nginx `proxy_pass` port to match.

Then update the external services:
- **Meta app** → Facebook Login → Valid OAuth Redirect URIs: add
  `https://social.apanjob.com/api/instagram/callback`; add `apanjob.com` to App Domains.
- **Supabase** → Authentication → URL Configuration: set **Site URL** to
  `https://social.apanjob.com` and add it to **Redirect URLs** (so email confirm /
  OAuth callbacks resolve to production, not localhost).

---

## 8. Point the domain at the EC2 (DNS, at your registrar)

Since `social.apanjob.com` is a **subdomain**, add one record at the DNS host
for `apanjob.com`:

| Type | Name (Host) | Value |
|------|-------------|-------|
| A    | `social`    | `<EC2 Elastic IP>` |

Propagation is usually minutes; verify with `dig social.apanjob.com +short`
(should return your EC2 IP).

---

## 9. Redeploy after changes

```bash
cd ~/Social_Media-_Manager
git pull
pnpm install
set -a; . ./.env; set +a
pnpm --filter @insta/web build
pm2 reload ecosystem.config.cjs        # reload = zero-downtime; only our 2 apps
```

---

## Notes
- The worker and web share one `.env`; keep secrets only there (git-ignored).
- PM2 apps are named `insta-web` / `insta-worker` — they won't collide with your
  other PM2 processes. `pm2 save` just appends ours to the saved list.
- **Dedicated Redis (if you can't share):** run a second instance on a free port
  so this app never touches your other projects' Redis:
  ```bash
  sudo cp /etc/redis/redis.conf /etc/redis/redis-insta.conf
  sudo sed -i 's/^port 6379/port 6380/; s/^# *maxmemory-policy.*/maxmemory-policy noeviction/' /etc/redis/redis-insta.conf
  sudo redis-server /etc/redis/redis-insta.conf --daemonize yes
  # then in .env:  REDIS_URL=redis://localhost:6380/0
  ```
- Scale-out path: move Redis to ElastiCache and split the worker to its own
  instance — both already read `REDIS_URL`, so only that value changes.
