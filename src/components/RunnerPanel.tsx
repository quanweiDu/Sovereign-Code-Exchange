"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fmtMs, fmtSov, shortHash } from "@/lib/format";

export interface AssemblyOption {
  id: string;
  name: string;
  status: string;
  assetCount: number;
  createdAt: string;
}

interface StepRow {
  id: string;
  cycle: number;
  assetId: string;
  status: string;
  violation: string | null;
  error: string | null;
  durationMs: number | null;
  entropy: number | null;
  outputHash: string | null;
}

interface RunResult {
  ok: boolean;
  error?: string;
  execution?: { id: string; status: string; summary: { stepsOk: number; stepsQuarantined: number; stepsSkipped: number; royaltiesMicro: number; quarantinedAssets: string[] } | null };
  steps?: StepRow[];
}

export default function RunnerPanel({ assemblies, assetNames }: { assemblies: AssemblyOption[]; assetNames: Record<string, string> }) {
  const router = useRouter();
  const [assemblyId, setAssemblyId] = useState(assemblies[0]?.id ?? "");
  const [cycles, setCycles] = useState(3);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);

  async function run() {
    if (!assemblyId) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/executions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assemblyId, cycles }),
      });
      const json = (await res.json()) as RunResult;
      setResult(json);
      if (json.ok) router.refresh();
    } catch (err) {
      setResult({ ok: false, error: String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block flex-1 min-w-60">
          <span className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-slate-500">assembly</span>
          <select
            value={assemblyId}
            onChange={(e) => setAssemblyId(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500/60 focus:outline-none"
          >
            {assemblies.length === 0 && <option value="">no assemblies yet</option>}
            {assemblies.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.assetCount} assets · {a.status})
              </option>
            ))}
          </select>
        </label>
        <label className="block w-28">
          <span className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-slate-500">cycles (1–10)</span>
          <input
            type="number"
            min={1}
            max={10}
            value={cycles}
            onChange={(e) => setCycles(Math.max(1, Math.min(10, Number(e.target.value))))}
            className="w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500/60 focus:outline-none"
          />
        </label>
        <button
          onClick={() => void run()}
          disabled={busy || !assemblyId}
          className="rounded-lg bg-emerald-400 px-5 py-2.5 text-sm font-bold text-slate-950 shadow-[0_0_24px_rgba(52,211,153,0.3)] transition hover:bg-emerald-300 disabled:opacity-50"
        >
          {busy ? "Executing through meta-kernel…" : "▶ Execute run"}
        </button>
      </div>

      {result && !result.ok && (
        <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 font-mono text-xs text-rose-300">{result.error}</p>
      )}

      {result?.ok && result.execution && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ["steps ok", String(result.execution.summary?.stepsOk ?? 0), "text-emerald-300"],
              ["quarantined", String(result.execution.summary?.stepsQuarantined ?? 0), "text-amber-300"],
              ["skipped", String(result.execution.summary?.stepsSkipped ?? 0), "text-slate-400"],
              ["royalties", `${fmtSov(result.execution.summary?.royaltiesMicro ?? 0)} SOV`, "text-emerald-300"],
            ].map(([k, v, cls]) => (
              <div key={k as string} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <p className="font-mono text-[10px] uppercase tracking-wider text-slate-500">{k}</p>
                <p className={`mt-1 text-lg font-bold ${cls}`}>{v}</p>
              </div>
            ))}
          </div>
          {result.execution.summary && result.execution.summary.quarantinedAssets.length > 0 && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 font-mono text-xs text-amber-300">
              ⚠ Automatic Domain Quarantine: {result.execution.summary.quarantinedAssets.length} module(s) isolated mid-run; the
              rest of the pipeline completed.
            </p>
          )}
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="px-3 py-2">cycle</th><th className="px-3 py-2">module</th><th className="px-3 py-2">status</th>
                  <th className="px-3 py-2">violation</th><th className="px-3 py-2">duration</th><th className="px-3 py-2">entropy</th><th className="px-3 py-2">output sha256</th>
                </tr>
              </thead>
              <tbody>
                {(result.steps ?? []).map((s) => (
                  <tr key={s.id} className="border-b border-slate-800/50 last:border-0">
                    <td className="px-3 py-2 font-mono">{s.cycle}</td>
                    <td className="px-3 py-2 text-slate-300">{assetNames[s.assetId] ?? s.assetId.slice(0, 8)}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] ${s.status === "ok" ? "bg-emerald-500/10 text-emerald-300" : s.status === "quarantined" ? "bg-amber-500/10 text-amber-300" : "bg-slate-700/40 text-slate-400"}`}>
                        {s.status}
                      </span>
                    </td>
                    <td className="max-w-56 truncate px-3 py-2 font-mono text-amber-300/80" title={s.error ?? undefined}>
                      {s.violation ?? "—"}{s.error && s.status === "quarantined" ? `: ${s.error.slice(0, 60)}…` : ""}
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-400">{fmtMs(s.durationMs)}</td>
                    <td className="px-3 py-2 font-mono text-slate-400">{s.entropy != null ? s.entropy.toFixed(2) : "—"}</td>
                    <td className="px-3 py-2 font-mono text-slate-500">{shortHash(s.outputHash, 8)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="font-mono text-[11px] text-slate-500">
            execution {result.execution.id.slice(0, 8)}… · status {result.execution.status} · full event stream on the ledger &amp; detail APIs
          </p>
        </div>
      )}
    </div>
  );
}
