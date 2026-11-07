import { verifySettlementLog } from "@/lib/marketplace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/settlements/verify — audit the settlement log:
 * recomputes the SHA-256 hash chain of all transfers and re-verifies every
 * fiat-rail HMAC-SHA256 gateway signature (timing-safe). USDC/USDT transfers
 * are chain-anchored (on-chain-style tx hashes).
 */
export async function POST() {
  const result = await verifySettlementLog();
  return Response.json({ ok: true, valid: result.chainValid && result.hmacValid, ...result });
}
