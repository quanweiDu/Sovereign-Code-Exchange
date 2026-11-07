"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fmtDate, fmtSov } from "@/lib/format";

interface AssetOption {
  id: string;
  name: string;
  slug: string;
}

interface OrderRow {
  id: string;
  side: "bid" | "ask";
  assetId: string;
  assetName: string | null;
  assetSlug: string | null;
  owner: string;
  priceMicro: number;
  qty: number;
  filledQty: number;
  status: string;
  createdAt: string;
}

export default function OrderBookPanel({ assets }: { assets: AssetOption[] }) {
  const router = useRouter();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [side, setSide] = useState<"bid" | "ask">("ask");
  const [assetId, setAssetId] = useState(assets[0]?.id ?? "");
  const [owner, setOwner] = useState("user:rider-coop");
  const [price, setPrice] = useState(500000);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/orders");
    const json = await res.json();
    if (json.ok) setOrders(json.orders);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function place() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ side, assetId, owner, priceMicro: price, qty }),
      });
      const json = await res.json();
      if (!json.ok) setMessage(`error: ${json.error}`);
      else {
        setMessage(
          json.fills.length > 0
            ? `✓ matched ${json.fills.length} fill(s): ${json.fills.map((f: { qty: number; priceMicro: number }) => `${f.qty} @ ${fmtSov(f.priceMicro)} SOV`).join(", ")} — settled to ledger`
            : "✓ order placed (open, no counterparty yet)",
        );
        await refresh();
        router.refresh();
      }
    } catch (err) {
      setMessage(String(err));
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500/60 focus:outline-none";

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Order book — SSU execution rights</h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">
            Limit orders on execution rights of any SSU. Compatible bids/asks match on price-time priority; fills settle
            peer-to-peer into the royalty ledger as <span className="font-mono">trade-credit / trade-debit</span> entries.
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="block w-24">
          <span className="mb-1 block font-mono text-[10px] uppercase text-slate-500">side</span>
          <select value={side} onChange={(e) => setSide(e.target.value as "bid" | "ask")} className={inputCls}>
            <option value="ask">ask (sell)</option>
            <option value="bid">bid (buy)</option>
          </select>
        </label>
        <label className="block min-w-52 flex-1">
          <span className="mb-1 block font-mono text-[10px] uppercase text-slate-500">SSU</span>
          <select value={assetId} onChange={(e) => setAssetId(e.target.value)} className={inputCls}>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>{a.name} (@{a.slug})</option>
            ))}
          </select>
        </label>
        <label className="block w-44">
          <span className="mb-1 block font-mono text-[10px] uppercase text-slate-500">owner</span>
          <input value={owner} onChange={(e) => setOwner(e.target.value)} className={inputCls} />
        </label>
        <label className="block w-36">
          <span className="mb-1 block font-mono text-[10px] uppercase text-slate-500">price µSOV</span>
          <input type="number" value={price} onChange={(e) => setPrice(Number(e.target.value))} className={inputCls} />
        </label>
        <label className="block w-20">
          <span className="mb-1 block font-mono text-[10px] uppercase text-slate-500">qty</span>
          <input type="number" min={1} max={1000} value={qty} onChange={(e) => setQty(Number(e.target.value))} className={inputCls} />
        </label>
        <button
          onClick={() => void place()}
          disabled={busy || !assetId}
          className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-emerald-300 disabled:opacity-50"
        >
          {busy ? "…" : "Place order"}
        </button>
      </div>
      {message && (
        <p className="mt-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 font-mono text-xs text-emerald-300">{message}</p>
      )}
      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-950 font-mono text-[10px] uppercase tracking-wider text-slate-500">
              <th className="px-3 py-2">side</th><th className="px-3 py-2">SSU</th><th className="px-3 py-2">owner</th>
              <th className="px-3 py-2 text-right">price</th><th className="px-3 py-2">qty</th><th className="px-3 py-2">filled</th>
              <th className="px-3 py-2">status</th><th className="px-3 py-2">placed</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">book is empty — place the first order</td></tr>
            )}
            {orders.slice(0, 25).map((o) => (
              <tr key={o.id} className="border-b border-slate-800/50 last:border-0">
                <td className="px-3 py-2">
                  <span className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] ${o.side === "bid" ? "bg-cyan-500/10 text-cyan-300" : "bg-emerald-500/10 text-emerald-300"}`}>{o.side}</span>
                </td>
                <td className="px-3 py-2 text-slate-300">{o.assetName ?? o.assetSlug ?? o.assetId.slice(0, 8)}</td>
                <td className="px-3 py-2 font-mono text-[10px] text-slate-400">{o.owner}</td>
                <td className="px-3 py-2 text-right font-mono text-slate-300">{fmtSov(o.priceMicro)} SOV</td>
                <td className="px-3 py-2 font-mono">{o.qty}</td>
                <td className="px-3 py-2 font-mono text-slate-400">{o.filledQty}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] ${o.status === "open" ? "bg-amber-500/10 text-amber-300" : o.status === "filled" ? "bg-emerald-500/10 text-emerald-300" : "bg-slate-700/40 text-slate-400"}`}>{o.status}</span>
                </td>
                <td className="px-3 py-2 font-mono text-[10px] text-slate-500">{fmtDate(o.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
