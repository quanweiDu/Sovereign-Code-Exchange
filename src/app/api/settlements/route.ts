import { listSettlements, purchaseCreditsFiat, railStats } from "@/lib/marketplace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/settlements — dual-track settlement log + rail stats + accounts.
 * POST /api/settlements — Track A fiat purchase:
 *   { action: "purchase", user, amount, currency?, method? }
 *   → PSP gateway charge (fiat rail) + execution credits minted (USDC rail).
 */
export async function GET() {
  const [transfers, stats] = await Promise.all([listSettlements(150), railStats()]);
  return Response.json({ ok: true, transfers, stats });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  try {
    if (body.action === "purchase" || body.user) {
      const user = String(body.user ?? "").trim();
      const amount = Number(body.amount ?? 0);
      if (!user) return Response.json({ ok: false, error: "user is required" }, { status: 400 });
      const receipt = await purchaseCreditsFiat(
        user,
        amount,
        String(body.currency ?? "USD"),
        String(body.method ?? "card"),
      );
      return Response.json({ ok: true, receipt }, { status: 201 });
    }
    return Response.json({ ok: false, error: "provide action:'purchase' + user + amount" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}
