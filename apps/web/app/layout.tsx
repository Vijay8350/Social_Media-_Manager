import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Insta Post Generator",
  description:
    "Autonomous AI quote-content generation and Instagram auto-posting.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <div className="flex-1">{children}</div>
        <footer className="border-t border-neutral-200 px-6 py-6 text-center text-xs text-neutral-500">
          <nav className="flex justify-center gap-4">
            <a className="hover:text-neutral-800" href="/privacy">
              Privacy Policy
            </a>
            <span aria-hidden>·</span>
            <a className="hover:text-neutral-800" href="/terms">
              Terms of Service
            </a>
          </nav>
        </footer>
      </body>
    </html>
  );
}
