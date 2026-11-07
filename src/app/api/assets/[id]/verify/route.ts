import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assets } from "@/db/schema";
import { verifyRing } from "@/lib/ring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/assets/:id/verify — explicit state-invariant assertion:
 * recompute sha256(code) and the Z_q ring commitment C = g^a mod q and compare
 * against the immutable registered metadata.
 */
export async function POST(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const [asset] = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
  if (!asset) return Response.json({ ok: false, error: "asset not found" }, { status: 404 });
  const result = verifyRing(asset.code, asset.codeHash, asset.ring);
  return Response.json({ ok: true, assetId: id, slug: asset.slug, ...result });
}
