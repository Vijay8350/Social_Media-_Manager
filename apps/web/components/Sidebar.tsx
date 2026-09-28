"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AccountSwitcher, type SwitcherAccount } from "@/components/AccountSwitcher";

const NAV: { label: string; icon: string; href: string; exact: boolean }[] = [
  { label: "Dashboard", icon: "▦", href: "/dashboard", exact: true },
  { label: "Campaigns", icon: "▩", href: "/dashboard/campaigns", exact: false },
  { label: "Comments", icon: "◫", href: "/dashboard/comments", exact: false },
  { label: "Billing", icon: "▧", href: "/dashboard/billing", exact: false },
  { label: "Settings", icon: "⚙", href: "/dashboard/settings", exact: false },
];

export function Sidebar({
  email,
  accounts,
  defaultAccountId,
  flaggedComments = 0,
}: {
  email: string | null;
  accounts: SwitcherAccount[];
  defaultAccountId: string | null;
  /** Bad comments waiting for review — shown as a badge on Comments. */
  flaggedComments?: number;
}) {
  const badges: Record<string, number> = { "/dashboard/comments": flaggedComments };
  const pathname = usePathname();
  const initial = (email?.[0] ?? "U").toUpperCase();
  // Below md the sidebar is an off-canvas drawer; from md up it's always shown.
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-card px-4 py-3 md:hidden">
        <Logo size="sm" />
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-expanded={open}
          aria-controls="app-sidebar"
          className="relative rounded-lg border border-border px-3 py-1.5 text-lg leading-none"
        >
          ☰
          {flaggedComments > 0 && (
            <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-red-500" aria-hidden />
          )}
        </button>
      </header>

      {open && (
        <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setOpen(false)} aria-hidden />
      )}

      <aside
        id="app-sidebar"
        className={`fixed inset-y-0 left-0 z-40 flex w-[260px] flex-col gap-1 overflow-y-auto border-r border-border bg-card px-3.5 py-5 transition-transform duration-200 md:sticky md:top-0 md:z-auto md:h-screen md:w-[236px] md:shrink-0 md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-2.5 pb-4">
          <Logo size="sm" />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="rounded-md px-2 py-1 text-muted-foreground hover:bg-muted md:hidden"
          >
            ✕
          </button>
        </div>
  
        <AccountSwitcher accounts={accounts} defaultAccountId={defaultAccountId} />
  
        {NAV.map((n) => {
          const active = n.exact ? pathname === n.href : pathname.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
                active
                  ? "bg-muted font-semibold text-foreground"
                  : "font-medium text-muted-foreground hover:bg-muted/60"
              }`}
            >
              <span className="w-4 text-center">{n.icon}</span>
              {n.label}
              {(badges[n.href] ?? 0) > 0 && (
                <span
                  className="ml-auto rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10.5px] font-bold text-red-600 dark:text-red-400"
                  title="Flagged comments waiting for review"
                >
                  {badges[n.href]! > 99 ? "99+" : badges[n.href]}
                </span>
              )}
            </Link>
          );
        })}
        <div className="mt-auto flex flex-col gap-2">
          <div className="flex items-center gap-2 px-1">
            <ThemeToggle />
            <span className="text-xs text-muted-foreground">Theme</span>
          </div>
          <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent">
              {initial}
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-[13px] font-medium">{email ?? "Account"}</span>
            </div>
          </div>
          <form action="/auth/signout" method="post">
            <button className="w-full rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted">
              Sign out
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
