import { listAccounts } from "@/lib/marketplace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/accounts — fiat-purchased execution-credit balances per user. */
export async function GET() {
  const rows = await listAccounts();
  return Response.json({ ok: true, accounts: rows });
}
