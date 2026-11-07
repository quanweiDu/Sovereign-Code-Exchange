"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { shortHash } from "@/lib/format";

const TEMPLATE_CODE = [
  "// Sovereign Code-Asset module contract",
  "// export execute(input, ctx) -> object merged into the pipeline flow.",
  "// input: { cycle, seed, ...outputsOfPreviousStages }",
  "// ctx:   { cycle, assetId, assetSlug }",
  "// require() and process are disabled inside the kernel sandbox.",
  "module.exports.execute = function (input, ctx) {",
  "  var cycle = (ctx && ctx.cycle) || 1;",
  "  return { hello: 'world', cycle: cycle };",
  "};",
].join("\n");

const CAPABILITY_OPTIONS = [
  "intake", "transform", "logistics", "billing", "publish", "notify", "sink", "sensor", "scheduler",
];

export default function RegisterAssetForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ slug: string; codeHash: string; status: string } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setCreated(null);
    const form = new FormData(e.currentTarget);
    const caps = CAPABILITY_OPTIONS.filter((c) => form.get(`cap-${c}`));
    const body = {
      name: form.get("name"),
      description: form.get("description"),
      tags: String(form.get("tags") ?? "").split(","),
      capabilities: caps,
      royaltyBps: Number(form.get("royaltyBps") ?? 500),
      creatorAddress: form.get("creatorAddress"),
      creatorName: form.get("creatorName"),
      requiredOutputKeys: String(form.get("requiredOutputKeys") ?? "").split(","),
      requiredInputKeys: String(form.get("requiredInputKeys") ?? "").split(","),
      postconditions: String(form.get("postconditions") ?? ""),
      limits: {
        timeoutMs: Number(form.get("timeoutMs") ?? 1500),
        memoryMb: Number(form.get("memoryMb") ?? 64),
        maxOutputBytes: Number(form.get("maxOutputBytes") ?? 262144),
        maxEntropyBitsPerChar: Number(form.get("maxEntropyBitsPerChar") ?? 5.5),
      },
      code: form.get("code"),
    };
    try {
      const res = await fetch("/api/assets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? "registration failed");
      } else {
        setCreated({ slug: json.asset.slug, codeHash: json.asset.codeHash, status: json.asset.status });
        (e.target as HTMLFormElement).reset();
        router.refresh();
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-emerald-300"
      >
        + Mint new Code-Asset NFT
      </button>
    );
  }

  const inputCls =
    "w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-500/60 focus:outline-none";

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Mint a Code-Asset NFT</h2>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500 hover:text-slate-300">✕ close</button>
      </div>
      <p className="text-xs leading-relaxed text-slate-500">
        On registration the node computes sha256(code), mints the Z_q ring commitment C = g^a mod q, runs a live benchmark
        through the kernel sandbox, and sets the royalty interface. A failing benchmark auto-quarantines the asset.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-slate-500">name *</span>
          <input name="name" required maxLength={120} placeholder="My Logistics Optimizer" className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-slate-500">creator address *</span>
          <input name="creatorAddress" required placeholder="sov:you:0xabc…" className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-slate-500">creator name</span>
          <input name="creatorName" placeholder="Ada Dev" className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-slate-500">royalty bps (0–10000)</span>
          <input name="royaltyBps" type="number" defaultValue={500} min={0} max={10000} className={inputCls} />
        </label>
        <label className="block md:col-span-2">
          <span className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-slate-500">description</span>
          <textarea name="description" rows={2} placeholder="What does this module do?" className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-slate-500">tags (comma separated)</span>
          <input name="tags" placeholder="logistics, router, delivery" className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-slate-500">required output keys (comma)</span>
          <input name="requiredOutputKeys" placeholder="routes, summary" className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-slate-500">required input keys / pre-conditions (comma)</span>
          <input name="requiredInputKeys" placeholder="orders" className={inputCls} />
        </label>
        <label className="block md:col-span-2">
          <span className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-slate-500">post-conditions (one per line: key op value — ops: exists eq ne gt ge lt le in type)</span>
          <textarea name="postconditions" rows={3} placeholder={"attestation exists\n$root type object"} className={`${inputCls} font-mono text-xs`} />
        </label>
      </div>
      <div>
        <span className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-slate-500">capabilities (matched by intents)</span>
        <div className="flex flex-wrap gap-2">
          {CAPABILITY_OPTIONS.map((c) => (
            <label key={c} className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950/60 px-2.5 py-1.5 text-xs text-slate-300 has-[:checked]:border-emerald-500/60 has-[:checked]:bg-emerald-500/10">
              <input type="checkbox" name={`cap-${c}`} className="accent-emerald-400" />
              {c}
            </label>
          ))}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        {[ ["timeoutMs", "timeout ms", 1500], ["memoryMb", "memory MB", 64], ["maxOutputBytes", "max output B", 262144], ["maxEntropyBitsPerChar", "max entropy b/c", 5.5] ].map(([name, label, def]) => (
          <label key={name as string} className="block">
            <span className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-slate-500">{label}</span>
            <input name={name as string} type="number" step="any" defaultValue={def as number} className={inputCls} />
          </label>
        ))}
      </div>
      <label className="block">
        <span className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-slate-500">module code (sandboxed) *</span>
        <textarea
          name="code"
          required
          rows={12}
          defaultValue={TEMPLATE_CODE}
          spellCheck={false}
          className={`${inputCls} font-mono text-xs leading-relaxed`}
        />
      </label>
      {error && <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 font-mono text-xs text-rose-300">{error}</p>}
      {created && (
        <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 font-mono text-xs text-emerald-300">
          ✓ minted <span className="font-bold">{created.slug}</span> · sha256 {shortHash(created.codeHash)} · status{" "}
          <span className={created.status === "active" ? "text-emerald-300" : "text-amber-300"}>{created.status}</span>
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="rounded-lg bg-emerald-400 px-5 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-emerald-300 disabled:opacity-50"
      >
        {busy ? "Minting + benchmarking…" : "Mint Code-Asset NFT"}
      </button>
    </form>
  );
}
