import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { assemblies, assets, executionSteps, executions } from "@/db/schema";
import RunnerPanel, { type AssemblyOption } from "@/components/RunnerPanel";
import { fmtDate, fmtSov } from "@/lib/format";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function RunnerPage() {
  const assemblyRows = await db.select().from(assemblies).orderBy(desc(assemblies.createdAt)).limit(25);
  const allAssetIds = [...new Set(assemblyRows.flatMap((a) => (a.assetIds ?? []) as string[]))];
  const assetRows = allAssetIds.length ? await db.select().from(assets).where(inArray(assets.id, allAssetIds)) : [];
  const assetName: Record<string, string> = {};
  for (const a of assetRows) assetName[a.id] = a.name;

  const options: AssemblyOption[] = assemblyRows.map((a) => ({
    id: a.id,
    name: a.name,
    status: a.status,
    assetCount: (a.assetIds ?? []).length,
    createdAt: a.createdAt.toISOString(),
  }));

  const recent = await db
    .select({ execution: executions, assemblyName: assemblies.name })
    .from(executions)
    .leftJoin(assemblies, eq(executions.assemblyId, assemblies.id))
    .orderBy(desc(executions.startedAt))
    .limit(12);
  const execIds = recent.map((r) => r.execution.id);
  const stepRows = execIds.length
    ? await db.select().from(executionSteps).where(inArray(executionSteps.executionId, execIds))
    : [];

  return (
    <div className="space-y-8">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-emerald-400">Layers II + IV · Execution</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Meta-Kernel Runner</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">
          Execute an assembled pipeline for N cycles. Each module runs in an isolated worker sandbox with heap and
          wall-clock limits; outputs are checked against size, entropy and schema invariants. Violations trigger
          Automatic Domain Quarantine — the failing module is isolated and the pipeline keeps flowing. Every
          successful step settles micro-royalties to its creator instantly.
        </p>
      </div>

      {options.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-700 p-10 text-center text-sm text-slate-500">
          No assemblies yet.{" "}
          <Link href="/assembler" className="text-emerald-400 hover:underline">Assemble one from an intent →</Link>
        </div>
      ) : (
        <RunnerPanel assemblies={options} assetNames={assetName} />
      )}

      <section>
        <h2 className="mb-3 text-lg font-semibold">Execution history</h2>
        <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/60">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 font-mono text-[11px] uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3">execution</th>
                <th className="px-4 py-3">assembly</th>
                <th className="px-4 py-3">cycles</th>
                <th className="px-4 py-3">status</th>
                <th className="px-4 py-3">ok</th>
                <th className="px-4 py-3">quarantined</th>
                <th className="px-4 py-3">skipped</th>
                <th className="px-4 py-3">royalties</th>
                <th className="px-4 py-3">started</th>
              </tr>
            </thead>
            <tbody>
              {recent.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-500">No runs yet.</td></tr>
              )}
              {recent.map((r) => {
                const steps = stepRows.filter((s) => s.executionId === r.execution.id);
                return (
                  <tr key={r.execution.id} className="border-b border-slate-800/60 last:border-0 hover:bg-slate-800/30">
                    <td className="px-4 py-3 font-mono text-xs text-emerald-300">{r.execution.id.slice(0, 8)}…</td>
                    <td className="px-4 py-3 text-slate-300">{r.assemblyName ?? "—"}</td>
                    <td className="px-4 py-3">{r.execution.cycles}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 font-mono text-[11px] ${r.execution.status === "completed" ? "bg-emerald-500/10 text-emerald-300" : "bg-amber-500/10 text-amber-300"}`}>{r.execution.status}</span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-emerald-300">{steps.filter((s) => s.status === "ok").length}</td>
                    <td className="px-4 py-3 font-mono text-xs text-amber-300">{steps.filter((s) => s.status === "quarantined").length}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-400">{steps.filter((s) => s.status === "skipped").length}</td>
                    <td className="px-4 py-3 font-mono text-xs text-emerald-300">{r.execution.summary ? `${fmtSov(r.execution.summary.royaltiesMicro)} SOV` : "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{fmtDate(r.execution.startedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
