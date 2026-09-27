import {
  generatedIdeaSchema,
  generatedContentSchema,
  businessDnaSchema,
  commentReviewSchema,
  sanitizeCommentReply,
  type GeneratedIdea,
  type GeneratedContentParsed,
  type BusinessDnaParsed,
  type CommentReviewParsed,
} from "../schemas";
import type { AccountDna, BusinessDna } from "../types";
import {
  buildDnaSystemPrompt,
  buildIdeaUserPrompt,
  buildContentUserPrompt,
  BUSINESS_ANALYST_SYSTEM_PROMPT,
  buildBusinessDnaUserPrompt,
  buildCommentReviewSystemPrompt,
  buildCommentReviewUserPrompt,
  type CommentForReview,
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
  /**
   * Review comments (Comments feature): a verdict per comment and a safe reply
   * draft for non-bad ones. Only ids that were asked about come back.
   */
  reviewComments(
    comments: CommentForReview[],
    dna: AccountDna | null,
    business?: BusinessDna | null,
  ): Promise<CommentReviewParsed[]>;
}

export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-flash";

/**
 * Replacement order when a configured model isn't available to a key — DeepSeek
 * renames models between generations (deepseek-chat → deepseek-flash). Fast chat
 * models first; anything else the key lists comes after.
 */
const PREFERRED_DEEPSEEK_MODELS = [
  "deepseek-flash",
  "deepseek-v4-flash",
  "deepseek-chat",
  "deepseek-v4-pro",
  "deepseek-reasoner",
];

/** The best model in a key's /models list, or null when the list is empty. */
export function pickDeepSeekModel(available: string[]): string | null {
  return PREFERRED_DEEPSEEK_MODELS.find((m) => available.includes(m)) ?? available[0] ?? null;
}

function modelIds(body: unknown): string[] {
  return ((body as { data?: Array<{ id?: unknown }> } | null)?.data ?? [])
    .map((m) => m.id)
    .filter((id): id is string => typeof id === "string");
}

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
  /** Set once the configured model turns out not to exist for this key. */
  private fallbackModel: string | null = null;

  /** A model this key has, if the configured one isn't among them; else null. */
  private async replacementModel(): Promise<string | null> {
    try {
      const res = await fetchJson(
        `${trimSlash(this.cfg.baseUrl)}/models`,
        this.cfg.apiKey,
        15_000,
        this.cfg.untrustedBaseUrl,
      );
      if (!res.ok) return null;
      const ids = modelIds(res.body);
      return ids.length && !ids.includes(this.cfg.model) ? pickDeepSeekModel(ids) : null;
    } catch {
      return null;
    }
  }

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
          model: this.fallbackModel ?? this.cfg.model,
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
        // Unknown model (e.g. 400 "Model Not Exist" after a DeepSeek rename): switch
        // once to a model the key does have and retry, rather than fail every post.
        // replacementModel() confirms against /models, so other 400s never switch.
        if (!this.fallbackModel && (res.status === 400 || res.status === 404) && /model/i.test(body)) {
          const next = await this.replacementModel();
          if (next) {
            console.warn(`[llm] model "${this.cfg.model}" isn't available to this key; using "${next}"`);
            this.fallbackModel = next;
            return this.chatJson(messages, temperature, timeoutMs);
          }
        }
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

  async reviewComments(
    comments: CommentForReview[],
    dna: AccountDna | null,
    business: BusinessDna | null = null,
  ): Promise<CommentReviewParsed[]> {
    if (!comments.length) return [];
    const results = await this.chatValidated(
      [
        { role: "system", content: buildCommentReviewSystemPrompt(dna, business) },
        { role: "user", content: buildCommentReviewUserPrompt(comments) },
      ],
      0.4,
      (raw) => commentReviewSchema.parse(raw).results,
      2,
    );
    // Only ids we asked about, once each; bad comments never get a reply.
    const asked = new Set(comments.map((c) => c.id));
    const out = new Map<string, CommentReviewParsed>();
    for (const r of results) {
      if (!asked.has(r.id) || out.has(r.id)) continue;
      const bad = r.verdict === "bad";
      out.set(r.id, {
        ...r,
        category: bad ? (r.category ?? "other") : null,
        reply: bad ? null : sanitizeCommentReply(r.reply),
      });
    }
    return [...out.values()];
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
  /** With problem "model": the best model this key does have. */
  suggestedModel?: string;
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
    const models = modelIds(res.body);

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
        suggestedModel: pickDeepSeekModel(models) ?? undefined,
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
