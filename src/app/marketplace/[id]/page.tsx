import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { assets, executionSteps, royaltyLedger } from "@/db/schema";
import VerifyAssetButton from "@/components/VerifyAssetButton";
import { bpsToPct, fmtDate, fmtMs, fmtSov, shortHash } from "@/lib/format";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export default async function AssetDetailPage({ params }: Ctx) {
  const { id } = await params;
  const [asset] = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
  if (!asset) notFound();

  const ledger = await db
    .select()
    .from(royaltyLedger)
    .where(eq(royaltyLedger.assetId, id))
    .orderBy(desc(royaltyLedger.createdAt))
    .limit(15);
  const steps = await db
    .select()
    .from(executionSteps)
    .where(eq(executionSteps.assetId, id))
    .orderBy(desc(executionSteps.createdAt))
    .limit(15);
  const earned = ledger.reduce((s, r) => s + Number(r.amountMicro), 0);

  const m = asset.manifest;
  const b = asset.benchmarks;

  return (
    <div className="space-y-8">
      <div>
        <Link href="/marketplace" className="font-mono text-xs text-slate-500 hover:text-emerald-400">← marketplace</Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">{asset.name}</h1>
          <span className={`rounded-full px-2.5 py-1 font-mono text-xs ${asset.status === "active" ? "bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/30" : "bg-amber-500/10 text-amber-300 ring-1 ring-amber-500/30"}`}>
            {asset.status}
          </span>
        </div>
        <p className="mt-1 font-mono text-xs text-slate-500">@{asset.slug} · v{asset.version} · id {asset.id}</p>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-400">{asset.description}</p>
        {asset.quarantineReason && (
          <p className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 font-mono text-xs text-amber-300">
            ⚠ quarantined: {asset.quarantineReason}
          </p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Cryptographic identity */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="font-semibold text-emerald-300">Cryptographic identity (Layer I)</h2>
          <dl className="mt-3 space-y-2 font-mono text-xs">
            <div className="flex justify-between gap-4"><dt className="text-slate-500">sha256(code)</dt><dd className="break-all text-right text-slate-200">{asset.codeHash}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-500">ring q (Z_q)</dt><dd className="break-all text-right text-slate-200">{asset.ring.q}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-500">generator g</dt><dd className="text-slate-200">{asset.ring.g}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-500">secret a = H(domain‖hash) mod q</dt><dd className="break-all text-right text-slate-500">{shortHash(asset.ring.a, 16)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-500">commitment C = g^a mod q</dt><dd className="break-all text-right text-emerald-300">{shortHash(asset.ring.commitment, 24)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-500">domain</dt><dd className="text-right text-slate-500">{asset.ring.domain}</dd></div>
          </dl>
          <div className="mt-4"><VerifyAssetButton assetId={asset.id} /></div>
        </section>

        {/* Manifest + benchmarks + royalty interface */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="font-semibold text-emerald-300">Execution manifest &amp; royalty interface</h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-xs">
            <div><dt className="text-slate-500">entrypoint</dt><dd className="text-slate-200">{m?.entrypoint}</dd></div>
            <div><dt className="text-slate-500">capabilities</dt><dd className="text-slate-200">{(m?.capabilities ?? []).join(", ") || "—"}</dd></div>
            <div><dt className="text-slate-500">timeout</dt><dd className="text-slate-200">{m?.limits?.timeoutMs} ms</dd></div>
            <div><dt className="text-slate-500">memory cap</dt><dd className="text-slate-200">{m?.limits?.memoryMb} MB</dd></div>
            <div><dt className="text-slate-500">max output</dt><dd className="text-slate-200">{m?.limits?.maxOutputBytes} B</dd></div>
            <div><dt className="text-slate-500">max entropy</dt><dd className="text-slate-200">{m?.limits?.maxEntropyBitsPerChar} bits/char</dd></div>
            <div><dt className="text-slate-500">required outputs</dt><dd className="text-slate-200">{(m?.outputs?.requiredKeys ?? []).join(", ") || "—"}</dd></div>
            <div><dt className="text-slate-500">royalty</dt><dd className="text-emerald-300">{bpsToPct(asset.royaltyBps)} per cycle</dd></div>
            <div><dt className="text-slate-500">creator</dt><dd className="break-all text-slate-200">{asset.creatorAddress}</dd></div>
            <div><dt className="text-slate-500">earned</dt><dd className="text-emerald-300">{fmtSov(earned)} SOV</dd></div>
            <div><dt className="text-slate-500">benchmark p50</dt><dd className="text-slate-200">{b?.ok ? fmtMs(b.p50Ms) : "failed"}</dd></div>
            <div><dt className="text-slate-500">benchmark heap</dt><dd className="text-slate-200">{b?.heapMb != null ? `${b.heapMb.toFixed(2)} MB` : "—"}</dd></div>
            <div><dt className="text-slate-500">benchmark hash</dt><dd className="text-slate-500">{shortHash(b?.outputHash ?? null, 12)}</dd></div>
            <div><dt className="text-slate-500">created</dt><dd className="text-slate-500">{fmtDate(asset.createdAt)}</dd></div>
          </dl>
        </section>
      </div>

      {/* Code */}
      <section className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
        <h2 className="font-semibold text-emerald-300">Module bytecode (sandboxed)</h2>
        <pre className="mt-3 max-h-96 overflow-auto rounded-xl border border-slate-800 bg-slate-900/60 p-4 font-mono text-xs leading-relaxed text-slate-300">{asset.code}</pre>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Ledger */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="font-semibold">Royalty credits for this asset</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-slate-800 font-mono text-[10px] uppercase text-slate-500">
                <th className="px-2 py-2">when</th><th className="px-2 py-2">kind</th><th className="px-2 py-2">to</th><th className="px-2 py-2">cycle</th><th className="px-2 py-2 text-right">amount</th>
              </tr></thead>
              <tbody>
                {ledger.length === 0 && <tr><td colSpan={5} className="px-2 py-4 text-center text-slate-500">no royalties yet</td></tr>}
                {ledger.map((r) => (
                  <tr key={r.id} className="border-b border-slate-800/50">
                    <td className="px-2 py-1.5 font-mono text-slate-500">{fmtDate(r.createdAt)}</td>
                    <td className="px-2 py-1.5">{r.kind}</td>
                    <td className="px-2 py-1.5 font-mono text-[10px] text-slate-400">{r.creatorAddress.slice(0, 24)}</td>
                    <td className="px-2 py-1.5">{r.cycle ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-emerald-300">{fmtSov(r.amountMicro)} SOV</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Execution steps */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="font-semibold">Recent execution steps</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-slate-800 font-mono text-[10px] uppercase text-slate-500">
                <th className="px-2 py-2">cycle</th><th className="px-2 py-2">status</th><th className="px-2 py-2">violation</th><th className="px-2 py-2">duration</th><th className="px-2 py-2">entropy</th><th className="px-2 py-2">output hash</th>
              </tr></thead>
              <tbody>
                {steps.length === 0 && <tr><td colSpan={6} className="px-2 py-4 text-center text-slate-500">never executed</td></tr>}
                {steps.map((s) => (
                  <tr key={s.id} className="border-b border-slate-800/50">
                    <td className="px-2 py-1.5">{s.cycle}</td>
                    <td className="px-2 py-1.5">
                      <span className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] ${s.status === "ok" ? "bg-emerald-500/10 text-emerald-300" : s.status === "quarantined" ? "bg-amber-500/10 text-amber-300" : "bg-slate-700/40 text-slate-400"}`}>{s.status}</span>
                    </td>
                    <td className="px-2 py-1.5 font-mono text-amber-300/80">{s.violation ?? "—"}</td>
                    <td className="px-2 py-1.5 font-mono text-slate-400">{fmtMs(s.durationMs)}</td>
                    <td className="px-2 py-1.5 font-mono text-slate-400">{s.entropy != null ? s.entropy.toFixed(2) : "—"}</td>
                    <td className="px-2 py-1.5 font-mono text-slate-500">{shortHash(s.outputHash, 8)}</td>
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
