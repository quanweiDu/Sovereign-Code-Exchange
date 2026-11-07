import { desc } from "drizzle-orm";
import { db } from "@/db";
import { intents } from "@/db/schema";
import { createIntent } from "@/lib/marketplace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/intents — recent parsed intents. */
export async function GET() {
  const rows = await db.select().from(intents).orderBy(desc(intents.createdAt)).limit(25);
  return Response.json({ ok: true, intents: rows });
}

/**
 * POST /api/intents — parse natural language into a capability set and resolve
 * it against the registry into a dependency graph of Code-Asset NFTs.
 * Body: { text: string }
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  const text = String(body.text ?? "").trim();
  if (text.length < 8 || text.length > 2000) {
    return Response.json({ ok: false, error: "text must be 8..2000 chars" }, { status: 400 });
  }
  try {
    const intent = await createIntent(text);
    return Response.json({ ok: true, intent }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
