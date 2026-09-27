import type { CheckState } from "@/lib/api-status";

const STYLES: Record<CheckState, { dot: string; text: string }> = {
  ok: { dot: "bg-green-500", text: "text-green-700 dark:text-green-400" },
  error: { dot: "bg-red-500", text: "text-red-600 dark:text-red-400" },
  off: { dot: "bg-muted-foreground/50", text: "text-muted-foreground" },
};

/** Coloured dot + label for a live connection check. */
export function StatusDot({ state, label }: { state: CheckState; label: string }) {
  const s = STYLES[state];
  return (
    <span className={`inline-flex items-center gap-1.5 font-medium ${s.text}`}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${s.dot}`} aria-hidden />
      {label}
    </span>
  );
}
