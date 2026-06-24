/**
 * PM2 process manager config for a single-box deploy (e.g. AWS EC2).
 * Runs the Next.js web app and the BullMQ worker, both fed the root .env.
 *
 *   pm2 start ecosystem.config.cjs
 *   pm2 logs           # tail both
 *   pm2 save           # persist across reboots (after `pm2 startup`)
 *
 * Prereqs on the box: Node >= 20, pnpm, Redis running, `pnpm install` done,
 * and `pnpm --filter @insta/web build` already run (next start serves .next).
 */
const path = require("node:path");

// Load the root .env into process.env so both apps inherit the same secrets.
require("dotenv").config({ path: path.join(__dirname, ".env") });

const sharedEnv = { ...process.env, NODE_ENV: "production" };

// Off the default 3000 to avoid clashing with other apps on a shared box.
// Override per-box via WEB_PORT in the root .env; nginx must proxy to the same.
const webPort = process.env.WEB_PORT || "3100";

module.exports = {
  apps: [
    {
      name: "insta-web",
      cwd: path.join(__dirname, "apps/web"),
      script: "node_modules/.bin/next",
      args: `start -p ${webPort}`,
      env: { ...sharedEnv, PORT: webPort },
      instances: 1,
      autorestart: true,
      max_memory_restart: "512M",
    },
    {
      name: "insta-worker",
      cwd: path.join(__dirname, "apps/worker"),
      script: "node_modules/.bin/tsx",
      args: "src/index.ts",
      env: sharedEnv,
      instances: 1,
      autorestart: true,
      max_memory_restart: "512M",
    },
  ],
};
