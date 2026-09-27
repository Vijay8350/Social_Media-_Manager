import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret, encryptSecret } from "./crypto";
import {
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_MODEL,
  envLLMConfig,
  getLLMProvider,
  type LLMConfig,
  type LLMProvider,
} from "./providers/llm";

/**
 * Per-user DeepSeek settings, stored at `profiles.settings.llm` (Settings page).
 * The API key is AES-256-GCM encrypted with TOKEN_ENCRYPTION_KEY; only its last
 * four characters are kept in clear for display.
 */
export interface LlmUserSettings {
  api_key_encrypted?: string;
  api_key_hint?: string;
  model?: string;
  base_url?: string;
  updated_at?: string;
}

/** Models offered in Settings (any model id the key can access is accepted). */
export const DEEPSEEK_MODEL_OPTIONS = [
  { id: "deepseek-chat", label: "deepseek-chat — fast, great for captions (recommended)" },
  { id: "deepseek-reasoner", label: "deepseek-reasoner — thinks before answering; slower" },
] as const;

/** Safely read the llm block out of a profiles.settings jsonb value. */
export function readLlmSettings(profileSettings: unknown): LlmUserSettings {
  const raw = (profileSettings as { llm?: unknown } | null)?.llm;
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const str = (k: string) => (typeof r[k] === "string" && r[k] ? (r[k] as string) : undefined);
  return {
    api_key_encrypted: str("api_key_encrypted"),
    api_key_hint: str("api_key_hint"),
    model: str("model"),
    base_url: str("base_url"),
    updated_at: str("updated_at"),
  };
}

// Keys are tagged before encryption. profiles.settings is user-writable (RLS), so
// without the tag a user could paste any ciphertext they can read — e.g. their
// encrypted Instagram page token — and have the server decrypt it and send it as
// a Bearer token to their own custom base URL.
const LLM_KEY_TAG = "llm-key:v1:";

/** Encrypt a user's DeepSeek API key for profiles.settings.llm.api_key_encrypted. */
export function encryptLlmKey(apiKey: string): string {
  return encryptSecret(LLM_KEY_TAG + apiKey);
}

/** Decrypt a value from encryptLlmKey; throws on anything else. */
export function decryptLlmKey(payload: string): string {
  const plain = decryptSecret(payload);
  if (!plain.startsWith(LLM_KEY_TAG)) throw new Error("Not an encrypted DeepSeek key");
  return plain.slice(LLM_KEY_TAG.length);
}

export type LlmKeySource = "user" | "server" | "none";

/** Whose key generation will run on. */
export function llmKeySource(s: LlmUserSettings): LlmKeySource {
  if (s.api_key_encrypted) return "user";
  return process.env.DEEPSEEK_API_KEY ? "server" : "none";
}

/**
 * The effective DeepSeek config for a user. Their own key wins (with their model
 * and base URL); otherwise the server key from env is used with their model
 * choice. The server key is never sent to a user-supplied base URL.
 */
export function resolveLlmConfig(s: LlmUserSettings): LLMConfig | null {
  const env = envLLMConfig();
  const envBase = process.env.DEEPSEEK_BASE_URL || DEFAULT_DEEPSEEK_BASE_URL;
  const envModel = process.env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL;
  if (s.api_key_encrypted) {
    let apiKey: string;
    try {
      apiKey = decryptLlmKey(s.api_key_encrypted);
    } catch {
      throw new Error(
        "Your saved DeepSeek API key can't be decrypted (the server's encryption key changed) — re-enter it in Settings.",
      );
    }
    return {
      apiKey,
      baseUrl: s.base_url || envBase,
      model: s.model || envModel,
      untrustedBaseUrl: Boolean(s.base_url),
    };
  }
  if (!env) return null;
  return { ...env, model: s.model || env.model };
}

/** Load a user's LLM settings (works with an RLS session or the service role). */
export async function loadLlmSettings(
  client: SupabaseClient,
  userId: string,
): Promise<LlmUserSettings> {
  const { data, error } = await client.from("profiles").select("settings").eq("id", userId).maybeSingle();
  // Fail rather than return {}: that would silently bill a user's run to the server key.
  if (error) throw new Error(`Couldn't load DeepSeek settings: ${error.message}`);
  return readLlmSettings(data?.settings);
}

/**
 * The text provider for a user — use this (not getLLMProvider()) in request and
 * job code so each manager's key/model from Settings is honored.
 */
export async function getLLMProviderForUser(
  client: SupabaseClient,
  userId: string,
): Promise<LLMProvider> {
  const config = resolveLlmConfig(await loadLlmSettings(client, userId));
  if (!config) throw new Error("No DeepSeek API key configured — add yours in Settings.");
  return getLLMProvider(config);
}
