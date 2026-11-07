import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { assets, events, executionSteps, executions } from "@/db/schema";
import { inArray } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/executions/:id — one run with its steps, assets and event stream. */
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const [execution] = await db.select().from(executions).where(eq(executions.id, id)).limit(1);
  if (!execution) return Response.json({ ok: false, error: "execution not found" }, { status: 404 });
  const steps = await db
    .select()
    .from(executionSteps)
    .where(eq(executionSteps.executionId, id))
    .orderBy(asc(executionSteps.createdAt));
  const assetIds = [...new Set(steps.map((s) => s.assetId))];
  const mods = assetIds.length ? await db.select().from(assets).where(inArray(assets.id, assetIds)) : [];
  const evts = await db
    .select()
    .from(events)
    .where(eq(events.executionId, id))
    .orderBy(asc(events.createdAt))
    .limit(500);
  return Response.json({ ok: true, execution, steps, assets: mods, events: evts });
}
