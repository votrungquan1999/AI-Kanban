import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Kanban",
  description: "Autonomous task-orchestration board",
};

/**
 * Root layout wrapping every page with the html/body shell and global styles.
 * @param children - The rendered page content.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
