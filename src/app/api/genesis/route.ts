import { count } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { assets } from "@/db/schema";
import { runGenesis, SAMPLE_MODULES, seedGenesis } from "@/lib/genesis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/genesis — genesis node status. */
export async function GET() {
  const [row] = await db.select({ total: sql<number>`count(*)` }).from(assets);
  return Response.json({ ok: true, registeredAssets: Number(row.total), seeded: Number(row.total) >= SAMPLE_MODULES.length, expected: SAMPLE_MODULES.length });
}

/**
 * POST /api/genesis — the self-hosting genesis driver.
 * Body: { run?: boolean, cycles?: number }
 *  - always idempotently seeds the sample industrial modules
 *  - when run=true, also parses the canonical intent, assembles the pipeline
 *    and executes a multi-cycle production run with royalties + quarantine.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // empty body is fine
  }
  const run = body.run === true || body.run === "true";
  const cycles = Math.max(1, Math.min(10, Number(body.cycles ?? 3)));
  try {
    if (run) {
      const result = await runGenesis(cycles);
      return Response.json({ ok: true, mode: "genesis-run", ...result }, { status: 201 });
    }
    const seed = await seedGenesis();
    return Response.json({ ok: true, mode: "seed-only", seed });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

export { count };
