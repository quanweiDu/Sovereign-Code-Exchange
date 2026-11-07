import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { assets, royaltyLedger } from "@/db/schema";
import { inArray } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/ledger — micro-royalty & gas-dividend ledger (newest first). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") ?? 100)));
  const assetId = url.searchParams.get("assetId");
  const rows = assetId
    ? await db.select().from(royaltyLedger).where(eq(royaltyLedger.assetId, assetId)).orderBy(desc(royaltyLedger.createdAt)).limit(limit)
    : await db.select().from(royaltyLedger).orderBy(desc(royaltyLedger.createdAt)).limit(limit);
  const assetIds = [...new Set(rows.map((r) => r.assetId))];
  const mods = assetIds.length ? await db.select().from(assets).where(inArray(assets.id, assetIds)) : [];
  const byId = new Map(mods.map((m) => [m.id, m]));
  return Response.json({
    ok: true,
    entries: rows.map((r) => ({ ...r, assetName: byId.get(r.assetId)?.name ?? null, assetSlug: byId.get(r.assetId)?.slug ?? null })),
  });
}
