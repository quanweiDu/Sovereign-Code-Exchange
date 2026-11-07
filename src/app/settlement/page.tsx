import { listSettlements, railStats } from "@/lib/marketplace";
import FiatPurchasePanel from "@/components/FiatPurchasePanel";
import { NODE_ADDRESS, TREASURY } from "@/lib/marketplace";
import { fmtDate, fmtSov } from "@/lib/format";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RAIL_LABEL: Record<string, string> = {
  fiat: "Track A · Fiat gateway (PSP)",
  USDC: "Track B · USDC (base) — creator royalties",
  USDT: "Track B · USDT (base) — node gas dividends",
};

function railTotal(byRailKind: { rail: string; kind: string; totalMicro: number }[], rail: string, kinds: string[]): number {
  return byRailKind.filter((r) => r.rail === rail && kinds.includes(r.kind)).reduce((s, r) => s + r.totalMicro, 0);
}

export default async function SettlementPage() {
  const [transfers, stats] = await Promise.all([listSettlements(120), railStats()]);

  const cards = [
    {
      label: "Fiat volume (Track A)",
      value: `${(railTotal(stats.byRailKind, "fiat", ["fiat-purchase"]) / 100).toFixed(2)} (cents→major)`,
      sub: `${railTotal(stats.byRailKind, "fiat", ["fiat-purchase"])} micro-cents charged`,
    },
    {
      label: "USDC settled (Track B)",
      value: `${fmtSov(railTotal(stats.byRailKind, "USDC", ["royalty-dividend", "trade-credit", "credit-mint"]))} USDC`,
      sub: "creator royalties + trades + credit mints",
    },
    {
      label: "USDT gas (Track B)",
      value: `${fmtSov(railTotal(stats.byRailKind, "USDT", ["gas-dividend"]))} USDT`,
      sub: `paid to node provider ${NODE_ADDRESS}`,
    },
    {
      label: "Settlement transfers",
      value: String(stats.transfers),
      sub: `chain head ${stats.chainHead.slice(0, 16)}… (SHA-256 chained)`,
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-emerald-400">SCSEP v3.0 · Dual-Track Settlement</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Fiat Gateway + Native Stablecoin Rails</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">
          <b className="text-slate-200">Track A (fiat)</b>: non-technical users buy execution credits through the
          abstracted PSP gateway — no wallet needed. <b className="text-slate-200">Track B (native)</b>: every execution
          call settles instantly in <b>USDC</b> to the SSU creator's immutable royalty address, and node gas in{" "}
          <b>USDT</b> to the node provider ({NODE_ADDRESS}). The settlement log is append-only and SHA-256 hash-chained
          (tx_hash = sha256(prev‖payload)) — tamper-evident and auditable. Treasury: {TREASURY}.
        </p>
      </div>

      <FiatPurchasePanel />

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <p className="font-mono text-[11px] uppercase tracking-widest text-slate-500">{c.label}</p>
            <p className="mt-2 text-xl font-bold text-slate-50 md:text-2xl">{c.value}</p>
            <p className="mt-1 text-xs text-slate-400">{c.sub}</p>
          </div>
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 lg:col-span-1">
          <h2 className="text-lg font-semibold">Execution-credit accounts (Track A)</h2>
          <div className="mt-3 space-y-2">
            {stats.accounts.length === 0 && <p className="text-sm text-slate-500">No fiat purchases yet.</p>}
            {stats.accounts.map((a) => (
              <div key={a.address} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                <span className="truncate font-mono text-xs text-slate-300" title={a.address}>{a.address}</span>
                <span className="ml-3 font-mono text-xs text-emerald-300">{(a.creditsMicro / 1e6).toFixed(2)} USDC credits</span>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 lg:col-span-2">
          <h2 className="text-lg font-semibold">Settlement transfer log (hash-chained)</h2>
          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="px-3 py-2">rail</th><th className="px-3 py-2">kind</th><th className="px-3 py-2">from → to</th>
                  <th className="px-3 py-2 text-right">amount</th><th className="px-3 py-2">memo</th><th className="px-3 py-2">tx_hash</th><th className="px-3 py-2">time</th>
                </tr>
              </thead>
              <tbody>
                {transfers.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">No settlements yet — run genesis or buy credits.</td></tr>
                )}
                {transfers.map((t) => (
                  <tr key={t.id} className="border-b border-slate-800/50 last:border-0">
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] ${
                        t.rail === "fiat" ? "bg-cyan-500/10 text-cyan-300"
                        : t.rail === "USDC" ? "bg-emerald-500/10 text-emerald-300"
                        : "bg-amber-500/10 text-amber-300"}`}>{t.rail}</span>
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px] text-slate-400">{t.kind}</td>
                    <td className="max-w-48 truncate px-3 py-2 font-mono text-[10px] text-slate-400" title={`${t.fromAddress} → ${t.toAddress}`}>
                      {t.fromAddress.slice(0, 18)} → {t.toAddress.slice(0, 18)}
                    </td>
                    <td className={`px-3 py-2 text-right font-mono ${t.amountMicro < 0 ? "text-rose-300" : "text-emerald-300"}`}>
                      {t.asset === "USDC" || t.asset === "USDT" ? `${fmtSov(t.amountMicro)} ${t.asset}` : `${t.amountMicro.toLocaleString()} µ${t.asset}`}
                    </td>
                    <td className="max-w-40 truncate px-3 py-2 font-mono text-[10px] text-slate-500" title={t.memo}>{t.memo}</td>
                    <td className="px-3 py-2 font-mono text-[10px] text-slate-600">{t.txHash.slice(0, 12)}…</td>
                    <td className="px-3 py-2 font-mono text-[10px] text-slate-500">{fmtDate(t.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
