// v3.0 — Fiat HMAC Gateway + settlement chain verifier (node:crypto only).
// The PSP-style fiat gateway authenticates every charge with an HMAC-SHA256
// signature over the canonical payload; the node verifies it before accepting.
import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { stableStringify } from "@/lib/ring";

const GATEWAY_SECRET = process.env.SCSEP_GATEWAY_SECRET ?? "scsep-dev-gateway-secret-v3";

export function gatewaySign(payload: Record<string, unknown>): string {
  return createHmac("sha256", GATEWAY_SECRET).update(stableStringify(payload)).digest("hex");
}

export function gatewayVerify(payload: Record<string, unknown>, signature: string | null | undefined): boolean {
  if (!signature) return false;
  const expected = gatewaySign(payload);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function settlementTxHash(prevHead: string, payload: Record<string, unknown>): string {
  return createHash("sha256").update(prevHead + "|" + stableStringify(payload)).digest("hex");
}
