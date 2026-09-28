"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ResearchEvent, ResearchStatus } from "@insta/shared";

const PHASES: { id: ResearchStatus; label: string }[] = [
  { id: "queued", label: "Queued" },
  { id: "researching", label: "Collecting sources" },
  { id: "analyzing", label: "Extracting facts · writing · fact-checking" },
];

/** Live view of a running research job: refreshes the page every few seconds until it finishes. */
export function ResearchLive({
  status,
  log,
  since,
}: {
  status: ResearchStatus;
  log: ResearchEvent[];
  since: string | null;
}) {
  const router = useRouter();
  // null until mounted: Date.now() differs between the server render and hydration.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const refresh = setInterval(() => router.refresh(), 4000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(refresh);
      clearInterval(tick);
    };
  }, [router]);

  const elapsed =
    since && now != null ? Math.max(0, Math.round((now - new Date(since).getTime()) / 1000)) : null;
  const current = PHASES.findIndex((p) => p.id === status);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-accent/40 bg-accent-soft/40 p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" aria-hidden />
        {PHASES.map((p, i) => (
          <span key={p.id} className={i === current ? "font-semibold text-accent" : i < current ? "text-foreground" : "text-muted-foreground"}>
            {i < current ? "✓ " : ""}
            {p.label}
          </span>
        ))}
        {elapsed != null && <span className="ml-auto text-xs text-muted-foreground">{elapsed}s</span>}
      </div>
      <ol className="flex max-h-64 flex-col gap-1 overflow-y-auto text-[13px]">
        {log.map((e, i) => (
          <li key={i} className={e.level === "warn" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}>
            <span className="text-foreground">{e.step}</span>
            {e.detail ? ` — ${e.detail}` : ""}
          </li>
        ))}
      </ol>
      {status === "queued" && elapsed != null && elapsed > 60 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Still waiting for the background worker. If this doesn&apos;t start soon, the worker process may not be running.
        </p>
      )}
    </div>
  );
}
