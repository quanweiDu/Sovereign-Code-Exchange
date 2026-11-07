import { desc } from "drizzle-orm";
import { db } from "@/db";
import { assets, royaltyLedger } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { listCreators } from "@/lib/marketplace";
import { GAS_POOL_ADDRESS } from "@/lib/marketplace";
import { fmtDate, fmtSov } from "@/lib/format";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function LedgerPage() {
  const rows = await db.select().from(royaltyLedger).orderBy(desc(royaltyLedger.createdAt)).limit(120);
  const assetIds = [...new Set(rows.map((r) => r.assetId))];
  const mods = assetIds.length ? await db.select().from(assets).where(inArray(assets.id, assetIds)) : [];
  const byId = new Map(mods.map((m) => [m.id, m]));
  const creators = await listCreators();

  return (
    <div className="space-y-8">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-emerald-400">Layer III · Economics</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Micro-Royalty &amp; Gas-Dividend Ledger</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">
          Every execution cycle settles 1.0 SOV per module: the creator receives royaltyBps/10000 instantly, the
          remainder flows to the gas-dividend pool. Every assembly composition settles an additional 0.1 SOV per asset.
          Amounts are integer micro-SOV (1 SOV = 1,000,000 µSOV).
        </p>
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Creator balances (lifetime)</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {creators.length === 0 && <p className="text-sm text-slate-500">No royalties settled yet.</p>}
          {creators.map((c) => (
            <div key={c.creatorAddress} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
              <p className="truncate font-mono text-xs text-slate-400" title={c.creatorAddress}>
                {c.creatorAddress === GAS_POOL_ADDRESS ? "⚡ gas-dividend pool" : c.creatorAddress}
              </p>
              <p className="mt-2 text-xl font-bold text-emerald-300">{fmtSov(c.totalMicro)} SOV</p>
              <p className="mt-1 font-mono text-[11px] text-slate-500">{c.credits} credits</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Ledger entries</h2>
        <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/60">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 font-mono text-[11px] uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3">time</th>
                <th className="px-4 py-3">kind</th>
                <th className="px-4 py-3">asset</th>
                <th className="px-4 py-3">credited to</th>
                <th className="px-4 py-3">cycle</th>
                <th className="px-4 py-3">bps</th>
                <th className="px-4 py-3 text-right">amount</th>
                <th className="px-4 py-3">memo</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">Ledger is empty — run the genesis driver.</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-800/60 last:border-0 hover:bg-slate-800/30">
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{fmtDate(r.createdAt)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${r.kind === "execution" ? "bg-emerald-500/10 text-emerald-300" : "bg-cyan-500/10 text-cyan-300"}`}>{r.kind}</span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-300">{byId.get(r.assetId)?.name ?? r.assetId.slice(0, 8)}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-400">{r.creatorAddress}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{r.cycle ?? "—"}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{r.assetBps}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-emerald-300">{fmtSov(r.amountMicro)} SOV</td>
                  <td className="max-w-52 truncate px-4 py-2.5 font-mono text-[11px] text-slate-500" title={r.memo}>{r.memo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
