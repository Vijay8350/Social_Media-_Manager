import type { Metadata } from "next";
import "./globals.css";
import { ThemeToggle } from "@/components/ThemeToggle";

export const metadata: Metadata = {
  title: "Social Media Manager",
  description:
    "Autonomous AI quote-content generation and Instagram auto-posting.",
};

// Set the theme class before paint to avoid a flash of the wrong theme.
const themeScript = `(function(){try{var t=localStorage.getItem('theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-screen flex-col">
        <div className="flex-1">{children}</div>
        <footer className="border-t border-border px-6 py-6 text-xs text-muted-foreground">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
            <nav className="flex flex-wrap gap-4">
              <a className="hover:text-foreground" href="/privacy">
                Privacy Policy
              </a>
              <a className="hover:text-foreground" href="/terms">
                Terms of Service
              </a>
              <a className="hover:text-foreground" href="/data-deletion">
                Data Deletion
              </a>
            </nav>
            <ThemeToggle />
          </div>
        </footer>
      </body>
    </html>
  );
}
