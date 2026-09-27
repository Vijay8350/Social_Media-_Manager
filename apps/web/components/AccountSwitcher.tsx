"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export type SwitcherAccount = { id: string; username: string; status: string };

function Avatar({ username }: { username: string }) {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent">
      {(username[0] ?? "@").toUpperCase()}
    </span>
  );
}

/**
 * Sidebar dropdown to pick the Instagram account you're working on. On an
 * account page it keeps the current tab (e.g. /content) when switching;
 * elsewhere it opens the account's overview. Defaults to the saved default.
 */
export function AccountSwitcher({
  accounts,
  defaultAccountId,
}: {
  accounts: SwitcherAccount[];
  defaultAccountId: string | null;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (accounts.length === 0) {
    return (
      <a
        href="/api/instagram/connect"
        className="mb-3 rounded-lg border border-dashed border-border px-3 py-2.5 text-center text-[13px] text-muted-foreground hover:bg-muted"
      >
        ＋ Connect Instagram
      </a>
    );
  }

  const match = /^\/dashboard\/accounts\/([^/]+)(\/.*)?$/.exec(pathname);
  const currentId = match?.[1] ?? defaultAccountId;
  const tab = match?.[2] ?? "";
  const current = accounts.find((a) => a.id === currentId) ?? accounts[0]!;

  return (
    <div ref={ref} className="relative mb-3">
      <div className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Instagram account
      </div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-background px-2.5 py-2 text-left transition hover:bg-muted"
      >
        <Avatar username={current.username} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
          @{current.username}
        </span>
        {current.id === defaultAccountId && (
          <span className="text-xs text-accent" title="Default account">★</span>
        )}
        <span className="text-xs text-muted-foreground">▾</span>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 right-0 z-20 mt-1.5 flex max-h-80 flex-col overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-lg"
        >
          {accounts.map((a) => (
            <Link
              key={a.id}
              href={`/dashboard/accounts/${a.id}${tab}`}
              role="option"
              aria-selected={a.id === current.id}
              className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] transition hover:bg-muted ${
                a.id === current.id ? "bg-muted font-semibold" : ""
              }`}
            >
              <Avatar username={a.username} />
              <span className="min-w-0 flex-1 truncate">@{a.username}</span>
              {a.id === defaultAccountId && (
                <span className="text-xs text-accent" title="Default account">★</span>
              )}
              {a.status !== "connected" && (
                <span className="text-[10px] font-semibold text-red-600">!</span>
              )}
            </Link>
          ))}
          <a
            href="/api/instagram/connect"
            className="mt-1 border-t border-border px-2 pb-1 pt-2 text-[12.5px] text-muted-foreground hover:text-foreground"
          >
            ＋ Connect another account
          </a>
        </div>
      )}
    </div>
  );
}
