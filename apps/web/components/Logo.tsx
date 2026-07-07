import Link from "next/link";

export function Logo({ size = "md" }: { size?: "sm" | "md" }) {
  const box = size === "sm" ? "h-7 w-7 text-base" : "h-8 w-8 text-lg";
  const text = size === "sm" ? "text-base" : "text-lg";
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span
        className={`${box} flex items-center justify-center rounded-lg bg-accent font-quote text-accent-foreground`}
        aria-hidden
      >
        &ldquo;
      </span>
      <span className={`font-display font-bold tracking-tight ${text}`}>
        ApanSocial
      </span>
    </Link>
  );
}
