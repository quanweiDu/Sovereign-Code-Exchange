import { eq } from "drizzle-orm";
import { db } from "@/db";
import { intents } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const [row] = await db.select().from(intents).where(eq(intents.id, id)).limit(1);
  if (!row) return Response.json({ ok: false, error: "intent not found" }, { status: 404 });
  return Response.json({ ok: true, intent: row });
}
