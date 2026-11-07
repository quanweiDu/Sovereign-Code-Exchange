import { listCreators } from "@/lib/marketplace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/creators — aggregated lifetime earnings per creator address. */
export async function GET() {
  const rows = await listCreators();
  return Response.json({ ok: true, creators: rows });
}
