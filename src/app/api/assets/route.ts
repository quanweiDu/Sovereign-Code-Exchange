import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { assets } from "@/db/schema";
import { listAssetsWithEarnings, registerAsset } from "@/lib/marketplace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/assets — list all Code-Asset NFTs with lifetime earnings. */
export async function GET() {
  const rows = await listAssetsWithEarnings();
  return Response.json({ ok: true, assets: rows });
}

/** POST /api/assets — mint/register a new Code-Asset NFT. */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  const name = String(body.name ?? "").trim();
  const code = String(body.code ?? "");
  const creatorAddress = String(body.creatorAddress ?? "").trim();
  if (!name || name.length > 120) {
    return Response.json({ ok: false, error: "name is required (max 120 chars)" }, { status: 400 });
  }
  if (!code || code.length < 10) {
    return Response.json({ ok: false, error: "code is required (min 10 chars)" }, { status: 400 });
  }
  if (!creatorAddress) {
    return Response.json({ ok: false, error: "creatorAddress is required" }, { status: 400 });
  }
  const tags = Array.isArray(body.tags)
    ? body.tags.map((t) => String(t).toLowerCase().trim()).filter(Boolean).slice(0, 16)
    : String(body.tags ?? "").split(",").map((t) => t.toLowerCase().trim()).filter(Boolean).slice(0, 16);
  const capabilities = Array.isArray(body.capabilities)
    ? body.capabilities.map((c) => String(c).toLowerCase().trim()).filter(Boolean).slice(0, 8)
    : String(body.capabilities ?? "").split(",").map((c) => c.toLowerCase().trim()).filter(Boolean).slice(0, 8);
  const requiredOutputKeys = Array.isArray(body.requiredOutputKeys)
    ? body.requiredOutputKeys.map((k) => String(k).trim()).filter(Boolean).slice(0, 16)
    : [];
  const requiredInputKeys = Array.isArray(body.requiredInputKeys)
    ? body.requiredInputKeys.map((k) => String(k).trim()).filter(Boolean).slice(0, 16)
    : String(body.requiredInputKeys ?? "").split(",").map((k) => k.trim()).filter(Boolean).slice(0, 16);
  // postconditions: array of {key, op, value} or newline "key op value" lines
  const postconditions: { key: string; op: string; value?: unknown }[] = Array.isArray(body.postconditions)
    ? body.postconditions.map((c) => {
        const o = c as Record<string, unknown>;
        return { key: String(o.key ?? ""), op: String(o.op ?? "exists"), value: o.value };
      }).filter((c) => c.key && c.op)
    : String(body.postconditions ?? "").split("\n").map((line) => {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 2) return null;
        let value: unknown = parts.slice(2).join(" ");
        try { value = JSON.parse(value as string); } catch { /* keep string */ }
        return { key: parts[0], op: parts[1], value };
      }).filter((c): c is { key: string; op: string; value: unknown } => Boolean(c));
  const royaltyBps = Number(body.royaltyBps ?? 500);
  if (!Number.isFinite(royaltyBps) || royaltyBps < 0 || royaltyBps > 10000) {
    return Response.json({ ok: false, error: "royaltyBps must be between 0 and 10000" }, { status: 400 });
  }
  const limitsBody = (body.limits ?? {}) as Record<string, unknown>;
  const limits = {
    timeoutMs: Number(limitsBody.timeoutMs ?? 1500),
    memoryMb: Number(limitsBody.memoryMb ?? 64),
    maxOutputBytes: Number(limitsBody.maxOutputBytes ?? 256 * 1024),
    maxEntropyBitsPerChar: Number(limitsBody.maxEntropyBitsPerChar ?? 5.5),
  };
  try {
    const asset = await registerAsset({
      name,
      description: String(body.description ?? ""),
      tags,
      code,
      capabilities,
      royaltyBps,
      creatorAddress,
      creatorName: String(body.creatorName ?? "anonymous"),
      limits,
      requiredOutputKeys,
      requiredInputKeys,
      postconditions: postconditions as never,
    });
    return Response.json({ ok: true, asset }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

/** Helper used by other routes. */
export async function getAssetOr404(id: string) {
  const [row] = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
  return row ?? null;
}

export { desc };
