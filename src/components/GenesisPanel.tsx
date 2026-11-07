"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fmtSov } from "@/lib/format";

interface GenesisResponse {
  ok: boolean;
  mode?: string;
  error?: string;
  seed?: { created: string[]; existing: number; total: number };
  executionId?: string;
  assemblyId?: string;
  cycles?: number;
  summary?: {
    stepsOk: number;
    stepsQuarantined: number;
    stepsSkipped: number;
    quarantinedAssets: string[];
    royaltiesMicro: number;
  };
}

export default function GenesisPanel() {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "seed" | "run">(null);
  const [result, setResult] = useState<GenesisResponse | null>(null);

  async function call(run: boolean) {
    setBusy(run ? "run" : "seed");
    setResult(null);
    try {
      const res = await fetch("/api/genesis", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ run, cycles: 3 }),
      });
      const json = (await res.json()) as GenesisResponse;
      setResult(json);
      if (json.ok) router.refresh();
    } catch (err) {
      setResult({ ok: false, error: String(err) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 via-slate-900/60 to-slate-900/60 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-emerald-300">Layer 4 · Self-Hosting Genesis Driver</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Initializes this exchange node: registers the sample industrial Code-Asset modules (fault-tolerant
            logistics router, secure data sink, podcast publisher, …), parses the canonical intent, assembles the
            pipeline and executes a 3-cycle production run — with live micro-royalty settlement and automatic
            domain quarantine of the fault-injecting telemetry module.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void call(false)}
            disabled={busy !== null}
            className="rounded-lg border border-slate-700 bg-slate-800/70 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-500 disabled:opacity-50"
          >
            {busy === "seed" ? "Seeding…" : "Seed modules"}
          </button>
          <button
            onClick={() => void call(true)}
            disabled={busy !== null}
            className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-bold text-slate-950 shadow-[0_0_24px_rgba(52,211,153,0.35)] transition hover:bg-emerald-300 disabled:opacity-50"
          >
            {busy === "run" ? "Running genesis…" : "▶ Run genesis (3 cycles)"}
          </button>
        </div>
      </div>
      {result && (
        <div className={`mt-4 rounded-xl border p-4 font-mono text-xs ${result.ok ? "border-emerald-500/40 bg-emerald-500/5" : "border-rose-500/40 bg-rose-500/5"}`}>
          {!result.ok && <p className="text-rose-300">error: {result.error}</p>}
          {result.ok && result.seed && (
            <p className="text-slate-300">
              seed: <span className="text-emerald-300">{result.seed.created.length} created</span> / {result.seed.existing} existing / {result.seed.total} total
              {result.seed.created.length > 0 && (
                <span className="text-slate-500"> — {result.seed.created.join(", ")}</span>
              )}
            </p>
          )}
          {result.ok && result.summary && (
            <div className="mt-2 space-y-1 text-slate-300">
              <p>
                execution <span className="text-emerald-300">{result.executionId?.slice(0, 8)}…</span> · assembly{" "}
                <span className="text-emerald-300">{result.assemblyId?.slice(0, 8)}…</span> · cycles {result.cycles}
              </p>
              <p>
                steps ok: <span className="text-emerald-300">{result.summary.stepsOk}</span> · quarantined:{" "}
                <span className="text-amber-300">{result.summary.stepsQuarantined}</span> · skipped:{" "}
                <span className="text-slate-400">{result.summary.stepsSkipped}</span> · royalties settled:{" "}
                <span className="text-emerald-300">{fmtSov(result.summary.royaltiesMicro)} SOV</span>
              </p>
              {result.summary.quarantinedAssets.length > 0 && (
                <p className="text-amber-300">
                  ⚠ domain quarantine triggered for {result.summary.quarantinedAssets.length} module(s) — isolated without
                  disrupting the pipeline
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
