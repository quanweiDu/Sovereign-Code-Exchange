import Link from "next/link";
import GenesisPanel from "@/components/GenesisPanel";
import { getStats, recentExecutions } from "@/lib/marketplace";
import { fmtDate, fmtSov } from "@/lib/format";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LAYERS = [
  {
    n: "I",
    title: "SSU Manifest & Immutable Registry",
    tech: "core/ssu_manifest.py · src/lib/ring.ts · table: assets",
    body: "Every SSU (code, agent skill, control rule) carries a sha256 fingerprint, a Pedersen-style ring commitment C = g^a mod q over Z_q (q = 2^255−19), a runtime permission boundary, pre/post-condition invariant assertions, benchmarked performance, and an immutable creator royalty address.",
  },
  {
    n: "II",
    title: "Marketplace Engine — Order Book + Intent→DAG Matching",
    tech: "core/ssu_exchange.py · src/lib/intent.ts · src/lib/marketplace.ts · tables: orders, intents, assemblies, royalty_ledger",
    body: "A limit order book (bids/asks on SSU execution rights) matches on price-time priority and settles fills peer-to-peer in USDC. Natural-language intent is parsed into a capability DAG and routed to the best-benchmarked active SSUs. v3.0 dual-track settlement: fiat charges are HMAC-SHA256-signed by the gateway (Track A) and mint execution credits; the internal ledger credits 25.00 SOV per execution call (creator share + gas pool), and every call settles 1.00 USDC → creator (USDC) + node gas (USDT) on hash-chained, on-chain-verifiable transfers (Track B).",
  },
  {
    n: "III",
    title: "Asynchronous Meta-Kernel & Event Bus",
    tech: "core/meta_kernel.py · src/lib/kernel.ts · src/lib/bus.ts · tables: events, execution_steps",
    body: "Each SSU call runs in an isolated sandbox (permission boundary: no network/fs/process) with hard heap + wall-clock limits; outputs are validated against size, Shannon-entropy and pre/post-condition invariants. Violations trigger Automatic Fault Quarantine: the SSU is isolated in real time while the pipeline keeps running. All lifecycle events stream through the async event bus.",
  },
  {
    n: "IV",
    title: "Integrated Genesis Exchange Driver & Test Harness",
    tech: "genesis_exchange_runner.py (Python) · src/lib/genesis.ts · POST /api/genesis",
    body: "One call boots the node: seeds the industrial SSUs (fault-tolerant route scheduler, content publisher, post-quantum cryptography proxy, secure audit sink, fault-injecting telemetry fuser, cron scheduler), demonstrates the order book, resolves the canonical intent into a DAG and runs a multi-cycle production run — verifying quarantine of the telemetry SSU and author royalty credits. Zero placeholders.",
  },
];

export default async function HomePage() {
  const stats = await getStats();
  const recent = await recentExecutions(6);

  const cards = [
    { label: "Code-Asset NFTs", value: String(stats.assets.total), sub: `${stats.assets.active} active · ${stats.assets.quarantined} quarantined` },
    { label: "Executions", value: String(stats.executions), sub: `${stats.steps.ok} steps ok · ${stats.steps.quarantined} quarantined` },
    { label: "Intents parsed", value: String(stats.intents), sub: `${stats.assemblies} assemblies` },
    { label: "Royalties settled", value: `${fmtSov(stats.royaltiesMicro)} SOV`, sub: "lifetime micro-royalties + gas dividends" },
  ];

  return (
    <div className="space-y-10">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl border border-slate-800 bg-gradient-to-br from-emerald-500/15 via-slate-900 to-slate-950 p-8 md:p-12">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-emerald-500/20 blur-3xl" />
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-emerald-400">SCSEP · SSU Protocol · v3.0</p>
        <h1 className="mt-3 max-w-3xl text-4xl font-bold leading-[1.05] tracking-tight md:text-5xl">
          Sovereign Code &amp; Skill <span className="text-emerald-400">Exchange</span>
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-slate-400 md:text-base">
          Trade dynamic <b className="text-slate-200">Sovereign Code-Skill Units (SSUs)</b> — executable code, AI agent
          skills, system control rules and domain heuristics. <b className="text-cyan-300">Dual-track settlement</b>:
          non-technical users buy execution credits with fiat (Track A gateway, no wallet) and run verified SSUs from a
          plain-language intent; developers earn lifetime <b className="text-emerald-300">USDC royalty dividends</b> and node
          providers earn <b className="text-amber-300">USDT gas</b> (Track B) on every call, composition and trade.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/assembler" className="rounded-lg bg-emerald-400 px-5 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-emerald-300">
            Assemble from intent →
          </Link>
          <Link href="/marketplace" className="rounded-lg border border-slate-700 bg-slate-900/70 px-5 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-slate-500">
            Browse asset registry
          </Link>
          <Link href="/runner" className="rounded-lg border border-slate-700 bg-slate-900/70 px-5 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-slate-500">
            Execution runner
          </Link>
          <Link href="/settlement" className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-5 py-2.5 text-sm font-semibold text-cyan-200 transition hover:bg-cyan-500/20">
            Settlement rails (fiat + USDC/USDT)
          </Link>
        </div>
      </section>

      {/* Stats */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <p className="font-mono text-[11px] uppercase tracking-widest text-slate-500">{c.label}</p>
            <p className="mt-2 text-2xl font-bold text-slate-50 md:text-3xl">{c.value}</p>
            <p className="mt-1 text-xs text-slate-400">{c.sub}</p>
          </div>
        ))}
      </section>

      {/* Genesis */}
      <GenesisPanel />

      {/* Recent executions */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Recent execution runs</h2>
          <Link href="/runner" className="text-sm text-emerald-400 hover:underline">open runner →</Link>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/60">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 font-mono text-[11px] uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3">execution</th>
                <th className="px-4 py-3">assembly</th>
                <th className="px-4 py-3">cycles</th>
                <th className="px-4 py-3">status</th>
                <th className="px-4 py-3">ok / quarantined</th>
                <th className="px-4 py-3">royalties</th>
                <th className="px-4 py-3">started</th>
              </tr>
            </thead>
            <tbody>
              {recent.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">No runs yet — press “Run genesis” above.</td></tr>
              )}
              {recent.map((r) => (
                <tr key={r.execution.id} className="border-b border-slate-800/60 last:border-0 hover:bg-slate-800/30">
                  <td className="px-4 py-3 font-mono text-xs text-emerald-300">{r.execution.id.slice(0, 8)}…</td>
                  <td className="px-4 py-3 text-slate-300">{r.assemblyName ?? "—"}</td>
                  <td className="px-4 py-3">{r.execution.cycles}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 font-mono text-[11px] ${r.execution.status === "completed" ? "bg-emerald-500/10 text-emerald-300" : "bg-amber-500/10 text-amber-300"}`}>
                      {r.execution.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">
                    {r.execution.summary ? `${r.execution.summary.stepsOk} / ${r.execution.summary.stepsQuarantined}` : "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-emerald-300">
                    {r.execution.summary ? `${fmtSov(r.execution.summary.royaltiesMicro)} SOV` : "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{fmtDate(r.execution.startedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Blueprint */}
      <section>
        <h2 className="mb-1 text-xl font-semibold">Unified Genesis Dashboard — System Topology &amp; Layer 1–4 Architecture Blueprint</h2>
        <p className="mb-5 max-w-3xl text-sm text-slate-400">
          Four core engineering layers. Data flows top-down: intent → graph → assembly → kernel cycles → royalty ledger.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          {LAYERS.map((l) => (
            <div key={l.n} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-400/10 font-mono text-sm font-bold text-emerald-300 ring-1 ring-emerald-500/30">
                  {l.n}
                </span>
                <h3 className="font-semibold text-slate-100">{l.title}</h3>
              </div>
              <p className="mt-2 font-mono text-[11px] text-slate-500">{l.tech}</p>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{l.body}</p>
            </div>
          ))}
        </div>
        {/* ASCII topology */}
        <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950 p-5">
          <pre className="font-mono text-xs leading-relaxed text-slate-400">
{`  USER INTENT ──► [II] Marketplace Engine ──► intent→DAG + ORDER BOOK ──► ASSEMBLY (ordered SSU ids)
                        │  parseIntent()                (liquidity routing: best p50)        │
                        ▼                                                                       ▼
              [I] ASSET REGISTRY ◄──── registerAsset(): sha256 + Z_q commitment + benchmark ── assets[]
                        │                                                                       │
                        ▼                                                                       ▼
              [II] META-KERNEL: worker sandbox + limits + entropy invariant + EVENT BUS ◄─────────┘
                        │  per cycle × per module: runAssetModule() → ok | QUARANTINE (isolated, pipeline survives)
                        ▼
              execution_steps + events        [III] ROYALTY LEDGER: 1.0 SOV/cycle → creator(royaltyBps) + gas pool`}
          </pre>
        </div>
      </section>

      {/* Open-source manifest */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <h2 className="text-xl font-semibold">Open-Source Readiness &amp; Contribution Manifest</h2>
        <div className="mt-3 grid gap-4 text-sm leading-relaxed text-slate-400 md:grid-cols-3">
          <div>
            <h3 className="font-semibold text-slate-200">Publish as a public good</h3>
            <p className="mt-1">
              MIT-licensed, zero proprietary dependencies. Publish with{" "}
              <code className="rounded bg-slate-800 px-1 py-0.5 font-mono text-xs">git init &amp;&amp; git push</code> to a public
              GitHub repo — see <code className="rounded bg-slate-800 px-1 py-0.5 font-mono text-xs">README.md</code> for the exact manifest.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-slate-200">Plug in your module</h3>
            <p className="mt-1">
              Any developer can register a module via the Marketplace UI or{" "}
              <code className="rounded bg-slate-800 px-1 py-0.5 font-mono text-xs">POST /api/assets</code> — it is hashed, ring-committed,
              benchmarked and immediately matchable by intents.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-slate-200">Earn sustainable revenue</h3>
            <p className="mt-1">
              Set <code className="rounded bg-slate-800 px-1 py-0.5 font-mono text-xs">royaltyBps</code> at registration. Every execution cycle and every
              assembly composition credits your address in the royalty ledger — lifetime automated micro-royalties.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
