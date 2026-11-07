"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/marketplace", label: "Marketplace" },
  { href: "/assembler", label: "Intent Assembler" },
  { href: "/runner", label: "Runner" },
  { href: "/ledger", label: "Royalty Ledger" },
  { href: "/settlement", label: "Settlement" },
];

export default function Nav() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-slate-950/85 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-mono text-sm font-bold tracking-tight text-emerald-400">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.9)]" />
          SCSEP<span className="text-slate-100">/SSU-EXCHANGE</span>
        </Link>
        <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
          {LINKS.map((l) => {
            const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "bg-emerald-400/10 font-semibold text-emerald-300"
                    : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <span className="hidden rounded-full border border-slate-700 px-2.5 py-1 font-mono text-[11px] text-slate-400 md:inline">
          node: scsep-local-1
        </span>
      </div>
    </header>
  );
}
