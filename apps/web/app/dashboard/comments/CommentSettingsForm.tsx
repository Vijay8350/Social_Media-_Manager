"use client";

import { useActionState } from "react";
import type { CommentReplyMode } from "@insta/shared";
import type { CommentsState } from "./actions";

type Action = (prev: CommentsState, formData: FormData) => Promise<CommentsState>;

const MODES: { id: CommentReplyMode; title: string; desc: string }[] = [
  { id: "off", title: "Off", desc: "Don't reply — only moderate" },
  { id: "review", title: "Review", desc: "AI drafts replies, you approve each one" },
  { id: "auto", title: "Auto", desc: "Send AI replies automatically" },
];

export function CommentSettingsForm({
  saveAction,
  checkAction,
  enabled,
  replyMode,
  autoHide,
  dailyLimit,
}: {
  saveAction: Action;
  checkAction: Action;
  enabled: boolean;
  replyMode: CommentReplyMode;
  autoHide: boolean;
  dailyLimit: number;
}) {
  const [saveState, save, saving] = useActionState<CommentsState, FormData>(saveAction, undefined);
  const [checkState, check, checking] = useActionState<CommentsState, FormData>(checkAction, undefined);
  const state = checkState ?? saveState;

  return (
    <form action={save} className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-semibold">Replies</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {MODES.map((m) => (
            <label
              key={m.id}
              className="flex cursor-pointer flex-col gap-0.5 rounded-lg border border-border p-3 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft"
            >
              <span className="flex items-center gap-2 font-semibold">
                <input type="radio" name="reply_mode" value={m.id} defaultChecked={replyMode === m.id} className="accent-[rgb(var(--accent))]" />
                {m.title}
              </span>
              <span className="text-xs text-muted-foreground">{m.desc}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex items-start gap-2.5 text-sm">
        <input type="checkbox" name="auto_hide" defaultChecked={autoHide} className="mt-0.5 h-4 w-4 accent-[rgb(var(--accent))]" />
        <span>
          <span className="font-semibold">Hide bad comments automatically</span>
          <span className="block text-xs text-muted-foreground">
            Spam, scams, abuse and hate are hidden on Instagram when the AI is confident. They&apos;re
            listed under Flagged for you to review either way.
          </span>
        </span>
      </label>

      <label className="flex items-center gap-3 text-sm">
        <span className="font-semibold">Daily auto-reply limit</span>
        <input
          type="number"
          name="daily_reply_limit"
          min={0}
          max={200}
          defaultValue={dailyLimit}
          className="w-24 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm"
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={saving || checking} className="btn-primary">
          {saving ? "Saving…" : enabled ? "Save" : "Save & turn on"}
        </button>
        {enabled && (
          <button type="submit" formAction={check} disabled={saving || checking} className="btn-secondary">
            {checking ? "Checking…" : "Check now"}
          </button>
        )}
        {state?.ok && <span className="text-sm text-green-700 dark:text-green-400">{state.message}</span>}
        {state?.error && <span className="text-sm text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}
