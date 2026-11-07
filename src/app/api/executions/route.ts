import { desc } from "drizzle-orm";
import { db } from "@/db";
import { assemblies, executions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { executeAssembly, recentExecutions } from "@/lib/marketplace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/executions — recent multi-cycle runs. */
export async function GET() {
  const rows = await recentExecutions(25);
  return Response.json({ ok: true, executions: rows });
}

/**
 * POST /api/executions — run an assembly for N cycles through the meta-kernel.
 * Body: { assemblyId: string, cycles?: number (1..10) }
 * Runs synchronously and returns the full run: steps, quarantine events,
 * royalty settlement summary.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  const assemblyId = String(body.assemblyId ?? "");
  if (!assemblyId) {
    return Response.json({ ok: false, error: "assemblyId is required" }, { status: 400 });
  }
  const cycles = Math.max(1, Math.min(10, Number(body.cycles ?? 3)));
  const payer = String(body.payer ?? "user:anon").trim() || "user:anon";
  const [assembly] = await db.select().from(assemblies).where(eq(assemblies.id, assemblyId)).limit(1);
  if (!assembly) return Response.json({ ok: false, error: "assembly not found" }, { status: 404 });
  try {
    const result = await executeAssembly(assemblyId, cycles, payer);
    return Response.json({ ok: true, ...result }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

export { desc };
