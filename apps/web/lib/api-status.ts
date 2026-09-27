import { createHash } from "node:crypto";
import {
  resolveLlmConfig,
  testLLMConnection,
  type LLMConfig,
  type LlmUserSettings,
} from "@insta/shared";
import { getInstagramConfig } from "./instagram-config";

/**
 * Live connection checks for the account Overview + Comments pages (server-only).
 * Keys travel in headers, never in URLs, so they can't leak into logs.
 */

export type CheckState = "ok" | "error" | "off";
export interface Check {
  state: CheckState;
  detail: string;
}

const TIMEOUT_MS = 6000;

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.name === "TimeoutError" ? "timed out" : e.message;
  return "request failed";
}

/** Permissions the app needs today (connect, read, publish) and for planned comment automation. */
export const CORE_SCOPES = [
  "instagram_basic",
  "pages_show_list",
  "pages_read_engagement",
  "instagram_content_publish",
];
export const COMMENT_SCOPE = "instagram_manage_comments";

export interface TokenStatus {
  valid: boolean;
  error: string | null;
  scopes: string[];
  /** null = never expires (Page tokens from a long-lived user token). */
  expiresAt: Date | null;
  dataAccessExpiresAt: Date | null;
}

/** Ask Meta whether a stored token is still valid, when it expires, and which scopes it carries. */
export async function inspectToken(token: string): Promise<TokenStatus> {
  const cfg = getInstagramConfig();
  const url = new URL(`https://graph.facebook.com/${cfg.version}/debug_token`);
  url.searchParams.set("input_token", token);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${cfg.appId}|${cfg.appSecret}` },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.json()) as {
    data?: {
      is_valid?: boolean;
      scopes?: string[];
      expires_at?: number;
      data_access_expires_at?: number;
      error?: { message?: string };
    };
    error?: { message?: string };
  };
  if (!res.ok || body.error || !body.data) {
    throw new Error(body.error?.message ?? `debug_token failed (${res.status})`);
  }
  const d = body.data;
  return {
    valid: Boolean(d.is_valid),
    error: d.error?.message ?? null,
    scopes: d.scopes ?? [],
    expiresAt: d.expires_at ? new Date(d.expires_at * 1000) : null,
    dataAccessExpiresAt: d.data_access_expires_at ? new Date(d.data_access_expires_at * 1000) : null,
  };
}

// System API checks are account-independent — memoize briefly so tab switching doesn't hammer them.
const memo = new Map<string, { at: number; value: Promise<Check> }>();
function cached(key: string, fn: () => Promise<Check>, ttlMs = 60_000): Promise<Check> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = fn();
  memo.set(key, { at: Date.now(), value });
  return value;
}

/**
 * DeepSeek (all text generation) for this user: checks the same config generation
 * uses — their own key from Settings if saved, else the server key.
 */
export function checkDeepSeek(settings: LlmUserSettings): Promise<Check> {
  let cfg: LLMConfig | null;
  try {
    cfg = resolveLlmConfig(settings);
  } catch (e) {
    return Promise.resolve({ state: "error", detail: errMsg(e) });
  }
  if (!cfg) return Promise.resolve({ state: "off", detail: "No DeepSeek API key — add yours in Settings." });
  const source = settings.api_key_encrypted ? "your key" : "server key";
  const resolved = cfg;
  // Cache per effective config; hash so the key itself is never held as a map key.
  const id = createHash("sha256")
    .update(`${resolved.baseUrl}|${resolved.model}|${resolved.apiKey}`)
    .digest("hex");
  return cached(`deepseek:${id}`, async () => {
    const r = await testLLMConnection(resolved);
    if (r.ok) return { state: "ok", detail: `${resolved.model} · ${source}` };
    // Generation switches to an available model on its own, so this still works.
    if (r.problem === "model" && r.suggestedModel) {
      return {
        state: "ok",
        detail: `${r.suggestedModel} · ${source} ("${resolved.model}" isn't available — set a model in Settings)`,
      };
    }
    return { state: "error", detail: `${r.message} (${source})` };
  });
}

/** Gemini (image generation + quality gate): key accepted and both configured models exist. */
export function checkGemini(): Promise<Check> {
  return cached("gemini", async () => {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return { state: "off", detail: "GEMINI_API_KEY not set" };
    const models = [
      process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image",
      process.env.GEMINI_VISION_MODEL || "gemini-2.5-flash",
    ];
    try {
      for (const model of models) {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}`,
          {
            headers: { "x-goog-api-key": key },
            cache: "no-store",
            signal: AbortSignal.timeout(TIMEOUT_MS),
          },
        );
        if (res.status === 404) return { state: "error", detail: `model "${model}" not found` };
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
          const msg = body?.error?.message ?? `HTTP ${res.status}`;
          return { state: "error", detail: /api key/i.test(msg) ? "API key rejected" : msg };
        }
      }
      return { state: "ok", detail: models.join(" + ") };
    } catch (e) {
      return { state: "error", detail: errMsg(e) };
    }
  });
}
