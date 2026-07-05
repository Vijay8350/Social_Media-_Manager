"use client";

import { useActionState } from "react";
import type { AccountDna } from "@insta/shared";
import type { SaveState } from "./actions";

type BoundAction = (prev: SaveState, formData: FormData) => Promise<SaveState>;

const field = "rounded-md border border-border px-3 py-2 text-sm";
const labelCls = "flex flex-col gap-1 text-sm font-medium text-foreground";

export function DnaForm({
  action,
  dna,
}: {
  action: BoundAction;
  dna: AccountDna | null;
}) {
  const [state, formAction, pending] = useActionState<SaveState, FormData>(
    action,
    undefined,
  );
  const v = dna;
  const vi = v?.visual_identity ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        This DNA conditions every idea, caption, and image generated for this
        account. Fill it in once; you can edit anytime.
      </p>

      <label className={labelCls}>
        Persona / brand voice
        <input name="persona" defaultValue={v?.persona ?? ""} className={field}
          placeholder="e.g. dark, witty, savage but stylish" />
      </label>
      <label className={labelCls}>
        Tone
        <input name="tone" defaultValue={v?.tone ?? ""} className={field}
          placeholder="e.g. bold and playful" />
      </label>
      <label className={labelCls}>
        Target audience
        <input name="audience" defaultValue={v?.audience ?? ""} className={field}
          placeholder="e.g. Gen-Z into astrology and self-growth" />
      </label>
      <label className={labelCls}>
        Niche
        <input name="niche" defaultValue={v?.niche ?? ""} className={field}
          placeholder="e.g. zodiac / motivational quotes" />
      </label>
      <label className={labelCls}>
        Content pillars (one per line)
        <textarea name="content_pillars" rows={3} className={field}
          defaultValue={(v?.content_pillars ?? []).join("\n")}
          placeholder={"daily motivation\nzodiac traits\nsavage comebacks"} />
      </label>

      <fieldset className="rounded-md border border-border p-4">
        <legend className="px-1 text-sm font-semibold">Visual identity</legend>
        <div className="flex flex-col gap-4">
          <label className={labelCls}>
            Palette (comma-separated colors)
            <input name="palette" className={field}
              defaultValue={(vi.palette ?? []).join(", ")}
              placeholder="#0f0f0f, #e0b3ff, gold" />
          </label>
          <label className={labelCls}>
            Mood
            <input name="mood" defaultValue={vi.mood ?? ""} className={field}
              placeholder="moody, neon, dreamy" />
          </label>
          <label className={labelCls}>
            Style references
            <input name="style" defaultValue={vi.style ?? ""} className={field}
              placeholder="minimalist gradient, film grain" />
          </label>
          <label className={labelCls}>
            Font feel
            <input name="font" defaultValue={vi.font ?? ""} className={field}
              placeholder="elegant serif, bold sans" />
          </label>
          <label className={labelCls}>
            Layout preference
            <input name="layout" defaultValue={vi.layout ?? ""} className={field}
              placeholder="centered text, list layout" />
          </label>
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-4">
        <label className={labelCls}>
          Language / locale
          <input name="language" defaultValue={v?.language ?? "en"} className={field} />
        </label>
        <label className={labelCls}>
          Timezone
          <input name="timezone" defaultValue={v?.timezone ?? "UTC"} className={field}
            placeholder="Asia/Kolkata" />
        </label>
      </div>
      <label className={labelCls}>
        Default post time (24h, HH:MM)
        <input name="default_post_time" type="time" defaultValue={v?.default_post_time ?? ""}
          className={`${field} w-40`} />
      </label>

      <label className={labelCls}>
        Do&rsquo;s (one per line)
        <textarea name="dos" rows={3} className={field}
          defaultValue={(v?.dos ?? []).join("\n")}
          placeholder={"keep it under 12 words\nend with a punchy line"} />
      </label>
      <label className={labelCls}>
        Don&rsquo;ts (one per line)
        <textarea name="donts" rows={3} className={field}
          defaultValue={(v?.donts ?? []).join("\n")}
          placeholder={"no politics\nno emojis in the headline"} />
      </label>
      <label className={labelCls}>
        Example posts / captions (one per line)
        <textarea name="examples" rows={3} className={field}
          defaultValue={(v?.examples ?? []).join("\n")} />
      </label>
      <label className={labelCls}>
        Hashtag strategy
        <textarea name="hashtag_strategy" rows={2} className={field}
          defaultValue={v?.hashtag_strategy ?? ""}
          placeholder="3 broad + 4 medium + 3 niche tags in the caption" />
      </label>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          {pending ? "Saving…" : "Save DNA"}
        </button>
        {state?.ok && <span className="text-sm text-green-700">Saved ✓</span>}
        {state?.error && <span className="text-sm text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}
