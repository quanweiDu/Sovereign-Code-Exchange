"use client";

import { useState } from "react";

interface VerifyResult {
  ok: boolean;
  valid?: boolean;
  hashOk?: boolean;
  commitmentOk?: boolean;
  recomputedHash?: string;
  recomputedCommitment?: string;
  error?: string;
}

export default function VerifyAssetButton({ assetId }: { assetId: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);

  async function verify() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`/api/assets/${assetId}/verify`, { method: "POST" });
      setResult(await res.json());
    } catch (err) {
      setResult({ ok: false, error: String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        onClick={() => void verify()}
        disabled={busy}
        className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-50"
      >
        {busy ? "Verifying invariants…" : "Verify ring commitment & hash"}
      </button>
      {result && (
        <div className={`mt-3 rounded-xl border p-3 font-mono text-xs ${result.valid ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-300" : "border-rose-500/40 bg-rose-500/5 text-rose-300"}`}>
          {result.ok && result.valid !== undefined ? (
            <>
              <p>state-invariant assertion: {result.valid ? "✓ VALID" : "✗ INVALID"}</p>
              <p>sha256 match: {result.hashOk ? "✓" : "✗"} · commitment C = g^a mod q match: {result.commitmentOk ? "✓" : "✗"}</p>
              <p className="mt-1 break-all text-slate-500">recomputed hash: {result.recomputedHash}</p>
              <p className="break-all text-slate-500">recomputed C: {result.recomputedCommitment}</p>
            </>
          ) : (
            <p>error: {result.error}</p>
          )}
        </div>
      )}
    </div>
  );
}
