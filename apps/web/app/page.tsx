import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

const FEATURES = [
  {
    title: "Account DNA",
    body: "Give each account a persona, niche, and visual identity. Every idea, caption, and image is generated from it.",
  },
  {
    title: "Autonomous pipeline",
    body: "Idea → text → image with the words baked in → publish. Runs daily per account, zero human touch per post.",
  },
  {
    title: "AI quality gate",
    body: "A vision model reads the text back off every image and blocks or regenerates anything garbled. Fail-closed.",
  },
  {
    title: "Prompt library",
    body: "Your reusable quote-idea and image-idea prompts, rotated fairly and de-duplicated so posts never repeat.",
  },
  {
    title: "Official Graph API",
    body: "Publishes through the Instagram Graph API — Business/Creator accounts, rate-limit aware, no automation hacks.",
  },
  {
    title: "Analytics feedback",
    body: "Pulls likes, reach, and saves back in so the idea engine learns what performs.",
  },
];

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main>
      {/* Nav */}
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <span className="text-sm font-semibold tracking-tight">
          Social Media Manager
        </span>
        <nav className="flex items-center gap-2 text-sm">
          {user ? (
            <Link href="/dashboard" className="btn-primary">
              Dashboard
            </Link>
          ) : (
            <>
              <Link href="/login" className="btn-secondary">
                Log in
              </Link>
              <Link href="/signup" className="btn-primary">
                Get started
              </Link>
            </>
          )}
        </nav>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-3xl px-6 pb-16 pt-16 text-center sm:pt-24">
        <span className="inline-block rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
          Autonomous Instagram content, on autopilot
        </span>
        <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-5xl">
          AI quote posts that publish themselves —{" "}
          <span className="text-accent">without the bad ones getting out.</span>
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-lg text-muted-foreground">
          Generate on-brand quote images and auto-post them to Instagram on a
          daily, per-account schedule. An AI quality gate blocks or regenerates
          anything off before it ever goes live.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          {user ? (
            <Link href="/dashboard" className="btn-primary">
              Go to dashboard
            </Link>
          ) : (
            <>
              <Link href="/signup" className="btn-primary">
                Get started free
              </Link>
              <Link href="/login" className="btn-secondary">
                Log in
              </Link>
            </>
          )}
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-5xl px-6 pb-24">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="card p-5">
              <h3 className="text-sm font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
