import {
  generatedIdeaSchema,
  generatedContentSchema,
  businessDnaSchema,
  type GeneratedIdea,
  type GeneratedContentParsed,
  type BusinessDnaParsed,
} from "../schemas";
import type { AccountDna, BusinessDna } from "../types";
import {
  buildDnaSystemPrompt,
  buildIdeaUserPrompt,
  buildContentUserPrompt,
  BUSINESS_ANALYST_SYSTEM_PROMPT,
  buildBusinessDnaUserPrompt,
} from "../prompt";
import { assertPublicUrl } from "../website";

/**
 * Text provider interface. All text generation (ideas, quotes, captions,
 * hashtags, Business DNA analysis) goes through this, so the model is swappable
 * via env or per-user Settings without touching the pipeline.
 */
export interface LLMProvider {
  generateIdea(
    dna: AccountDna | null,
    promptText: string,
    recentSummaries: string[],
    business?: BusinessDna | null,
  ): Promise<GeneratedIdea>;
  generateContent(
    dna: AccountDna | null,
    idea: GeneratedIdea,
    business?: BusinessDna | null,
  ): Promise<GeneratedContentParsed>;
  /**
   * Distill Instagram + website source text into a Business DNA. `deadline`
   * (epoch ms) caps total time across retries — e.g. to answer before a proxy timeout.
   */
  analyzeBusiness(sources: string, opts?: { deadline?: number }): Promise<BusinessDnaParsed>;
}

export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";

export interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Base URL came from a user, not the server env: verify it's a public https host before use. */
  untrustedBaseUrl?: boolean;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const trimSlash = (url: string) => url.replace(/\/+$/, "");

class DeepSeekProvider implements LLMProvider {
  private hostCheck: Promise<unknown> | null = null;

  constructor(private readonly cfg: LLMConfig) {}

  /** One JSON-mode chat call; returns parsed JSON (unvalidated). */
  private async chatJson(
    messages: ChatMessage[],
    temperature: number,
    timeoutMs = 60_000,
  ): Promise<unknown> {
    if (this.cfg.untrustedBaseUrl) {
      this.hostCheck ??= assertPublicUrl(this.cfg.baseUrl, { httpsOnly: true });
      await this.hostCheck;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${trimSlash(this.cfg.baseUrl)}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: this.cfg.model,
          messages,
          temperature,
          response_format: { type: "json_object" },
        }),
        signal: controller.signal,
        // assertPublicUrl vetted only the base URL; a redirect could point anywhere.
        redirect: this.cfg.untrustedBaseUrl ? "error" : "follow",
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`DeepSeek ${res.status}: ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("DeepSeek returned empty content");
      return JSON.parse(content);
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Call + validate with up to `attempts` retries on malformed output. */
  private async chatValidated<T>(
    messages: ChatMessage[],
    temperature: number,
    validate: (raw: unknown) => T,
    attempts = 3,
    timeoutMs?: number,
    deadline?: number,
  ): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      const left = deadline ? deadline - Date.now() : Infinity;
      if (left < 5_000) break; // too little time for a useful attempt
      try {
        const raw = await this.chatJson(messages, temperature, Math.min(timeoutMs ?? 60_000, left));
        return validate(raw);
      } catch (err) {
        lastErr = err;
      }
    }
    if (lastErr === undefined) throw new Error("Ran out of time before DeepSeek could answer — try again.");
    throw new Error(
      `LLM output invalid after ${attempts} attempts: ${
        lastErr instanceof Error ? lastErr.message : String(lastErr)
      }`,
    );
  }

  async generateIdea(
    dna: AccountDna | null,
    promptText: string,
    recentSummaries: string[],
    business: BusinessDna | null = null,
  ): Promise<GeneratedIdea> {
    return this.chatValidated(
      [
        { role: "system", content: buildDnaSystemPrompt(dna, business) },
        { role: "user", content: buildIdeaUserPrompt(promptText, recentSummaries) },
      ],
      0.9,
      (raw) => generatedIdeaSchema.parse(raw),
    );
  }

  async generateContent(
    dna: AccountDna | null,
    idea: GeneratedIdea,
    business: BusinessDna | null = null,
  ): Promise<GeneratedContentParsed> {
    const parsed = await this.chatValidated(
      [
        { role: "system", content: buildDnaSystemPrompt(dna, business) },
        { role: "user", content: buildContentUserPrompt(idea) },
      ],
      0.7,
      (raw) => generatedContentSchema.parse(raw),
    );
    // Normalize hashtags: strip spaces/#, re-add a single leading '#'.
    parsed.hashtags = parsed.hashtags
      .map((h) => "#" + h.replace(/[#\s]/g, ""))
      .filter((h) => h.length > 1);
    return parsed;
  }

  async analyzeBusiness(sources: string, opts: { deadline?: number } = {}): Promise<BusinessDnaParsed> {
    return this.chatValidated(
      [
        { role: "system", content: BUSINESS_ANALYST_SYSTEM_PROMPT },
        { role: "user", content: buildBusinessDnaUserPrompt(sources) },
      ],
      0.3,
      (raw) => businessDnaSchema.parse(raw),
      2,
      90_000,
      opts.deadline,
    );
  }
}

/** The server-wide config from env (DEEPSEEK_*), or null when no key is set. */
export function envLLMConfig(): LLMConfig | null {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: process.env.DEEPSEEK_BASE_URL || DEFAULT_DEEPSEEK_BASE_URL,
    model: process.env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL,
  };
}

let cached: LLMProvider | null = null;

/**
 * Returns a text provider (DeepSeek). With no config it uses the server env;
 * request/job code should prefer getLLMProviderForUser so a manager's own key
 * and model from Settings are honored.
 */
export function getLLMProvider(config?: LLMConfig): LLMProvider {
  if (config) return new DeepSeekProvider(config);
  if (!cached) {
    const env = envLLMConfig();
    if (!env) throw new Error("DEEPSEEK_API_KEY is not set");
    cached = new DeepSeekProvider(env);
  }
  return cached;
}

export interface LLMConnectionResult {
  ok: boolean;
  /** auth = key rejected; model = key works but the model isn't available to it. */
  problem?: "auth" | "model" | "balance" | "network" | "error";
  message: string;
  models: string[];
  balance: string | null;
}

async function fetchJson(url: string, apiKey: string, timeoutMs: number, untrusted = false) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: controller.signal,
      // A user-supplied base URL was vetted once; never follow it somewhere else.
      redirect: untrusted ? "error" : "follow",
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* non-JSON body — only the status matters then */
    }
    return { status: res.status, ok: res.ok, body };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Check a DeepSeek config without spending tokens: list models (validates the
 * key) and, best-effort, read the account balance. Never echoes raw bodies.
 */
export async function testLLMConnection(cfg: LLMConfig): Promise<LLMConnectionResult> {
  const fail = (problem: LLMConnectionResult["problem"], message: string): LLMConnectionResult => ({
    ok: false,
    problem,
    message,
    models: [],
    balance: null,
  });
  try {
    if (cfg.untrustedBaseUrl) await assertPublicUrl(cfg.baseUrl, { httpsOnly: true });
    const base = trimSlash(cfg.baseUrl);
    const res = await fetchJson(`${base}/models`, cfg.apiKey, 15_000, cfg.untrustedBaseUrl);
    if (!res.ok) {
      const apiMsg = (res.body as { error?: { message?: unknown } } | null)?.error?.message;
      const detail = typeof apiMsg === "string" ? `: ${apiMsg.slice(0, 160)}` : "";
      if (res.status === 401 || res.status === 403)
        return fail("auth", `DeepSeek rejected the API key (${res.status})${detail}`);
      if (res.status === 402) return fail("balance", "This DeepSeek account has insufficient balance (402).");
      return fail("error", `DeepSeek responded ${res.status}${detail}`);
    }
    const models = ((res.body as { data?: Array<{ id?: unknown }> } | null)?.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === "string");

    let balance: string | null = null;
    try {
      const b = await fetchJson(`${base}/user/balance`, cfg.apiKey, 10_000, cfg.untrustedBaseUrl);
      const info = (
        b.body as { balance_infos?: Array<{ currency?: string; total_balance?: string }> } | null
      )?.balance_infos?.[0];
      if (b.ok && info?.total_balance) balance = `${info.total_balance} ${info.currency ?? ""}`.trim();
    } catch {
      /* balance is optional (not all compatible endpoints have it) */
    }

    if (models.length && !models.includes(cfg.model)) {
      return {
        ok: false,
        problem: "model",
        message: `Key works, but model "${cfg.model}" isn't available to it. Available: ${models.join(", ")}.`,
        models,
        balance,
      };
    }
    return { ok: true, message: `Connected — model "${cfg.model}" is ready.`, models, balance };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return fail(
      "network",
      aborted ? "DeepSeek didn't respond in time." : err instanceof Error ? err.message : "Connection failed",
    );
  }
}
