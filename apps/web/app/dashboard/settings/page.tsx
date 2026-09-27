import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  DEEPSEEK_MODEL_OPTIONS,
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_MODEL,
  llmKeySource,
  readLlmSettings,
} from "@insta/shared";
import { DeepSeekSettingsForm } from "./DeepSeekSettingsForm";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase.from("profiles").select("settings").eq("id", user.id).maybeSingle();
  const s = readLlmSettings(data?.settings);
  const source = llmKeySource(s);

  const status = {
    user: { text: `Your key ••••${s.api_key_hint ?? ""}`, cls: "bg-accent-soft text-accent" },
    server: { text: "Server's shared key", cls: "bg-muted text-muted-foreground" },
    none: { text: "Not configured", cls: "bg-red-500/10 text-red-600" },
  }[source];

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Configure the AI services your posts are generated with.
      </p>

      <section className="card mt-6 flex flex-col gap-5 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold">DeepSeek · AI text</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Writes every idea, on-image quote, caption and hashtag set, and builds each
              account&rsquo;s Business DNA — for manual posts, campaigns and autopilot.
            </p>
          </div>
          <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ${status.cls}`}>
            {status.text}
          </span>
        </div>

        {source === "none" && (
          <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600">
            No DeepSeek key is set, so generation is off. Add your API key below.
          </p>
        )}

        <DeepSeekSettingsForm
          key={s.updated_at ?? "new"}
          hint={s.api_key_hint ?? null}
          model={s.model ?? ""}
          baseUrl={s.base_url ?? ""}
          serverModel={process.env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL}
          defaultBaseUrl={DEFAULT_DEEPSEEK_BASE_URL}
          modelOptions={DEEPSEEK_MODEL_OPTIONS.map((o) => ({ id: o.id, label: o.label }))}
          hasServerKey={Boolean(process.env.DEEPSEEK_API_KEY)}
        />
      </section>

      <p className="mt-4 text-xs text-muted-foreground">
        Your key is encrypted at rest (AES-256-GCM), only ever used server-side, and never shown
        again — just its last four characters. Image generation and the quality gate run on the
        server&rsquo;s Gemini key.
      </p>
    </main>
  );
}
