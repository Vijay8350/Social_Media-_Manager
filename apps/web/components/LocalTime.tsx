"use client";

import { useEffect, useState } from "react";

type Mode = "datetime" | "date";

const OPTIONS: Record<Mode, Intl.DateTimeFormatOptions> = {
  datetime: { dateStyle: "medium", timeStyle: "short" },
  date: { dateStyle: "medium" },
};

/**
 * A timestamp in the viewer's own timezone and locale.
 *
 * Formatting on the server would use the server's timezone (UTC on EC2), and
 * formatting during hydration would differ from the server HTML (React #418).
 * So the first render is a fixed en-US/UTC string — identical on server and
 * client — and the effect swaps in the local time after mount.
 */
export function LocalTime({ iso, mode = "datetime" }: { iso: string; mode?: Mode }) {
  const [local, setLocal] = useState<string | null>(null);

  useEffect(() => {
    setLocal(new Date(iso).toLocaleString(undefined, OPTIONS[mode]));
  }, [iso, mode]);

  const utc = new Date(iso).toLocaleString("en-US", { ...OPTIONS[mode], timeZone: "UTC" });
  return (
    <time dateTime={iso} title={iso}>
      {local ?? (mode === "date" ? utc : `${utc} UTC`)}
    </time>
  );
}
