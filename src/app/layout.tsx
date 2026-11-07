import type { Metadata } from "next";
import type { ReactNode } from "react";
import Nav from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "SCSEP — Sovereign Code & Skill Exchange (SSU Protocol)",
  description:
    "Sovereign Code & Skill Exchange Protocol (SCSEP): trade dynamic Sovereign Code-Skill Units (SSUs) — executable code, agent skills and domain heuristics — via intent-matched DAGs, an order book, a quarantining async kernel, and automated lifetime micro-royalty settlement.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">
        <Nav />
        <main className="mx-auto max-w-7xl px-4 pb-24 pt-8">{children}</main>
        <footer className="border-t border-slate-800/80 py-6 text-center font-mono text-xs text-slate-500">
          SCSEP · SOVEREIGN CODE & SKILL EXCHANGE · local node · PostgreSQL + Drizzle · Python core in /core · MIT public good
        </footer>
      </body>
    </html>
  );
}
