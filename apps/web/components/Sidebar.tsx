"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AccountSwitcher, type SwitcherAccount } from "@/components/AccountSwitcher";

const NAV: { label: string; icon: string; href: string; exact: boolean; badge?: string }[] = [
  { label: "Dashboard", icon: "▦", href: "/dashboard", exact: true },
  { label: "Campaigns", icon: "▩", href: "/dashboard/campaigns", exact: false },
  { label: "Comments", icon: "◫", href: "/dashboard/comments", exact: false, badge: "soon" },
  { label: "Billing", icon: "▧", href: "/dashboard/billing", exact: false },
  { label: "Settings", icon: "⚙", href: "/dashboard/settings", exact: false },
];

export function Sidebar({
  email,
  accounts,
  defaultAccountId,
}: {
  email: string | null;
  accounts: SwitcherAccount[];
  defaultAccountId: string | null;
}) {
  const pathname = usePathname();
  const initial = (email?.[0] ?? "U").toUpperCase();

  return (
    <aside className="sticky top-0 flex h-screen w-[236px] shrink-0 flex-col gap-1 border-r border-border bg-card px-3.5 py-5">
      <div className="px-2.5 pb-4">
        <Logo size="sm" />
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
            {n.badge && (
              <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                {n.badge}
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
  );
}
