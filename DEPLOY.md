# Deploy — GitHub + AWS EC2 (single box) + custom domain

This deploys the **whole stack on one EC2 instance**: the Next.js web app, the
BullMQ worker, Redis, and nginx (reverse proxy + HTTPS) for your domain. Source
lives on GitHub; you pull + build + run on the instance with PM2.

> Domain: **social.apanjob.com** · Repo: **github.com/Vijay8350/Social_Media-_Manager**
> Use your EC2's public IP / Elastic IP where noted.

## Architecture on the box

```
Internet ──443──> nginx ──> 127.0.0.1:3000  (PM2: insta-web  / next start)
                              127.0.0.1:6379  (Redis)  <── PM2: insta-worker (BullMQ)
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

## 3. Install runtime dependencies (on the EC2)

```bash
# Node 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git nginx redis-server

# pnpm + pm2
sudo npm i -g pnpm pm2

# Redis: enable + start
sudo systemctl enable --now redis-server
redis-cli ping            # -> PONG
```

---

## 4. Clone, configure env, install, build

```bash
cd ~
git clone https://github.com/Vijay8350/Social_Media-_Manager.git
cd Social_Media-_Manager

# Create the root .env (the source of truth for BOTH apps).
cp .env.example .env
nano .env     # fill in real values (see §7 for the domain-specific ones)

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

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/insta
sudo ln -sf /etc/nginx/sites-available/insta /etc/nginx/sites-enabled/insta
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# TLS (after DNS in §8 has propagated):
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
```

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
cd ~/insta-post-generator
git pull
pnpm install
set -a; . ./.env; set +a
pnpm --filter @insta/web build
pm2 restart ecosystem.config.cjs
```

---

## Notes
- The worker and web share one `.env`; keep secrets only there (git-ignored).
- For zero-downtime web restarts later, consider `pm2 reload insta-web`.
- Scale-out path: move Redis to ElastiCache and split the worker to its own
  instance — both already read `REDIS_URL`, so only that value changes.
