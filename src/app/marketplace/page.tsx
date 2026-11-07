import Link from "next/link";
import RegisterAssetForm from "@/components/RegisterAssetForm";
import OrderBookPanel from "@/components/OrderBookPanel";
import { listAssetsWithEarnings } from "@/lib/marketplace";
import { bpsToPct, fmtDate, fmtMs, fmtSov, shortHash } from "@/lib/format";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function MarketplacePage() {
  const assets = await listAssetsWithEarnings();

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-emerald-400">Layer I · Registry</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Code-Asset NFT Marketplace</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">
            Every card is an immutable Code-as-Asset: sha256 hash, Z_q ring commitment, execution manifest,
            benchmark and royalty interface. Click through for cryptographic verification.
          </p>
        </div>
        <RegisterAssetForm />
      </div>

      {assets.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-700 p-10 text-center text-sm text-slate-500">
          Registry is empty. Run the genesis driver on the dashboard or mint the first asset above.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {assets.map((a) => (
          <Link
            key={a.id}
            href={`/marketplace/${a.id}`}
            className="group rounded-2xl border border-slate-800 bg-slate-900/60 p-5 transition hover:border-emerald-500/40 hover:bg-slate-900"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-slate-100 group-hover:text-emerald-300">{a.name}</h2>
                <p className="mt-0.5 font-mono text-[11px] text-slate-500">@{a.slug}</p>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 font-mono text-[11px] ${
                  a.status === "active"
                    ? "bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/30"
                    : "bg-amber-500/10 text-amber-300 ring-1 ring-amber-500/30"
                }`}
              >
                {a.status}
              </span>
            </div>
            <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-slate-400">{a.description}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {(a.tags ?? []).slice(0, 6).map((t) => (
                <span key={t} className="rounded-md bg-slate-800/80 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">{t}</span>
              ))}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-800/80 pt-3 font-mono text-[11px] text-slate-400">
              <div>sha256 <span className="text-slate-200">{shortHash(a.codeHash, 8)}</span></div>
              <div>royalty <span className="text-emerald-300">{bpsToPct(a.royaltyBps)}</span></div>
              <div>p50 <span className="text-slate-200">{a.benchmarks?.ok ? fmtMs(a.benchmarks.p50Ms) : "—"}</span></div>
              <div>earned <span className="text-emerald-300">{fmtSov(a.earnedMicro)} SOV</span></div>
              <div className="col-span-2 text-slate-500">by {a.creatorName} · {a.creatorAddress} · {fmtDate(a.createdAt)}</div>
            </div>
          </Link>
        ))}
      </div>

      <OrderBookPanel assets={assets.map((a) => ({ id: a.id, name: a.name, slug: a.slug }))} />
    </div>
  );
}
