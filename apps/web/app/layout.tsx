import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ApanSocial — autonomous Instagram quote content",
  description:
    "Generate on-brand quote art from each account's DNA, gate it with AI, and auto-post to Instagram on schedule.",
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
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Instrument+Sans:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="flex min-h-screen flex-col">
        <div className="flex-1">{children}</div>
        <footer className="border-t border-border px-6 py-5 text-xs text-muted-foreground">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
            <span>© 2026 ApanSocial · social.apanjob.com</span>
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
          </div>
        </footer>
      </body>
    </html>
  );
}
