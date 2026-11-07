import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assets, royaltyLedger } from "@/db/schema";
import { sql } from "drizzle-orm";
import { benchmarkAsset, DEFAULT_MANIFEST_LIMITS } from "@/lib/marketplace";
import { ringCommit, sha256Hex } from "@/lib/ring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/assets/:id — full immutable metadata of one Code-Asset NFT. */
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const [asset] = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
  if (!asset) return Response.json({ ok: false, error: "asset not found" }, { status: 404 });
  const earnings = await db
    .select({ total: sql<string>`coalesce(sum(${royaltyLedger.amountMicro}), 0)` })
    .from(royaltyLedger)
    .where(eq(royaltyLedger.assetId, id));
  return Response.json({ ok: true, asset, earnedMicro: Number(earnings[0]?.total ?? 0) });
}

/**
 * PATCH /api/assets/:id — update mutable fields. If `code` changes, the sha256
 * hash + Z_q ring commitment are recomputed and the module is re-benchmarked;
 * a failing re-benchmark quarantines the asset automatically.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const [existing] = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
  if (!existing) return Response.json({ ok: false, error: "asset not found" }, { status: 404 });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.status === "string" && (body.status === "active" || body.status === "quarantined")) {
    update.status = body.status;
    update.quarantineReason = body.status === "active" ? null : String(body.quarantineReason ?? "manually quarantined");
  }
  if (typeof body.code === "string" && body.code.length >= 10 && body.code !== existing.code) {
    const codeHash = sha256Hex(body.code);
    const ring = ringCommit(body.code);
    const limits = { ...DEFAULT_MANIFEST_LIMITS, ...(existing.manifest?.limits ?? {}) };
    const requiredKeys = existing.manifest?.outputs?.requiredKeys ?? [];
    const benchmarks = await benchmarkAsset(body.code, limits, requiredKeys);
    update.code = body.code;
    update.codeHash = codeHash;
    update.ring = ring;
    update.benchmarks = benchmarks;
    update.status = benchmarks.ok ? "active" : "quarantined";
    update.quarantineReason = benchmarks.ok ? null : `re-benchmark failed — ${benchmarks.error ?? "unknown"}`;
  }
  if (typeof body.royaltyBps === "number") {
    update.royaltyBps = Math.max(0, Math.min(10000, Math.round(body.royaltyBps)));
  }
  if (typeof body.description === "string") update.description = body.description;
  const [row] = await db.update(assets).set(update).where(eq(assets.id, id)).returning();
  return Response.json({ ok: true, asset: row });
}
