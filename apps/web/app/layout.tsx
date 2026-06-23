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
      <body>{children}</body>
    </html>
  );
}
