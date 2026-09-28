"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { BusinessDna, ResearchDossier } from "@insta/shared";
import type { BizState } from "./actions";
import { LocalTime } from "@/components/LocalTime";
import { ResearchLive } from "./ResearchLive";

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

const CATEGORY_LABEL: Record<string, string> = {
  identity: "Who they are",
  offering: "Products & services",
  pricing: "Pricing",
  usp: "What makes them different",
  audience: "Audience",
  voice: "Voice",
  values: "Values",
  social_proof: "Proof (reviews, numbers, press)",
  policy: "Policies",
  location: "Location",
  contact: "Contact",
  visual: "Visual style",
  other: "Other",
};

/** The research file the DNA was written from: facts + evidence, voice, customers, gaps. */
function ResearchDossierView({ notes }: { notes: ResearchDossier }) {
  const byCat = new Map<string, ResearchDossier["facts"]>();
  for (const f of notes.facts) byCat.set(f.category, [...(byCat.get(f.category) ?? []), f]);
  const s = notes.stats;
  return (
    <details className="rounded-lg border border-border px-4 py-3">
      <summary className="cursor-pointer text-sm font-semibold">
        Research file — {s.facts} facts from {s.excerpts} source excerpt{s.excerpts === 1 ? "" : "s"}
        <span className="ml-2 font-normal text-muted-foreground">
          ({s.captions} captions · {s.comments} customer comments · {s.pages} website pages · {s.seconds}s)
        </span>
      </summary>
      <div className="mt-4 flex flex-col gap-4 text-[13px]">
        {notes.gaps.length > 0 && (
          <div className="rounded-md bg-amber-500/10 px-3 py-2 text-amber-800 dark:text-amber-300">
            <div className="font-semibold">The research couldn&apos;t establish:</div>
            <ul className="ml-4 list-disc">
              {notes.gaps.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          </div>
        )}
        {[...byCat].map(([cat, facts]) => (
          <div key={cat}>
            <div className="mb-1 font-semibold">{CATEGORY_LABEL[cat] ?? cat}</div>
            <ul className="flex flex-col gap-1.5">
              {facts.map((f, i) => (
                <li key={i} className="border-l-2 border-border pl-3">
                  {f.fact}
                  <span className="block text-[12px] text-muted-foreground">
                    {f.evidence ? <>&ldquo;{f.evidence}&rdquo; · </> : null}
                    {f.source}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {notes.voice_samples.length > 0 && (
          <div>
            <div className="mb-1 font-semibold">How the brand writes</div>
            <ul className="ml-4 list-disc text-muted-foreground">
              {notes.voice_samples.map((v) => (
                <li key={v}>&ldquo;{v}&rdquo;</li>
              ))}
            </ul>
          </div>
        )}
        {notes.customer_signals.length > 0 && (
          <div>
            <div className="mb-1 font-semibold">What customers say / ask</div>
            <ul className="ml-4 list-disc text-muted-foreground">
              {notes.customer_signals.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}

const RUNNING = ["queued", "researching", "analyzing"];

export function BusinessDnaView({
  accountId,
  username,
  business,
  suggestedWebsite,
  llmReady,
  researchAction,
  saveAction,
  applyAction,
}: {
  accountId: string;
  username: string;
  business: BusinessDna | null;
  suggestedWebsite: string | null;
  llmReady: boolean;
  researchAction: BoundAction;
  saveAction: BoundAction;
  applyAction: BoundAction;
}) {
  const [researchState, research, starting] = useActionState<BizState, FormData>(researchAction, undefined);
  const [saveState, save, saving] = useActionState<BizState, FormData>(saveAction, undefined);
  const [applyState, apply, applying] = useActionState<BizState, FormData>(applyAction, undefined);
  const b = business;
  const src = b?.sources;
  const status = b?.research_status ?? "idle";
  const running = RUNNING.includes(status);
  const built = Boolean(b?.generated_at);

  return (
    <div className="flex flex-col gap-5">
      {/* Deep research */}
      <section className="card flex flex-col gap-4 p-5">
        <div>
          <h2 className="text-lg font-bold">Business DNA · deep research</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Research first, then write. We collect @{username}&rsquo;s profile, 50 recent captions and
            what customers comment, and crawl your website in depth (about, products, pricing, FAQ,
            reviews, policies, contact…). DeepSeek extracts concrete facts — each backed by a quote
            from the source — writes the Business DNA only from that research, then fact-checks
            every field. Takes 1–3 minutes and runs in the background.
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

        <form action={research} className="flex flex-col gap-3">
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
            Include @{username}&rsquo;s Instagram profile, captions and customer comments
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={starting || running || !llmReady} className="btn-primary">
              {running ? "Researching…" : starting ? "Starting…" : built ? "↻ Research again" : "🔎 Start deep research"}
            </button>
            {built && !running && (
              <span className="text-xs text-muted-foreground">
                A new run replaces the fields below once it succeeds.
              </span>
            )}
          </div>
          <Status state={researchState} />
        </form>

        {running && (
          <ResearchLive
            status={status}
            log={b?.research_progress ?? []}
            since={b?.research_started_at ?? b?.research_request?.requested_at ?? null}
          />
        )}

        {status === "error" && b?.research_error && (
          <div className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600">
            The last research run failed: {b.research_error}
            {built && " Your previous Business DNA is unchanged."}
          </div>
        )}

        {!running && b?.research_notes && <ResearchDossierView notes={b.research_notes} />}

        {b?.generated_at && (
          <p className="border-t border-border pt-3 text-xs text-muted-foreground">
            Last built <LocalTime iso={b.generated_at} /> from{" "}
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

      {b && built && (
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
