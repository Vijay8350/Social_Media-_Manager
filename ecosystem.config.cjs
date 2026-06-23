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

module.exports = {
  apps: [
    {
      name: "insta-web",
      cwd: path.join(__dirname, "apps/web"),
      script: "node_modules/.bin/next",
      args: "start -p 3000",
      env: { ...sharedEnv, PORT: "3000" },
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
