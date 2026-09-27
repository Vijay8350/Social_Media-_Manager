"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { BusinessDna } from "@insta/shared";
import type { BizState } from "./actions";

type BoundAction = (prev: BizState, formData: FormData) => Promise<BizState>;

const field = "rounded-md border border-border px-3 py-2 text-sm";
const labelCls = "flex flex-col gap-1 text-sm font-medium text-foreground";

function Status({ state }: { state: BizState }) {
  if (!state) return null;
  return (
    <div className="flex flex-col gap-1 text-sm">
      {state.ok && <span className="text-green-700">{state.message}</span>}
      {state.error && <span className="text-red-600">{state.error}</span>}
      {state.warnings?.map((w) => (
        <span key={w} className="text-muted-foreground">
          ⚠ {w}
        </span>
      ))}
    </div>
  );
}

function TextField({ name, label, value, placeholder }: { name: string; label: string; value: string | null; placeholder?: string }) {
  return (
    <label className={labelCls}>
      {label}
      <input name={name} defaultValue={value ?? ""} className={field} placeholder={placeholder} />
    </label>
  );
}

function ListField({ name, label, value, rows = 3 }: { name: string; label: string; value: string[]; rows?: number }) {
  return (
    <label className={labelCls}>
      {label} <span className="text-xs font-normal text-muted-foreground">(one per line)</span>
      <textarea name={name} rows={rows} defaultValue={value.join("\n")} className={field} />
    </label>
  );
}

export function BusinessDnaView({
  accountId,
  username,
  business,
  suggestedWebsite,
  llmReady,
  analyzeAction,
  saveAction,
  applyAction,
}: {
  accountId: string;
  username: string;
  business: BusinessDna | null;
  suggestedWebsite: string | null;
  llmReady: boolean;
  analyzeAction: BoundAction;
  saveAction: BoundAction;
  applyAction: BoundAction;
}) {
  const [analyzeState, analyze, analyzing] = useActionState<BizState, FormData>(analyzeAction, undefined);
  const [saveState, save, saving] = useActionState<BizState, FormData>(saveAction, undefined);
  const [applyState, apply, applying] = useActionState<BizState, FormData>(applyAction, undefined);
  const b = business;
  const src = b?.sources;

  return (
    <div className="flex flex-col gap-5">
      {/* Build from sources */}
      <section className="card flex flex-col gap-4 p-5">
        <div>
          <h2 className="text-lg font-bold">Business DNA</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            We read @{username}&rsquo;s bio and recent captions through the Instagram API, plus your
            website&rsquo;s home, about and product pages. DeepSeek turns them into a business
            profile you can edit — used when generating posts, or applied onto the Account DNA.
          </p>
        </div>

        {!llmReady && (
          <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600">
            Add a DeepSeek API key in{" "}
            <Link href="/dashboard/settings" className="font-semibold underline">
              Settings
            </Link>{" "}
            first — it powers the analysis.
          </p>
        )}

        <form action={analyze} className="flex flex-col gap-3">
          <label className={labelCls}>
            Website
            <input
              name="website_url"
              defaultValue={suggestedWebsite ?? ""}
              inputMode="url"
              className={field}
              placeholder="yourbrand.com (defaults to the link in your Instagram bio)"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="include_instagram" defaultChecked />
            Include @{username}&rsquo;s Instagram profile and recent captions
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={analyzing || !llmReady} className="btn-primary">
              {analyzing ? "Analyzing… (up to a minute)" : b ? "↻ Re-analyze" : "✨ Build Business DNA"}
            </button>
            {b && !analyzing && (
              <span className="text-xs text-muted-foreground">Re-analyzing replaces the fields below.</span>
            )}
          </div>
          <Status state={analyzeState} />
        </form>

        {b?.generated_at && (
          <p className="border-t border-border pt-3 text-xs text-muted-foreground">
            Last built {new Date(b.generated_at).toLocaleString()} from{" "}
            {[
              src?.instagram &&
                (src.instagram.error
                  ? `Instagram (failed: ${src.instagram.error})`
                  : `@${src.instagram.username} · ${src.instagram.posts_analyzed} captions`),
              src?.website &&
                (src.website.error
                  ? `${src.website.url} (failed: ${src.website.error})`
                  : `${src.website.pages.length} website page${src.website.pages.length === 1 ? "" : "s"}`),
            ]
              .filter(Boolean)
              .join(" + ") || "—"}
            .
          </p>
        )}
      </section>

      {b && (
        <>
          {/* Edit */}
          <form key={b.updated_at} action={save} className="card flex flex-col gap-5 p-5">
            <label className="flex items-start gap-2.5 rounded-md bg-muted px-3 py-2.5 text-sm">
              <input type="checkbox" name="use_in_generation" defaultChecked={b.use_in_generation} className="mt-0.5" />
              <span>
                <span className="font-semibold">Use Business DNA when generating posts</span>
                <span className="block text-xs text-muted-foreground">
                  Adds this business context to every idea and caption for @{username} — manual,
                  campaigns and autopilot — alongside the Account DNA.
                </span>
              </span>
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField name="business_name" label="Business name" value={b.business_name} />
              <TextField name="website_url" label="Website" value={b.website_url} />
              <TextField name="industry" label="Industry" value={b.industry} placeholder="e.g. handmade skincare (D2C)" />
              <TextField name="language" label="Audience language" value={b.language} placeholder="e.g. English, Hinglish" />
            </div>

            <label className={labelCls}>
              Summary
              <textarea name="summary" rows={3} defaultValue={b.summary ?? ""} className={field} />
            </label>
            <label className={labelCls}>
              Target customers
              <textarea name="target_customers" rows={2} defaultValue={b.target_customers ?? ""} className={field} />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className={labelCls}>
                Brand voice
                <textarea name="brand_voice" rows={2} defaultValue={b.brand_voice ?? ""} className={field} />
              </label>
              <label className={labelCls}>
                Tone
                <textarea name="tone" rows={2} defaultValue={b.tone ?? ""} className={field} />
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <ListField name="offerings" label="Products / services" value={b.offerings} />
              <ListField name="usps" label="What makes it different" value={b.usps} />
              <ListField name="content_themes" label="Content themes" value={b.content_themes} />
              <ListField name="key_messages" label="Key messages" value={b.key_messages} />
              <ListField name="brand_values" label="Brand values" value={b.brand_values} />
              <ListField name="ctas" label="Calls to action" value={b.ctas} />
              <ListField name="dos" label="Do's" value={b.dos} />
              <ListField name="donts" label="Don'ts" value={b.donts} />
            </div>

            <ListField name="keywords" label="Keywords / hashtag seeds" value={b.keywords} rows={4} />
            <label className={labelCls}>
              Visual cues
              <textarea name="visual_cues" rows={2} defaultValue={b.visual_cues ?? ""} className={field} placeholder="colors, aesthetic, imagery style" />
            </label>

            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" disabled={saving} className="btn-primary">
                {saving ? "Saving…" : "Save Business DNA"}
              </button>
              <Status state={saveState} />
            </div>
          </form>

          {/* Apply */}
          <form
            action={apply}
            onSubmit={(e) => {
              if (!confirm("Overwrite the Account DNA's voice, tone, audience, niche, pillars and language with this Business DNA? Do's/don'ts are merged.")) {
                e.preventDefault();
              }
            }}
            className="card flex flex-col gap-3 p-5"
          >
            <div>
              <h3 className="font-bold">Apply to Account DNA</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Fills the Account DNA from this profile: persona ← brand voice, audience ← target
                customers, niche ← industry, content pillars ← content themes, plus tone and
                language. Do&rsquo;s/don&rsquo;ts are merged; hashtag strategy and visual style are
                only filled if empty. Save your edits above first.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" disabled={applying} className="btn-secondary">
                {applying ? "Applying…" : "Apply to Account DNA"}
              </button>
              {applyState?.ok && (
                <Link href={`/dashboard/accounts/${accountId}/dna`} className="text-sm text-accent hover:underline">
                  View Account DNA →
                </Link>
              )}
            </div>
            <Status state={applyState} />
          </form>
        </>
      )}
    </div>
  );
}
