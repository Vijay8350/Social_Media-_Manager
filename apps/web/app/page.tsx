import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";

const STAGES = [
  { num: "STAGE 1", name: "Idea discovery", desc: "A fresh idea from your account DNA, never repeated", provider: "DeepSeek" },
  { num: "STAGE 2", name: "Quote & caption", desc: "Headline, lines, caption and hashtags in your voice", provider: "DeepSeek" },
  { num: "STAGE 3", name: "Image generation", desc: "Quote baked into artwork matching your visual identity", provider: "Gemini" },
  { num: "STAGE 4", name: "Quality gate", desc: "AI reads the image back — bad posts are blocked, never published", provider: "Gemini Vision" },
  { num: "STAGE 5", name: "Publish", desc: "Posted at your time, in your timezone, via official API", provider: "Instagram Graph" },
  { num: "STAGE 6", name: "Learn", desc: "Insights feed winning themes back into tomorrow's ideas", provider: "Analytics" },
];

const FEATURES = [
  { icon: "◈", name: "Account DNA", desc: "Persona, audience, pillars, visual identity, do's and don'ts — every generation is conditioned on your account's DNA, so posts sound like you, not a bot." },
  { icon: "✎", name: "Your prompt library", desc: "Reusable quote and image prompts you control. Enable, disable, and let the daily loop rotate them fairly — least-recently-used first." },
  { icon: "⛨", name: "Fail-closed quality gate", desc: "AI vision re-reads every rendered image for text fidelity, legibility and safety. Fails regenerate up to 3×; still failing means skip — never a bad post live." },
  { icon: "↺", name: "Analytics that feed back", desc: "Daily insight pulls surface your top-performing themes, and tomorrow's ideas lean into what your audience actually saves." },
];

const PLANS = [
  { name: "Starter", price: "$19", accounts: "1 account", extra: "Email support", popular: false },
  { name: "Growth", price: "$49", accounts: "5 accounts", extra: "Analytics feedback loop", popular: true },
  { name: "Agency", price: "$129", accounts: "20 accounts", extra: "Priority support · API access", popular: false },
];

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="mx-auto max-w-6xl px-6">
      {/* Nav */}
      <header className="flex items-center justify-between py-5">
        <Logo />
        <nav className="hidden items-center gap-6 text-sm text-muted-foreground sm:flex">
          <a href="#how" className="hover:text-foreground">How it works</a>
          <a href="#features" className="hover:text-foreground">Features</a>
          <a href="#pricing" className="hover:text-foreground">Pricing</a>
        </nav>
        <div className="flex items-center gap-2.5">
          <ThemeToggle />
          {user ? (
            <Link href="/dashboard" className="btn-primary">Dashboard</Link>
          ) : (
            <>
              <Link href="/login" className="btn-secondary">Sign in</Link>
              <Link href="/signup" className="btn-primary">Start free trial</Link>
            </>
          )}
        </div>
      </header>

      {/* Hero */}
      <section className="grid items-center gap-14 py-16 md:grid-cols-[1.1fr_.9fr]">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1.5 text-[13px] font-semibold text-accent">
            Official Instagram Graph API · zero automation hacks
          </span>
          <h1 className="mt-5 text-balance text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-[3.4rem]">
            Your quote pages, posting daily. Without you.
          </h1>
          <p className="mt-5 max-w-lg text-lg leading-relaxed text-muted-foreground">
            ApanSocial generates on-brand quote art from each account&apos;s DNA,
            runs every post through an AI quality gate, and publishes on schedule
            — fully unattended, never on uncertainty.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link href={user ? "/dashboard" : "/signup"} className="btn-primary px-6 py-3 text-base">
              {user ? "Go to dashboard" : "Start free trial"}
            </Link>
            <a href="#how" className="btn-secondary px-6 py-3 text-base">See the pipeline</a>
          </div>
          <div className="mt-7 flex flex-wrap gap-5 text-[13px] text-muted-foreground">
            <span>✓ No credit card for trial</span>
            <span>✓ Business &amp; Creator accounts</span>
            <span>✓ Fail-closed quality gate</span>
          </div>
        </div>

        {/* Sample quote card */}
        <div className="relative flex justify-center">
          <div className="flex aspect-[4/5] w-[320px] flex-col justify-between rounded-2xl border border-white/10 bg-[#211C26] p-8 shadow-xl">
            <div className="text-[11px] font-semibold tracking-[0.28em] text-[#B7A98F]">STOIC HINDI</div>
            <div className="font-quote text-3xl leading-snug text-[#F3EDE2]">Discipline outlives motivation.</div>
            <div className="flex items-center justify-between">
              <div className="mr-3 h-px flex-1 bg-[#F3EDE2]/25" />
              <div className="text-xs text-[#8E8399]">@stoic.hindi</div>
            </div>
          </div>
          <div className="absolute right-0 top-6 flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-[13px] shadow-lg">
            <span className="font-bold text-green-600">✓</span> Quality gate passed · 9.2/10
          </div>
          <div className="absolute bottom-8 left-0 flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-[13px] shadow-lg">
            <span className="text-accent">◉</span> Posted today · 8:00 AM IST
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="py-12">
        <h2 className="text-3xl font-bold">Six stages. Every day. Every account.</h2>
        <p className="mt-1.5 text-[15px] text-muted-foreground">
          The same pipeline powers the autonomous daily loop and one-click “generate now”.
        </p>
        <div className="mt-6 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-6">
          {STAGES.map((s) => (
            <div key={s.num} className="card flex flex-col gap-2 p-4">
              <div className="text-[11px] font-bold tracking-wider text-accent">{s.num}</div>
              <div className="text-sm font-bold">{s.name}</div>
              <div className="text-[12.5px] leading-snug text-muted-foreground">{s.desc}</div>
              <div className="mt-auto self-start rounded bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                {s.provider}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="grid gap-3.5 py-12 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <div key={f.name} className="card flex flex-col gap-2.5 p-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-lg text-accent">
              {f.icon}
            </div>
            <div className="font-display text-lg font-bold">{f.name}</div>
            <div className="text-[14.5px] leading-relaxed text-muted-foreground">{f.desc}</div>
          </div>
        ))}
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-12">
        <h2 className="text-center text-3xl font-bold">Simple per-account pricing</h2>
        <div className="mx-auto mt-7 grid max-w-4xl gap-3.5 md:grid-cols-3">
          {PLANS.map((p) => (
            <div
              key={p.name}
              className={`card relative flex flex-col gap-3 p-6 ${p.popular ? "border-2 border-accent" : ""}`}
            >
              {p.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-accent px-3 py-1 text-[11.5px] font-bold text-accent-foreground">
                  MOST POPULAR
                </div>
              )}
              <div className="text-base font-bold">{p.name}</div>
              <div className="flex items-baseline gap-1.5">
                <span className="font-display text-4xl font-extrabold">{p.price}</span>
                <span className="text-sm text-muted-foreground">/month</span>
              </div>
              <div className="flex flex-col gap-2 text-sm text-muted-foreground">
                <div>◈ {p.accounts}</div>
                <div>◈ Daily autonomous posting</div>
                <div>◈ AI quality gate included</div>
                <div>◈ {p.extra}</div>
              </div>
              <Link
                href={user ? "/dashboard" : "/signup"}
                className={`mt-2 text-center ${p.popular ? "btn-primary" : "btn-secondary"}`}
              >
                Start free trial
              </Link>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
