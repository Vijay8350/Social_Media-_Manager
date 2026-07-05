import {
  generatedIdeaSchema,
  generatedContentSchema,
  type GeneratedIdea,
  type GeneratedContentParsed,
} from "../schemas";
import type { AccountDna } from "../types";
import {
  buildDnaSystemPrompt,
  buildIdeaUserPrompt,
  buildContentUserPrompt,
} from "../prompt";

/**
 * Text provider interface. All text generation (ideas, quotes, captions,
 * hashtags, and later the quality-gate reasoning) goes through this, so the
 * model is swappable via env without touching the pipeline.
 */
export interface LLMProvider {
  generateIdea(
    dna: AccountDna | null,
    promptText: string,
    recentSummaries: string[],
  ): Promise<GeneratedIdea>;
  generateContent(
    dna: AccountDna | null,
    idea: GeneratedIdea,
  ): Promise<GeneratedContentParsed>;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

class DeepSeekProvider implements LLMProvider {
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor() {
    const key = process.env.DEEPSEEK_API_KEY;
    if (!key) throw new Error("DEEPSEEK_API_KEY is not set");
    this.apiKey = key;
    this.baseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
    this.model = process.env.DEEPSEEK_MODEL || "deepseek-chat";
  }

  /** One JSON-mode chat call; returns parsed JSON (unvalidated). */
  private async chatJson(
    messages: ChatMessage[],
    temperature: number,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature,
          response_format: { type: "json_object" },
        }),
        signal: controller.signal,
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
  ): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        const raw = await this.chatJson(messages, temperature);
        return validate(raw);
      } catch (err) {
        lastErr = err;
      }
    }
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
  ): Promise<GeneratedIdea> {
    return this.chatValidated(
      [
        { role: "system", content: buildDnaSystemPrompt(dna) },
        { role: "user", content: buildIdeaUserPrompt(promptText, recentSummaries) },
      ],
      0.9,
      (raw) => generatedIdeaSchema.parse(raw),
    );
  }

  async generateContent(
    dna: AccountDna | null,
    idea: GeneratedIdea,
  ): Promise<GeneratedContentParsed> {
    const parsed = await this.chatValidated(
      [
        { role: "system", content: buildDnaSystemPrompt(dna) },
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
}

let cached: LLMProvider | null = null;

/** Returns the configured text provider (DeepSeek). Swap here to change models. */
export function getLLMProvider(): LLMProvider {
  if (!cached) cached = new DeepSeekProvider();
  return cached;
}
