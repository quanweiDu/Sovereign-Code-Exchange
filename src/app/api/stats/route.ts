import { getStats, recentExecutions } from "@/lib/marketplace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/stats — dashboard aggregates. */
export async function GET() {
  const stats = await getStats();
  const recent = await recentExecutions(8);
  return Response.json({ ok: true, stats, recentExecutions: recent });
}
