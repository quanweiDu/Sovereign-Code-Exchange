"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fmtSov } from "@/lib/format";

interface Receipt {
  receipt: string;
  user: string;
  charged: number;
  currency: string;
  method: string;
  creditsMicro: number;
  creditsUsdc: number;
}

export default function FiatPurchasePanel() {
  const router = useRouter();
  const [user, setUser] = useState("amina@delivery-coop");
  const [amount, setAmount] = useState(12);
  const [currency, setCurrency] = useState("USD");
  const [method, setMethod] = useState("card");
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function purchase() {
    setBusy(true);
    setError(null);
    setReceipt(null);
    try {
      const res = await fetch("/api/settlements", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "purchase", user, amount, currency, method }),
      });
      const json = await res.json();
      if (!json.ok) setError(json.error ?? "purchase failed");
      else {
        setReceipt(json.receipt);
        router.refresh();
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500/60 focus:outline-none";

  return (
    <div className="rounded-2xl border border-cyan-500/30 bg-gradient-to-br from-cyan-500/10 via-slate-900/60 to-slate-900/60 p-6">
      <h2 className="text-lg font-semibold text-cyan-300">Track A · Fiat gateway (no crypto knowledge needed)</h2>
      <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-400">
        A non-technical user pays in local fiat through the abstracted PSP gateway. The node mints spendable execution
        credits (denominated in USDC) to the user's account. Credits are consumed per execution call and every call
        simultaneously settles native dividends (Track B).
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="block min-w-48 flex-1">
          <span className="mb-1 block font-mono text-[10px] uppercase text-slate-500">user</span>
          <input value={user} onChange={(e) => setUser(e.target.value)} className={inputCls} />
        </label>
        <label className="block w-28">
          <span className="mb-1 block font-mono text-[10px] uppercase text-slate-500">amount</span>
          <input type="number" min={1} step={0.01} value={amount} onChange={(e) => setAmount(Number(e.target.value))} className={inputCls} />
        </label>
        <label className="block w-24">
          <span className="mb-1 block font-mono text-[10px] uppercase text-slate-500">currency</span>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputCls}>
            {["USD", "EUR", "GBP", "NGN", "INR"].map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="block w-28">
          <span className="mb-1 block font-mono text-[10px] uppercase text-slate-500">method</span>
          <select value={method} onChange={(e) => setMethod(e.target.value)} className={inputCls}>
            <option value="card">card</option>
            <option value="bank_transfer">bank transfer</option>
            <option value="ussd">ussd</option>
          </select>
        </label>
        <button
          onClick={() => void purchase()}
          disabled={busy || !user || amount <= 0}
          className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-50"
        >
          {busy ? "Processing…" : "Buy execution credits (fiat)"}
        </button>
      </div>
      {error && <p className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 font-mono text-xs text-rose-300">{error}</p>}
      {receipt && (
        <p className="mt-3 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 font-mono text-xs text-cyan-200">
          ✓ charged {receipt.charged.toFixed(2)} {receipt.currency} via {receipt.method} · receipt {receipt.receipt.slice(0, 16)}… ·
          minted <span className="font-bold">{receipt.creditsUsdc.toFixed(2)} USDC</span> credits to {receipt.user} (
          {fmtSov(receipt.creditsMicro)} µ)
        </p>
      )}
    </div>
  );
}
