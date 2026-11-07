import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assemblies, assets } from "@/db/schema";
import { inArray } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const [row] = await db.select().from(assemblies).where(eq(assemblies.id, id)).limit(1);
  if (!row) return Response.json({ ok: false, error: "assembly not found" }, { status: 404 });
  const assetIds = (row.assetIds ?? []) as string[];
  const mods = assetIds.length
    ? await db.select().from(assets).where(inArray(assets.id, assetIds))
    : [];
  return Response.json({ ok: true, assembly: row, assets: mods });
}
