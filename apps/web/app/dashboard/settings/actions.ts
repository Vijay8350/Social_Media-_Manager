"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  assertPublicUrl,
  encryptLlmKey,
  readLlmSettings,
  resolveLlmConfig,
  testLLMConnection,
  DEFAULT_DEEPSEEK_BASE_URL,
  type LLMConnectionResult,
  type LlmUserSettings,
} from "@insta/shared";

export type SettingsState =
  | {
      ok?: boolean;
      error?: string;
      message?: string;
      test?: Pick<LLMConnectionResult, "ok" | "message" | "models" | "balance">;
    }
  | undefined;

type Supabase = Awaited<ReturnType<typeof createClient>>;

const MODEL_RE = /^[A-Za-z0-9._:/-]{1,80}$/;

const READ_FAILED = "Couldn't load your settings — please try again.";

/**
 * The whole profiles.settings object, or null if the read failed. Never {} on
 * failure: callers write the object back, which would wipe the saved key and
 * the default account.
 */
async function loadProfileSettings(
  supabase: Supabase,
  userId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("settings")
    .eq("id", userId)
    .maybeSingle();
  if (error) return null;
  return (data?.settings as Record<string, unknown> | null) ?? {};
}

/** Replace profiles.settings.llm, keeping the other settings keys (e.g. default_account_id). */
async function writeLlmSettings(
  supabase: Supabase,
  userId: string,
  settings: Record<string, unknown>,
  llm: LlmUserSettings,
): Promise<string | null> {
  const { error } = await supabase
    .from("profiles")
    .upsert({ id: userId, settings: { ...settings, llm } }, { onConflict: "id" });
  return error?.message ?? null;
}

/**
 * Read the form into the settings it describes. A blank key keeps the saved one;
 * model and base URL are taken as shown in the form (blank = default).
 */
async function settingsFromForm(
  formData: FormData,
  saved: LlmUserSettings,
): Promise<{ next: LlmUserSettings; newKey: boolean } | { error: string }> {
  const apiKey = String(formData.get("api_key") ?? "").trim();
  const model =
    String(formData.get("custom_model") ?? "").trim() || String(formData.get("model") ?? "").trim();
  const baseRaw = String(formData.get("base_url") ?? "").trim();

  if (apiKey && (apiKey.length < 16 || apiKey.length > 256 || /\s/.test(apiKey))) {
    return { error: "That doesn't look like a DeepSeek API key (they start with sk-)." };
  }
  if (model && !MODEL_RE.test(model)) {
    return { error: "Model IDs can only contain letters, numbers and . _ : / -" };
  }

  let baseUrl: string | undefined;
  if (baseRaw) {
    if (!apiKey && !saved.api_key_encrypted) {
      return {
        error:
          "A custom base URL needs your own API key — the server's shared key is never sent to custom endpoints.",
      };
    }
    try {
      baseUrl = (await assertPublicUrl(baseRaw, { httpsOnly: true })).toString().replace(/\/+$/, "");
    } catch (err) {
      return { error: `Base URL: ${err instanceof Error ? err.message : "invalid"}` };
    }
    if (baseUrl === DEFAULT_DEEPSEEK_BASE_URL) baseUrl = undefined;
  }

  let encrypted = saved.api_key_encrypted;
  if (apiKey) {
    try {
      encrypted = encryptLlmKey(apiKey);
    } catch {
      return { error: "The server can't encrypt secrets — TOKEN_ENCRYPTION_KEY is missing or invalid." };
    }
  }

  return {
    newKey: Boolean(apiKey),
    next: {
      api_key_encrypted: encrypted,
      api_key_hint: apiKey ? apiKey.slice(-4) : saved.api_key_hint,
      model: model || undefined,
      base_url: baseUrl,
      updated_at: new Date().toISOString(),
    },
  };
}

/** What the form may show. The balance only for the user's own key — never the server's. */
function publicTest(t: LLMConnectionResult, s: LlmUserSettings): NonNullable<SettingsState>["test"] {
  return { ok: t.ok, message: t.message, models: t.models, balance: s.api_key_encrypted ? t.balance : null };
}

/** Save the DeepSeek settings, verifying the key/model first so a typo can't silently break autopilot. */
export async function saveDeepSeekSettings(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const settings = await loadProfileSettings(supabase, user.id);
  if (!settings) return { error: READ_FAILED };
  const parsed = await settingsFromForm(formData, readLlmSettings(settings));
  if ("error" in parsed) return parsed;

  let message = "Saved — no API key yet, so AI generation stays off until you add one.";
  let test: LLMConnectionResult | undefined;
  try {
    const config = resolveLlmConfig(parsed.next);
    if (config) {
      test = await testLLMConnection(config);
      if (!test.ok && (test.problem === "auth" || test.problem === "model")) {
        return { error: `Not saved: ${test.message}`, test: publicTest(test, parsed.next) };
      }
      message = test.ok ? "Saved and verified ✓" : `Saved, but couldn't verify right now: ${test.message}`;
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't read the saved key" };
  }

  const error = await writeLlmSettings(supabase, user.id, settings, parsed.next);
  if (error) return { error };

  revalidatePath("/dashboard/settings");
  return { ok: true, message, test: test && publicTest(test, parsed.next) };
}

/** Test the settings currently in the form (without saving them). */
export async function testDeepSeekSettings(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const settings = await loadProfileSettings(supabase, user.id);
  if (!settings) return { error: READ_FAILED };
  const parsed = await settingsFromForm(formData, readLlmSettings(settings));
  if ("error" in parsed) return parsed;

  try {
    const config = resolveLlmConfig(parsed.next);
    if (!config) return { error: "There's no API key to test — paste yours first." };
    const test = await testLLMConnection(config);
    return test.ok
      ? { ok: true, message: test.message, test: publicTest(test, parsed.next) }
      : { error: test.message, test: publicTest(test, parsed.next) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Test failed" };
  }
}

/** Forget the user's own key (and custom base URL, which requires it); keep their model choice. */
export async function removeDeepSeekKey(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const settings = await loadProfileSettings(supabase, user.id);
  if (!settings) {
    console.error("[removeDeepSeekKey] couldn't read profile settings; nothing changed");
    return;
  }
  const saved = readLlmSettings(settings);
  const error = await writeLlmSettings(supabase, user.id, settings, {
    model: saved.model,
    updated_at: new Date().toISOString(),
  });
  if (error) console.error("[removeDeepSeekKey] failed:", error);
  revalidatePath("/dashboard/settings");
}
