"use client";

import { useActionState, useState } from "react";
import { saveSchedule, type ScheduleState } from "./actions";

type BoundAction = (prev: ScheduleState, formData: FormData) => Promise<ScheduleState>;

export function ScheduleForm({
  action,
  initialSlots,
  initialAutonomous,
  initialTimezone,
}: {
  action: BoundAction;
  initialSlots: string[];
  initialAutonomous: boolean;
  initialTimezone: string;
}) {
  const [state, formAction, pending] = useActionState<ScheduleState, FormData>(action, undefined);
  const [slots, setSlots] = useState<string[]>(
    initialSlots.length ? initialSlots : ["08:00"],
  );

  const setSlot = (i: number, v: string) =>
    setSlots((s) => s.map((x, j) => (j === i ? v : x)));
  const addSlot = () => setSlots((s) => (s.length >= 5 ? s : [...s, "12:00"]));
  const removeSlot = (i: number) => setSlots((s) => s.filter((_, j) => j !== i));

  return (
    <form action={formAction} className="grid max-w-3xl gap-3.5 sm:grid-cols-2">
      <div className="card flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between">
          <div className="text-sm font-bold">Daily posting slots</div>
          <input
            name="timezone"
            defaultValue={initialTimezone}
            className="w-32 rounded-lg border border-border px-2.5 py-1 text-xs"
            placeholder="Asia/Kolkata"
          />
        </div>
        <div className="flex flex-col gap-2">
          {slots.map((slot, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                name="slot"
                type="time"
                value={slot}
                onChange={(e) => setSlot(i, e.target.value)}
                className="flex-1 rounded-lg border border-border px-3 py-2 text-sm font-semibold"
              />
              <button
                type="button"
                onClick={() => removeSlot(i)}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-red-600 hover:bg-muted"
                aria-label="Remove slot"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        {slots.length < 5 && (
          <button
            type="button"
            onClick={addSlot}
            className="rounded-lg border border-dashed border-border py-2 text-[13px] font-semibold text-muted-foreground hover:bg-muted"
          >
            ＋ Add time slot
          </button>
        )}
        <p className="text-[12.5px] text-muted-foreground">
          Each slot publishes one post. Slots are staggered automatically and
          capped well under Instagram&apos;s ~25 posts/24h limit.
        </p>
      </div>

      <div className="card flex flex-col gap-4 p-5">
        <label className="flex items-center justify-between">
          <span>
            <span className="block text-sm font-bold">Autonomous mode</span>
            <span className="text-[12.5px] text-muted-foreground">
              Post automatically each day, zero touch
            </span>
          </span>
          <input
            type="checkbox"
            name="autonomous"
            defaultChecked={initialAutonomous}
            className="h-5 w-5 accent-[rgb(var(--accent))]"
          />
        </label>
        <div className="flex items-center justify-between border-t border-border pt-4">
          <span>
            <span className="block text-sm font-bold">Max regen attempts</span>
            <span className="text-[12.5px] text-muted-foreground">
              Before a post is skipped, never forced
            </span>
          </span>
          <span className="rounded-lg border border-border px-3.5 py-1.5 text-sm font-bold">3</span>
        </div>
        <div className="mt-auto flex items-center gap-3">
          <button type="submit" disabled={pending} className="btn-primary">
            {pending ? "Saving…" : "Save schedule"}
          </button>
          {state?.ok && <span className="text-sm text-green-600">Saved ✓</span>}
          {state?.error && <span className="text-sm text-red-600">{state.error}</span>}
        </div>
      </div>
    </form>
  );
}
