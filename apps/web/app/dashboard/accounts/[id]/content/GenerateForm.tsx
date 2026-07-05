"use client";

import { useActionState } from "react";
import type { GenState } from "./actions";

type BoundAction = (prev: GenState, formData: FormData) => Promise<GenState>;
type PromptOption = { id: string; label: string };

export function GenerateForm({
  action,
  prompts,
}: {
  action: BoundAction;
  prompts: PromptOption[];
}) {
  const [state, formAction, pending] = useActionState<GenState, FormData>(
    action,
    undefined,
  );

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded-lg border border-border p-4"
    >
      <h3 className="text-sm font-semibold">Generate now</h3>
      <p className="text-xs text-muted-foreground">
        Pick one of your active quote-idea prompts, or type an ad-hoc point. This
        runs idea → text (DeepSeek) and queues a post. Image comes in the next
        milestone.
      </p>

      <label className="flex flex-col gap-1 text-sm">
        Use a prompt
        <select
          name="promptId"
          className="rounded-md border border-border px-3 py-2 text-sm"
          defaultValue=""
        >
          <option value="">— none —</option>
          {prompts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        …or type an ad-hoc point (overrides the prompt above)
        <textarea
          name="adhoc"
          rows={2}
          placeholder="e.g. a savage take on Mondays for Scorpios"
          className="rounded-md border border-border px-3 py-2 text-sm"
        />
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {pending ? "Generating…" : "Generate"}
        </button>
        {state?.ok && (
          <span className="text-sm text-green-700">Queued a new post ✓</span>
        )}
        {state?.error && (
          <span className="text-sm text-red-600">{state.error}</span>
        )}
      </div>
    </form>
  );
}
