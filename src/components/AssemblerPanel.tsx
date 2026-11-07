"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import GraphView from "@/components/GraphView";
import type { AssetGraph } from "@/lib/types";

const DEFAULT_INTENT =
  "Deploy an automated delivery dispatch and podcast publishing pipeline with secure data warehousing, audit logging and telemetry monitoring";

interface IntentResponse {
  ok: boolean;
  error?: string;
  intent?: {
    id: string;
    rawText: string;
    confidence: number;
    status: string;
    graph: AssetGraph;
    parsed: { capabilities: { key: string; hits: string[] }[] };
  };
}

interface AssemblyResponse {
  ok: boolean;
  error?: string;
  assembly?: { id: string; name: string; assetIds: string[]; status: string };
}

export default function AssemblerPanel() {
  const router = useRouter();
  const [text, setText] = useState(DEFAULT_INTENT);
  const [parsing, setParsing] = useState(false);
  const [assembling, setAssembling] = useState(false);
  const [result, setResult] = useState<IntentResponse | null>(null);
  const [assembly, setAssembly] = useState<AssemblyResponse | null>(null);

  async function parse() {
    setParsing(true);
    setResult(null);
    setAssembly(null);
    try {
      const res = await fetch("/api/intents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const json = (await res.json()) as IntentResponse;
      setResult(json);
      if (json.ok) router.refresh();
    } catch (err) {
      setResult({ ok: false, error: String(err) });
    } finally {
      setParsing(false);
    }
  }

  async function assemble() {
    if (!result?.intent) return;
    setAssembling(true);
    setAssembly(null);
    try {
      const res = await fetch("/api/assemblies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intentId: result.intent.id }),
      });
      const json = (await res.json()) as AssemblyResponse;
      setAssembly(json);
      if (json.ok) router.refresh();
    } catch (err) {
      setAssembly({ ok: false, error: String(err) });
    } finally {
      setAssembling(false);
    }
  }

  const graph = result?.intent?.graph;

  return (
    <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
      <label className="block">
        <span className="mb-2 block font-mono text-xs uppercase tracking-[0.2em] text-emerald-400">
          Natural-language intent
        </span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          className="w-full rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-sm leading-relaxed text-slate-100 placeholder:text-slate-600 focus:border-emerald-500/60 focus:outline-none"
          placeholder="e.g. Deploy an automated delivery dispatch and podcast publishing pipeline…"
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => void parse()}
          disabled={parsing || text.trim().length < 8}
          className="rounded-lg bg-emerald-400 px-5 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-emerald-300 disabled:opacity-50"
        >
          {parsing ? "Parsing…" : "1 · Parse intent → dependency graph"}
        </button>
        {graph && (
          <button
            onClick={() => void assemble()}
            disabled={assembling || graph.nodes.every((n) => n.status !== "resolved")}
            className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-5 py-2.5 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-50"
          >
            {assembling ? "Assembling + settling composition royalties…" : "2 · Assemble pipeline (credits creators)"}
          </button>
        )}
      </div>

      {result && !result.ok && (
        <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 font-mono text-xs text-rose-300">{result.error}</p>
      )}

      {result?.ok && result.intent && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 font-mono text-[11px]">
            <span className="rounded-full bg-slate-800 px-2.5 py-1 text-slate-300">
              confidence {(result.intent.confidence * 100).toFixed(0)}%
            </span>
            <span className={`rounded-full px-2.5 py-1 ${result.intent.status === "resolved" ? "bg-emerald-500/10 text-emerald-300" : result.intent.status === "partial" ? "bg-amber-500/10 text-amber-300" : "bg-rose-500/10 text-rose-300"}`}>
              {result.intent.status}
            </span>
            {result.intent.parsed.capabilities.map((c) => (
              <span key={c.key} className="rounded-full border border-slate-700 px-2.5 py-1 text-slate-400">
                {c.key} <span className="text-slate-600">[{c.hits.join(", ")}]</span>
              </span>
            ))}
          </div>
          {graph && <GraphView graph={graph} />}
          {assembly && (
            <div className={`rounded-xl border p-4 font-mono text-xs ${assembly.ok ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-300" : "border-rose-500/40 bg-rose-500/5 text-rose-300"}`}>
              {assembly.ok && assembly.assembly ? (
                <p>
                  ✓ assembly <span className="font-bold">{assembly.assembly.id.slice(0, 8)}…</span> “{assembly.assembly.name}” —{" "}
                  {assembly.assembly.assetIds.length} assets composed, composition fees settled.{" "}
                  <a href="/runner" className="underline">Run it →</a>
                </p>
              ) : (
                <p>error: {assembly.error}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
