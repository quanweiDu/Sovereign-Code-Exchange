import { cancelOrder, listOrders, placeOrder } from "@/lib/marketplace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/orders — order book (newest first, includes asset names).
 * POST /api/orders — place or cancel an order.
 *   place:  { action?: "place", side: "bid"|"ask", assetId, owner, priceMicro, qty }
 *   cancel: { action: "cancel", id, owner }
 * Fills settle peer-to-peer into the royalty ledger (trade-credit/trade-debit).
 */
export async function GET() {
  const rows = await listOrders(100);
  return Response.json({ ok: true, orders: rows });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  try {
    if (body.action === "cancel") {
      const row = await cancelOrder(String(body.id ?? ""), String(body.owner ?? ""));
      if (!row) return Response.json({ ok: false, error: "open order not found for owner" }, { status: 404 });
      return Response.json({ ok: true, order: row });
    }
    const side = String(body.side ?? "");
    const assetId = String(body.assetId ?? "");
    const owner = String(body.owner ?? "").trim();
    if (!assetId || !owner) {
      return Response.json({ ok: false, error: "assetId and owner are required" }, { status: 400 });
    }
    const result = await placeOrder({
      side: side === "ask" ? "ask" : "bid",
      assetId,
      owner,
      priceMicro: Number(body.priceMicro ?? 0),
      qty: Number(body.qty ?? 1),
    });
    return Response.json({ ok: true, ...result }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /not found/i.test(message) ? 404 : 400;
    return Response.json({ ok: false, error: message }, { status });
  }
}
