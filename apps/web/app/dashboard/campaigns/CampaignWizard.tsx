"use client";

import { useState } from "react";
import { createCampaign } from "./actions";

type Account = { id: string; handle: string };

const GOALS = ["Follower growth", "Engagement & saves", "Traffic & sales"];
const TONES = ["Calm & wise", "Bold & punchy", "Poetic"];
const PER_DAY = ["1", "2", "3"];
const DAYS = ["7 days", "14 days", "30 days"];

function Chips({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const sel = value === o;
        return (
          <button
            type="button"
            key={o}
            onClick={() => onChange(o)}
            className={`rounded-full border px-4 py-2 text-[13.5px] font-medium transition ${
              sel
                ? "border-accent bg-accent-soft text-accent"
                : "border-border bg-card text-muted-foreground hover:bg-muted"
            }`}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

export function CampaignWizard({ accounts }: { accounts: Account[] }) {
  const [step, setStep] = useState(1);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [goal, setGoal] = useState("Engagement & saves");
  const [tone, setTone] = useState("Calm & wise");
  const [perDay, setPerDay] = useState("1");
  const [days, setDays] = useState("7 days");
  const [refs, setRefs] = useState("");

  const handle = accounts.find((a) => a.id === accountId)?.handle ?? "account";
  const total = (parseInt(perDay, 10) || 1) * (parseInt(days, 10) || 7);
  const preview = `Campaign "${name || "Untitled"}" for @${handle} — theme: ${
    topic || "account DNA pillars"
  }. Goal: ${goal.toLowerCase()}. Tone: ${tone.toLowerCase()}. Cadence: ${perDay} post(s) per day for ${days}. Every idea de-duplicated; every image must pass the quality gate before publishing — skip, never force.`;

  const label = ["", "Campaign basics", "Reference images", "Your campaign prompt"][step];

  return (
    <form action={createCampaign} className="flex flex-col gap-5">
      {/* hidden mirrors so all fields submit regardless of visible step */}
      <input type="hidden" name="accountId" value={accountId} />
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="topic" value={topic} />
      <input type="hidden" name="goal" value={goal} />
      <input type="hidden" name="tone" value={tone} />
      <input type="hidden" name="perDay" value={perDay} />
      <input type="hidden" name="days" value={days} />
      <input type="hidden" name="refs" value={refs} />

      <div>
        <div className="text-xs font-bold tracking-widest text-accent">
          NEW CAMPAIGN · STEP {step} OF 3
        </div>
        <h1 className="mt-1 text-2xl font-bold">{label}</h1>
      </div>

      {step === 1 && (
        <div className="card flex max-w-2xl flex-col gap-5 p-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-[13.5px] font-semibold">
              Campaign name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Monsoon Discipline"
                className="rounded-lg border border-border px-3.5 py-2.5 text-sm font-normal"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-[13.5px] font-semibold">
              Account
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="rounded-lg border border-border px-3.5 py-2.5 text-sm font-normal"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>@{a.handle}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1.5 text-[13.5px] font-semibold">
            Topic / theme
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. Discipline during exam season"
              className="rounded-lg border border-border px-3.5 py-2.5 text-sm font-normal"
            />
          </label>
          <div className="flex flex-col gap-2">
            <div className="text-[13.5px] font-semibold">Goal</div>
            <Chips options={GOALS} value={goal} onChange={setGoal} />
          </div>
          <div className="flex flex-col gap-2">
            <div className="text-[13.5px] font-semibold">Tone</div>
            <Chips options={TONES} value={tone} onChange={setTone} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <div className="text-[13.5px] font-semibold">Posts per day</div>
              <Chips options={PER_DAY} value={perDay} onChange={setPerDay} />
            </div>
            <div className="flex flex-col gap-2">
              <div className="text-[13.5px] font-semibold">Duration</div>
              <Chips options={DAYS} value={days} onChange={setDays} />
            </div>
          </div>
          <div className="flex justify-end border-t border-border pt-4">
            <button type="button" onClick={() => setStep(2)} className="btn-primary">
              Next: reference images →
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="card flex max-w-2xl flex-col gap-4 p-6">
          <p className="text-sm text-muted-foreground">
            Optional — paste 1–3 image URLs that show the look you want (palette,
            texture, composition). They guide Gemini&apos;s art direction. Leave
            blank to use only the account&apos;s visual identity.
          </p>
          <textarea
            value={refs}
            onChange={(e) => setRefs(e.target.value)}
            rows={4}
            placeholder={"https://…/reference-1.jpg\nhttps://…/reference-2.jpg"}
            className="rounded-lg border border-border px-3.5 py-2.5 text-sm"
          />
          <div className="flex justify-between border-t border-border pt-4">
            <button type="button" onClick={() => setStep(1)} className="btn-secondary">← Back</button>
            <button type="button" onClick={() => setStep(3)} className="btn-primary">Next: campaign prompt →</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="card flex max-w-2xl flex-col gap-4 p-6">
          <div className="rounded-xl border border-border bg-background p-4 text-sm leading-relaxed">
            {preview}
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent">
              {total} posts total
            </span>
            <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
              Quality gate on every post
            </span>
            <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
              Uses account DNA do&apos;s/don&apos;ts
            </span>
          </div>
          <div className="flex justify-between border-t border-border pt-4">
            <button type="button" onClick={() => setStep(2)} className="btn-secondary">← Back</button>
            <button type="submit" className="btn-primary">✦ Create campaign</button>
          </div>
        </div>
      )}
    </form>
  );
}
