import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { assemblies } from "@/db/schema";
import { createAssemblyFromAssetIds, createAssemblyFromIntent } from "@/lib/marketplace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/assemblies — recent assembled pipelines. */
export async function GET() {
  const rows = await db.select().from(assemblies).orderBy(desc(assemblies.createdAt)).limit(25);
  return Response.json({ ok: true, assemblies: rows });
}

/**
 * POST /api/assemblies — assemble a pipeline.
 * Body either { intentId } (resolve the intent's graph) or
 * { assetIds: string[], name?, description? } (manual assembly).
 * Composition micro-royalties are credited to every creator immediately.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  try {
    if (typeof body.intentId === "string") {
      const assembly = await createAssemblyFromIntent(
        body.intentId,
        typeof body.name === "string" ? body.name : undefined,
      );
      return Response.json({ ok: true, assembly }, { status: 201 });
    }
    if (Array.isArray(body.assetIds) && body.assetIds.length > 0 && body.assetIds.length <= 12) {
      const assetIds = body.assetIds.map((x) => String(x));
      const name = String(body.name ?? `Manual assembly ${new Date().toISOString().slice(0, 19)}`);
      const assembly = await createAssemblyFromAssetIds(assetIds, name, String(body.description ?? ""));
      return Response.json({ ok: true, assembly }, { status: 201 });
    }
    return Response.json({ ok: false, error: "provide intentId or assetIds[]" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /not found/i.test(message) ? 404 : 500;
    return Response.json({ ok: false, error: message }, { status });
  }
}

export { eq };
