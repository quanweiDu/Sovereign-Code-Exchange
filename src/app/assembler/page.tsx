import { desc } from "drizzle-orm";
import { db } from "@/db";
import { intents } from "@/db/schema";
import AssemblerPanel from "@/components/AssemblerPanel";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AssemblerPage() {
  const rows = await db.select().from(intents).orderBy(desc(intents.createdAt)).limit(10);

  return (
    <div className="space-y-8">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-emerald-400">Layer III · Assembler</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Intent-Driven Assembler</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">
          Describe what you want in plain language. The marketplace engine parses it into a capability dependency
          graph, routes each capability to the best-performing active Code-Asset NFT (liquidity routing of compute),
          and assembles the pipeline — settling composition micro-royalties to creators immediately.
        </p>
      </div>

      <AssemblerPanel />

      <section>
        <h2 className="mb-3 text-lg font-semibold">Recent intents</h2>
        <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/60">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 font-mono text-[11px] uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3">intent</th>
                <th className="px-4 py-3">confidence</th>
                <th className="px-4 py-3">status</th>
                <th className="px-4 py-3">nodes</th>
                <th className="px-4 py-3">parsed at</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No intents yet.</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-800/60 last:border-0 hover:bg-slate-800/30">
                  <td className="max-w-md truncate px-4 py-3 text-slate-300" title={r.rawText}>{r.rawText}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">{(r.confidence * 100).toFixed(0)}%</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 font-mono text-[11px] ${r.status === "resolved" ? "bg-emerald-500/10 text-emerald-300" : r.status === "partial" ? "bg-amber-500/10 text-amber-300" : "bg-rose-500/10 text-rose-300"}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">{r.graph.nodes.length}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{fmtDate(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
