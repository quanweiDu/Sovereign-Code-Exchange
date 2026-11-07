// Layer 3 — Intent-Driven Assembler & Marketplace Engine.
// Resolves parsed intents to concrete Code-Asset NFTs (liquidity routing of
// compute), builds assemblies, executes multi-cycle production runs through
// the meta-kernel, and settles micro-royalties / gas dividends on every cycle.
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  assemblies,
  assets,
  events,
  executionSteps,
  executions,
  intents,
  orders,
  royaltyLedger,
  settlements,
  type AssetRow,
  type AssemblyRow,
} from "@/db/schema";
import { emit, onEvent } from "@/lib/bus";
import { buildGraph, CAPABILITY_BY_KEY, parseIntent } from "@/lib/intent";
import { runAssetModule, type StepOutcome } from "@/lib/kernel";
import { ringCommit, sha256Hex, stableStringify } from "@/lib/ring";
import { gatewaySign, gatewayVerify, settlementTxHash } from "@/lib/gateway";
import type {
  AssetGraph,
  AssetManifest,
  Benchmarks,
  ExecutionSummary,
  ModuleLimits,
  ParsedIntent,
  PostCondition,
} from "@/lib/types";

/** Fee units (micro-SOV) routed per event. */
export const EXECUTION_CYCLE_FEE_MICRO = 25_000_000; // v3.0: 25.00 SOV ledger credit per executed module-cycle
export const COMPOSITION_FEE_MICRO = 2_500_000; // v3.0: 2.50 SOV per asset composed into an assembly
export const GAS_POOL_ADDRESS = "pool:gas-dividends";

// ---------------------------------------------------------------------------
// v3.0 Dual-Track Settlement (fiat gateway + native USDC/USDT rails)
// ---------------------------------------------------------------------------
export const SETTLEMENT_CHAIN_GENESIS = "SCSEP-V3-GENESIS";
export const NODE_ADDRESS = "node:scsep-local-1";
export const TREASURY = "treasury:settlement";
export const FIAT_GATEWAY = "gateway:scsep-psp";
export const EXECUTION_FEE_USDC_MICRO = 1_000_000; // 1.00 USDC per execution call
export const COMPOSITION_FEE_USDC_MICRO = 100_000; // 0.10 USDC per composition
export const FIAT_FX_TO_USD: Record<string, number> = { USD: 1, EUR: 1.08, GBP: 1.27, NGN: 0.00065, INR: 0.012 };

async function chainHead(): Promise<string> {
  const [last] = await db.select({ txHash: settlements.txHash }).from(settlements).orderBy(desc(settlements.createdAt)).limit(1);
  return last?.txHash ?? SETTLEMENT_CHAIN_GENESIS;
}

async function appendSettlement(row: {
  rail: string; asset: string; fromAddress: string; toAddress: string;
  amountMicro: number; kind: string; refId?: string | null; memo: string; sig?: string; atDate?: Date;
}): Promise<void> {
  const head = await chainHead();
  const at = row.atDate ?? new Date();
  // canonical payload — the stored row + createdAt are the exact source of truth for verification
  const payload = {
    rail: row.rail, asset: row.asset, fromAddress: row.fromAddress, toAddress: row.toAddress,
    amountMicro: row.amountMicro, kind: row.kind, refId: row.refId ?? null, memo: row.memo,
    at: at.toISOString(),
  };
  const txHash = settlementTxHash(head, payload);
  await db.insert(settlements).values({
    rail: row.rail, asset: row.asset, fromAddress: row.fromAddress, toAddress: row.toAddress,
    amountMicro: row.amountMicro, kind: row.kind, refId: row.refId ?? null, memo: row.memo,
    sig: row.sig ?? null, txHash, createdAt: at,
  });
}

/** Track B: one execution call settles 1.00 USDC → creator royalty (USDC) + node gas (USDT). */
export async function settleExecutionDualTrack(asset: AssetRow, cycle: number, executionId: string, payer: string): Promise<void> {
  const fee = EXECUTION_FEE_USDC_MICRO;
  const creatorMicro = Math.floor((fee * asset.royaltyBps) / 10000);
  const gasMicro = fee - creatorMicro;
  await appendSettlement({
    rail: "USDC", asset: "USDC", fromAddress: TREASURY, toAddress: asset.creatorAddress,
    amountMicro: creatorMicro, kind: "royalty-dividend", refId: executionId,
    memo: `cycle ${cycle} execution dividend ${asset.royaltyBps / 100}% for ${asset.slug}`,
  });
  await appendSettlement({
    rail: "USDT", asset: "USDT", fromAddress: TREASURY, toAddress: NODE_ADDRESS,
    amountMicro: gasMicro, kind: "gas-dividend", refId: executionId,
    memo: `cycle ${cycle} node gas for executing ${asset.slug}`,
  });
  await consumeCredits(payer, fee, executionId);
}

export async function settleCompositionDualTrack(asset: AssetRow, assemblyId: string, payer: string): Promise<void> {
  const fee = COMPOSITION_FEE_USDC_MICRO;
  const creatorMicro = Math.floor((fee * asset.royaltyBps) / 10000);
  const gasMicro = fee - creatorMicro;
  await appendSettlement({
    rail: "USDC", asset: "USDC", fromAddress: TREASURY, toAddress: asset.creatorAddress,
    amountMicro: creatorMicro, kind: "royalty-dividend", refId: assemblyId,
    memo: `composition dividend for ${asset.slug}`,
  });
  await appendSettlement({
    rail: "USDT", asset: "USDT", fromAddress: TREASURY, toAddress: NODE_ADDRESS,
    amountMicro: gasMicro, kind: "gas-dividend", refId: assemblyId,
    memo: `composition node gas for ${asset.slug}`,
  });
  await consumeCredits(payer, fee, assemblyId);
}

async function consumeCredits(payer: string, amountMicro: number, refId: string): Promise<void> {
  const [acc] = await db.select().from(accounts).where(eq(accounts.address, payer)).limit(1);
  const avail = acc?.creditsMicro ?? 0;
  const take = Math.min(avail, amountMicro);
  if (take > 0) {
    await db.update(accounts).set({ creditsMicro: avail - take, updatedAt: new Date() }).where(eq(accounts.address, payer));
    await appendSettlement({
      rail: "USDC", asset: "CREDITS", fromAddress: payer, toAddress: TREASURY,
      amountMicro: take, kind: "execution-debit", refId,
      memo: `${(take / 1e6).toFixed(6)} USDC credits consumed by ${payer}`,
    });
  }
}

/** Track A: fiat purchase through the PSP gateway abstraction → mints execution credits. */
export async function purchaseCreditsFiat(user: string, fiatAmount: number, currency = "USD", method = "card") {
  const cur = currency.toUpperCase();
  const fx = FIAT_FX_TO_USD[cur];
  if (!fx) throw new Error(`unsupported fiat currency ${cur}`);
  if (!Number.isFinite(fiatAmount) || fiatAmount <= 0) throw new Error("amount must be positive");
  const cents = Math.round(fiatAmount * 100);
  const creditsMicro = Math.round((cents / 100) * fx * 1e6);
  const head = await chainHead();
  const at = new Date();
  const chargePayload = { gateway_charge: user, cents, currency: cur, at: at.toISOString() };
  const receipt = settlementTxHash(head, chargePayload);
  const sig = gatewaySign(chargePayload); // Fiat HMAC Gateway signature (HMAC-SHA256)
  await appendSettlement({
    rail: "fiat", asset: cur, fromAddress: user, toAddress: FIAT_GATEWAY,
    amountMicro: cents, kind: "fiat-purchase", sig, atDate: at,
    memo: `${method} charge ${fiatAmount.toFixed(2)} ${cur} (receipt ${receipt.slice(0, 12)}…)`,
  });
  await appendSettlement({
    rail: "USDC", asset: "CREDITS", fromAddress: FIAT_GATEWAY, toAddress: user,
    amountMicro: creditsMicro, kind: "credit-mint",
    memo: `execution credits minted for ${fiatAmount.toFixed(2)} ${cur} (≈ ${(creditsMicro / 1e6).toFixed(2)} USDC)`,
  });
  const [acc] = await db.select().from(accounts).where(eq(accounts.address, user)).limit(1);
  if (acc) {
    await db.update(accounts).set({ creditsMicro: acc.creditsMicro + creditsMicro, updatedAt: new Date() }).where(eq(accounts.address, user));
  } else {
    await db.insert(accounts).values({ address: user, creditsMicro });
  }
  return { receipt, user, charged: fiatAmount, currency: cur, method, creditsMicro, creditsUsdc: creditsMicro / 1e6 };
}

export async function listSettlements(limit = 100) {
  return db.select().from(settlements).orderBy(desc(settlements.createdAt)).limit(limit);
}

export async function railStats() {
  const rows = await db
    .select({ rail: settlements.rail, kind: settlements.kind, total: sql<string>`coalesce(sum(${settlements.amountMicro}), 0)` })
    .from(settlements)
    .groupBy(settlements.rail, settlements.kind);
  const accountsRows = await db.select().from(accounts).orderBy(desc(accounts.creditsMicro)).limit(50);
  const chainOkRow = await db.select({ txHash: settlements.txHash }).from(settlements).orderBy(desc(settlements.createdAt)).limit(1);
  return {
    byRailKind: rows.map((r) => ({ rail: r.rail, kind: r.kind, totalMicro: Number(r.total) })),
    accounts: accountsRows,
    transfers: (await db.select({ n: sql<number>`count(*)` }).from(settlements))[0]?.n ?? 0,
    chainHead: chainOkRow[0]?.txHash ?? SETTLEMENT_CHAIN_GENESIS,
  };
}

export async function listAccounts() {
  return db.select().from(accounts).orderBy(desc(accounts.creditsMicro)).limit(50);
}

// ---------------------------------------------------------------------------
// Event-bus persistence (registered once per process).
// ---------------------------------------------------------------------------
const globalForBus = globalThis as typeof globalThis & { __sovBusRegistered?: boolean };
if (!globalForBus.__sovBusRegistered) {
  globalForBus.__sovBusRegistered = true;
  onEvent(async (type, payload) => {
    try {
      await db.insert(events).values({
        executionId: (payload.executionId as string | undefined) ?? null,
        type,
        payload,
      });
    } catch {
      // telemetry must never break execution
    }
  });
}

// ---------------------------------------------------------------------------
// Asset registry helpers
// ---------------------------------------------------------------------------
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export interface RegisterAssetInput {
  name: string;
  description?: string;
  tags: string[];
  code: string;
  capabilities: string[];
  royaltyBps: number;
  creatorAddress: string;
  creatorName?: string;
  limits?: Partial<ModuleLimits>;
  requiredOutputKeys?: string[];
  requiredInputKeys?: string[];
  postconditions?: PostCondition[];
  permissions?: { allowed: string[]; denied: string[] };
}

export const DEFAULT_MANIFEST_LIMITS: ModuleLimits = {
  timeoutMs: 1500,
  memoryMb: 64,
  maxOutputBytes: 256 * 1024,
  maxEntropyBitsPerChar: 5.5,
};

/** Benchmark one module once with a sample input, through the real kernel. */
export const DEFAULT_PERMISSIONS = {
  allowed: ["compute"],
  denied: ["network", "filesystem", "process", "require"],
};

export async function benchmarkAsset(
  code: string,
  limits: ModuleLimits,
  requiredOutputKeys: string[],
  requiredInputKeys: string[] = [],
  postconditions: PostCondition[] = [],
): Promise<Benchmarks> {
  const outcome = await runAssetModule({
    code,
    input: { ...makeSeed(), cycle: 1 },
    ctx: { cycle: 1, assetSlug: "benchmark" },
    limits,
    requiredOutputKeys,
    requiredInputKeys,
    postconditions,
  });
  return {
    runs: 1,
    ok: outcome.ok,
    p50Ms: outcome.ok ? outcome.durationMs : null,
    maxMs: outcome.durationMs,
    heapMb: outcome.heapMb,
    outputHash: outcome.outputHash,
    error: outcome.ok ? null : `${outcome.violation}: ${outcome.error}`,
  };
}

export async function registerAsset(input: RegisterAssetInput): Promise<AssetRow> {
  const codeHash = sha256Hex(input.code);
  const ring = ringCommit(input.code);
  const limits: ModuleLimits = { ...DEFAULT_MANIFEST_LIMITS, ...(input.limits ?? {}) };
  const requiredOutputKeys = input.requiredOutputKeys ?? [];
  const requiredInputKeys = input.requiredInputKeys ?? [];
  const postconditions = input.postconditions ?? [];
  const manifest: AssetManifest = {
    entrypoint: "module.exports.execute",
    capabilities: input.capabilities,
    limits,
    outputs: { requiredKeys: requiredOutputKeys },
    permissions: input.permissions ?? DEFAULT_PERMISSIONS,
    preconditions: { requiredInputKeys },
    postconditions,
  };
  const benchmarks = await benchmarkAsset(input.code, limits, requiredOutputKeys, requiredInputKeys, postconditions);
  const slugBase = slugify(input.name) || "asset";
  let slug = slugBase;
  let n = 1;
  while (true) {
    const existing = await db.select({ id: assets.id }).from(assets).where(eq(assets.slug, slug)).limit(1);
    if (existing.length === 0) break;
    n += 1;
    slug = `${slugBase}-${n}`;
  }
  const [row] = await db
    .insert(assets)
    .values({
      slug,
      name: input.name,
      description: input.description ?? "",
      tags: input.tags,
      code: input.code,
      codeHash,
      manifest,
      ring,
      benchmarks,
      royaltyBps: Math.max(0, Math.min(10000, Math.round(input.royaltyBps))),
      creatorAddress: input.creatorAddress,
      creatorName: input.creatorName ?? "anonymous",
      status: benchmarks.ok ? "active" : "quarantined",
      quarantineReason: benchmarks.ok ? null : `registration benchmark failed — ${benchmarks.error ?? "unknown"}`,
    })
    .returning();
  await emit("asset.registered", {
    assetId: row.id,
    slug: row.slug,
    codeHash: row.codeHash,
    commitment: row.ring.commitment,
    status: row.status,
  });
  return row;
}

// ---------------------------------------------------------------------------
// Intent resolution (matching engine)
// ---------------------------------------------------------------------------
function assetMatchesCapability(asset: AssetRow, capabilityKey: string): boolean {
  const caps = asset.manifest?.capabilities ?? [];
  if (caps.includes(capabilityKey)) return true;
  const def = CAPABILITY_BY_KEY.get(capabilityKey);
  if (!def) return false;
  const tags = (asset.tags ?? []).map((t) => t.toLowerCase());
  return def.keywords.some((k) => tags.includes(k));
}

function pickBestAsset(candidates: AssetRow[]): AssetRow | null {
  if (candidates.length === 0) return null;
  // Liquidity routing of compute: prefer the highest-performance active asset
  // (lowest benchmarked p50 latency), then the oldest (most battle-tested).
  return [...candidates].sort((a, b) => {
    const pa = a.benchmarks?.ok && a.benchmarks.p50Ms != null ? a.benchmarks.p50Ms : Number.POSITIVE_INFINITY;
    const pb = b.benchmarks?.ok && b.benchmarks.p50Ms != null ? b.benchmarks.p50Ms : Number.POSITIVE_INFINITY;
    if (pa !== pb) return pa - pb;
    return a.createdAt.getTime() - b.createdAt.getTime();
  })[0];
}

/** Resolve a parsed intent against the registry into a concrete graph. */
export async function resolveIntentGraph(parsed: ParsedIntent): Promise<{ graph: AssetGraph; status: string }> {
  const activeAssets = await db.select().from(assets).where(eq(assets.status, "active"));
  const graph = buildGraph(parsed, (cap) => {
    const candidates = activeAssets.filter((a) => assetMatchesCapability(a, cap.key));
    const best = pickBestAsset(candidates);
    return {
      assetId: best?.id ?? null,
      assetName: best?.name ?? null,
      assetSlug: best?.slug ?? null,
    };
  });
  const missing = graph.nodes.filter((n) => n.status === "missing").length;
  const status = graph.nodes.length === 0 ? "unresolved" : missing === 0 ? "resolved" : "partial";
  return { graph, status };
}

export async function createIntent(rawText: string) {
  const parsed = parseIntent(rawText);
  const { graph, status } = await resolveIntentGraph(parsed);
  const [row] = await db
    .insert(intents)
    .values({ rawText, parsed, graph, confidence: parsed.confidence, status })
    .returning();
  await emit("intent.parsed", {
    intentId: row.id,
    confidence: parsed.confidence,
    status,
    nodes: graph.nodes.length,
    edges: graph.edges.length,
  });
  return row;
}

// ---------------------------------------------------------------------------
// Assemblies
// ---------------------------------------------------------------------------
export async function createAssemblyFromIntent(intentId: string, name?: string) {
  const [intent] = await db.select().from(intents).where(eq(intents.id, intentId)).limit(1);
  if (!intent) throw new Error("intent not found");
  return createAssemblyFromGraph(intent.graph as AssetGraph, {
    intentId,
    name: name ?? `Assembly for intent ${intent.id.slice(0, 8)}`,
    description: intent.rawText,
  });
}

export async function createAssemblyFromAssetIds(assetIds: string[], name: string, description = "") {
  const rows = await db.select().from(assets).where(inArray(assets.id, assetIds));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = assetIds.map((id) => byId.get(id)).filter((r): r is AssetRow => Boolean(r));
  const graph: AssetGraph = {
    nodes: ordered.map((a, i) => ({
      id: `asset:${a.id}`,
      capability: a.manifest?.capabilities?.[0] ?? `stage-${i}`,
      label: a.name,
      stage: i,
      assetId: a.id,
      assetName: a.name,
      assetSlug: a.slug,
      status: "resolved" as const,
    })),
    edges: ordered.slice(1).map((a, i) => ({ from: `asset:${ordered[i].id}`, to: `asset:${a.id}` })),
  };
  return createAssemblyFromGraph(graph, { intentId: null, name, description });
}

async function createAssemblyFromGraph(
  graph: AssetGraph,
  opts: { intentId: string | null; name: string; description: string },
): Promise<AssemblyRow> {
  const resolvedNodes = graph.nodes.filter((n) => n.status === "resolved" && n.assetId);
  const assetIds = resolvedNodes.map((n) => n.assetId as string);
  const [row] = await db
    .insert(assemblies)
    .values({
      intentId: opts.intentId,
      name: opts.name,
      description: opts.description,
      assetIds,
      graph,
      status: assetIds.length === graph.nodes.length ? "ready" : "degraded",
    })
    .returning();
  // Composition micro-royalties: assembling an asset immediately credits its creator.
  const rows = await db.select().from(assets).where(inArray(assets.id, assetIds));
  for (const asset of rows) {
    await creditRoyalty({ asset, kind: "composition", assemblyId: row.id, memo: `composed into assembly ${row.name}` });
    await settleCompositionDualTrack(asset, row.id, "user:anon"); // v3.0 dual-track
  }
  await emit("assembly.created", { assemblyId: row.id, assetIds, intentId: opts.intentId });
  return row;
}

// ---------------------------------------------------------------------------
// Royalty ledger (micro-transactions + gas dividends)
// ---------------------------------------------------------------------------
export async function creditRoyalty(args: {
  asset: AssetRow;
  kind: "execution" | "composition";
  executionId?: string;
  stepId?: string;
  assemblyId?: string;
  cycle?: number;
  memo?: string;
}): Promise<{ feeMicro: number; creatorMicro: number; poolMicro: number }> {
  const feeMicro = args.kind === "execution" ? EXECUTION_CYCLE_FEE_MICRO : COMPOSITION_FEE_MICRO;
  const creatorMicro = Math.floor((feeMicro * args.asset.royaltyBps) / 10000);
  const poolMicro = feeMicro - creatorMicro;
  await db.insert(royaltyLedger).values([
    {
      executionId: args.executionId ?? null,
      stepId: args.stepId ?? null,
      assemblyId: args.assemblyId ?? null,
      assetId: args.asset.id,
      creatorAddress: args.asset.creatorAddress,
      kind: args.kind,
      amountMicro: creatorMicro,
      assetBps: args.asset.royaltyBps,
      cycle: args.cycle ?? null,
      memo: args.memo ?? `${args.kind} royalty for ${args.asset.slug}`,
    },
    {
      executionId: args.executionId ?? null,
      stepId: args.stepId ?? null,
      assemblyId: args.assemblyId ?? null,
      assetId: args.asset.id,
      creatorAddress: GAS_POOL_ADDRESS,
      kind: args.kind,
      amountMicro: poolMicro,
      assetBps: args.asset.royaltyBps,
      cycle: args.cycle ?? null,
      memo: `gas dividend (remainder) for ${args.asset.slug}`,
    },
  ]);
  await emit("royalty.credited", {
    executionId: args.executionId ?? null,
    assetId: args.asset.id,
    creatorAddress: args.asset.creatorAddress,
    kind: args.kind,
    creatorMicro,
    poolMicro,
    cycle: args.cycle ?? null,
  });
  return { feeMicro, creatorMicro, poolMicro };
}

// ---------------------------------------------------------------------------
// Deterministic seed flow (the "business event" fed into a run)
// ---------------------------------------------------------------------------
export function makeSeed(): Record<string, unknown> {
  const zones = ["central", "north", "east", "south", "west"];
  const orders = Array.from({ length: 8 }, (_, i) => ({
    id: `ORD-${1000 + i}`,
    customer: `CUST-${i + 1}`,
    zone: zones[i % zones.length],
    value: 12 + ((i * 17) % 55),
    priority: i % 3 === 0 ? "high" : "normal",
  }));
  // top-level flow envelope (pre-conditions read "orders"), raw seed for intake modules
  return { orders, seed: { orders }, meta: { source: "genesis-seed", generatedAt: "deterministic" } };
}

// ---------------------------------------------------------------------------
// Layer 2/4 — multi-cycle execution through the meta-kernel
// ---------------------------------------------------------------------------
export interface ExecutionResult {
  execution: typeof executions.$inferSelect;
  steps: (typeof executionSteps.$inferSelect)[];
}

export async function executeAssembly(assemblyId: string, cycles: number, payer = "user:anon"): Promise<ExecutionResult> {
  const [assembly] = await db.select().from(assemblies).where(eq(assemblies.id, assemblyId)).limit(1);
  if (!assembly) throw new Error("assembly not found");
  const assetIds = (assembly.assetIds ?? []) as string[];
  const assetRows = await db.select().from(assets).where(inArray(assets.id, assetIds));
  const byId = new Map(assetRows.map((a) => [a.id, a]));
  const orderedAssets = assetIds.map((id) => byId.get(id)).filter((a): a is AssetRow => Boolean(a));

  const seed = makeSeed();
  const [execution] = await db
    .insert(executions)
    .values({ assemblyId, cycles, status: "running", seed })
    .returning();
  await emit("execution.started", { executionId: execution.id, assemblyId, cycles });

  let flow: Record<string, unknown> = { ...seed };
  const steps: (typeof executionSteps.$inferSelect)[] = [];
  const quarantinedAssets: string[] = [];
  let stepsOk = 0;
  let stepsQuarantined = 0;
  let stepsSkipped = 0;
  let royaltiesMicro = 0;
  const startedAt = new Date();

  for (let cycle = 1; cycle <= cycles; cycle++) {
    for (const asset of orderedAssets) {
      // Automatic Domain Quarantine: already-quarantined modules are isolated
      // (skipped) without disrupting the rest of the pipeline.
      if (asset.status === "quarantined") {
        const [step] = await db
          .insert(executionSteps)
          .values({
            executionId: execution.id, assetId: asset.id, cycle,
            status: "skipped", violation: null, error: asset.quarantineReason ?? "quarantined",
          })
          .returning();
        steps.push(step);
        stepsSkipped += 1;
        await emit("asset.skipped", { executionId: execution.id, assetId: asset.id, cycle, reason: asset.quarantineReason });
        continue;
      }

      const input = { ...flow, cycle };
      const outcome: StepOutcome = await runAssetModule({
        code: asset.code,
        input,
        ctx: { cycle, assetId: asset.id, assetSlug: asset.slug },
        limits: asset.manifest?.limits,
        requiredOutputKeys: asset.manifest?.outputs?.requiredKeys ?? [],
        requiredInputKeys: asset.manifest?.preconditions?.requiredInputKeys ?? [],
        postconditions: asset.manifest?.postconditions ?? [],
      });

      const [step] = await db
        .insert(executionSteps)
        .values({
          executionId: execution.id,
          assetId: asset.id,
          cycle,
          status: outcome.ok ? "ok" : "quarantined",
          violation: outcome.violation,
          error: outcome.error,
          durationMs: outcome.durationMs,
          heapMb: outcome.heapMb,
          outputHash: outcome.outputHash,
          outputBytes: outcome.outputBytes,
          entropy: outcome.entropy,
        })
        .returning();
      steps.push(step);

      if (outcome.ok) {
        stepsOk += 1;
        if (outcome.output && typeof outcome.output === "object" && !Array.isArray(outcome.output)) {
          flow = { ...flow, ...(outcome.output as Record<string, unknown>) };
        } else {
          flow = { ...flow, lastOutput: outcome.output };
        }
        const credit = await creditRoyalty({
          asset, kind: "execution", executionId: execution.id, stepId: step.id, cycle,
          memo: `cycle ${cycle} execution of ${asset.slug}`,
        });
        royaltiesMicro += credit.feeMicro;
        await settleExecutionDualTrack(asset, cycle, execution.id, payer); // v3.0 dual-track
        await emit("asset.executed", {
          executionId: execution.id, assetId: asset.id, cycle,
          durationMs: outcome.durationMs, outputHash: outcome.outputHash, entropy: outcome.entropy,
        });
      } else {
        stepsQuarantined += 1;
        quarantinedAssets.push(asset.id);
        // ISOLATE the failing module: mark it quarantined, keep the pipeline alive.
        await db
          .update(assets)
          .set({
            status: "quarantined",
            quarantineReason: `[cycle ${cycle}] ${outcome.violation}: ${outcome.error}`,
            updatedAt: new Date(),
          })
          .where(eq(assets.id, asset.id));
        asset.status = "quarantined";
        asset.quarantineReason = `[cycle ${cycle}] ${outcome.violation}: ${outcome.error}`;
        await emit("asset.quarantined", {
          executionId: execution.id, assetId: asset.id, cycle,
          violation: outcome.violation, error: outcome.error,
          note: "module isolated; pipeline continues with pass-through flow",
        });
      }
    }
  }

  const finishedAt = new Date();
  const summary: ExecutionSummary = {
    cycles,
    stepsOk,
    stepsQuarantined,
    stepsSkipped,
    quarantinedAssets: [...new Set(quarantinedAssets)],
    royaltiesMicro,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
  };
  const [updated] = await db
    .update(executions)
    .set({ status: "completed", summary, finishedAt })
    .where(eq(executions.id, execution.id))
    .returning();
  await emit("execution.finished", { executionId: execution.id, assemblyId, summary });
  return { execution: updated, steps };
}

// ---------------------------------------------------------------------------
// Read models for UI / API
// ---------------------------------------------------------------------------
export async function listAssetsWithEarnings() {
  const rows = await db.select().from(assets).orderBy(desc(assets.createdAt));
  const earnings = await db
    .select({ assetId: royaltyLedger.assetId, total: sql<string>`coalesce(sum(${royaltyLedger.amountMicro}), 0)` })
    .from(royaltyLedger)
    .groupBy(royaltyLedger.assetId);
  const earnByAsset = new Map(earnings.map((e) => [e.assetId, Number(e.total)]));
  return rows.map((a) => ({ ...a, earnedMicro: earnByAsset.get(a.id) ?? 0 }));
}

export async function getStats() {
  const [assetCounts] = await db
    .select({
      total: sql<number>`count(*)`,
      active: sql<number>`count(*) filter (where ${assets.status} = 'active')`,
      quarantined: sql<number>`count(*) filter (where ${assets.status} = 'quarantined')`,
    })
    .from(assets);
  const [execCounts] = await db
    .select({ total: sql<number>`count(*)` })
    .from(executions);
  const [stepCounts] = await db
    .select({
      ok: sql<number>`count(*) filter (where ${executionSteps.status} = 'ok')`,
      quarantined: sql<number>`count(*) filter (where ${executionSteps.status} = 'quarantined')`,
      skipped: sql<number>`count(*) filter (where ${executionSteps.status} = 'skipped')`,
    })
    .from(executionSteps);
  const [royalty] = await db
    .select({ total: sql<string>`coalesce(sum(${royaltyLedger.amountMicro}), 0)` })
    .from(royaltyLedger);
  const [intentCount] = await db.select({ total: sql<number>`count(*)` }).from(intents);
  const [assemblyCount] = await db.select({ total: sql<number>`count(*)` }).from(assemblies);
  return {
    assets: {
      total: Number(assetCounts.total),
      active: Number(assetCounts.active),
      quarantined: Number(assetCounts.quarantined),
    },
    executions: Number(execCounts.total),
    steps: {
      ok: Number(stepCounts.ok),
      quarantined: Number(stepCounts.quarantined),
      skipped: Number(stepCounts.skipped),
    },
    royaltiesMicro: Number(royalty.total),
    intents: Number(intentCount.total),
    assemblies: Number(assemblyCount.total),
  };
}

export async function listCreators() {
  const rows = await db
    .select({
      creatorAddress: royaltyLedger.creatorAddress,
      total: sql<string>`coalesce(sum(${royaltyLedger.amountMicro}), 0)`,
      credits: sql<number>`count(*)`,
    })
    .from(royaltyLedger)
    .groupBy(royaltyLedger.creatorAddress)
    .orderBy(desc(sql`coalesce(sum(${royaltyLedger.amountMicro}), 0)`));
  return rows.map((r) => ({ creatorAddress: r.creatorAddress, totalMicro: Number(r.total), credits: Number(r.credits) }));
}

export async function recentExecutions(limit = 10) {
  const rows = await db
    .select({
      execution: executions,
      assemblyName: assemblies.name,
      assemblyId: assemblies.id,
    })
    .from(executions)
    .leftJoin(assemblies, eq(executions.assemblyId, assemblies.id))
    .orderBy(desc(executions.startedAt))
    .limit(limit);
  return rows;
}

export { asc, desc };


// ---------------------------------------------------------------------------
// Layer II — order book for SSU execution rights (price-time priority matching)
// ---------------------------------------------------------------------------
export async function placeOrder(args: {
  side: "bid" | "ask";
  assetId: string;
  owner: string;
  priceMicro: number;
  qty: number;
}) {
  const { side, assetId, owner, priceMicro, qty } = args;
  const [asset] = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
  if (!asset) throw new Error("asset not found");
  if (!["bid", "ask"].includes(side)) throw new Error("side must be bid|ask");
  if (!Number.isFinite(priceMicro) || priceMicro <= 0) throw new Error("priceMicro must be > 0");
  if (!Number.isInteger(qty) || qty <= 0 || qty > 1000) throw new Error("qty must be 1..1000");

  const [order] = await db
    .insert(orders)
    .values({ side, assetId, owner, priceMicro: Math.round(priceMicro), qty })
    .returning();

  const fills: { bidId: string; askId: string; priceMicro: number; qty: number }[] = [];
  const opposite = side === "bid" ? "ask" : "bid";
  const candidates = await db
    .select()
    .from(orders)
    .where(
      sql`${orders.side} = ${opposite} AND ${orders.status} = 'open' AND ${orders.assetId} = ${assetId} AND ${
        side === "bid"
          ? sql`${orders.priceMicro} <= ${order.priceMicro}`
          : sql`${orders.priceMicro} >= ${order.priceMicro}`
      }`,
    )
    .orderBy(
      side === "bid" ? asc(orders.priceMicro) : desc(orders.priceMicro),
      asc(orders.createdAt),
    );

  let remaining = qty;
  for (const candidate of candidates) {
    if (remaining <= 0) break;
    const fillQty = Math.min(remaining, candidate.qty - candidate.filledQty);
    if (fillQty <= 0) continue;
    const fillPrice = candidate.priceMicro;
    await db
      .update(orders)
      .set({ filledQty: candidate.filledQty + fillQty, status: candidate.filledQty + fillQty >= candidate.qty ? "filled" : "open" })
      .where(eq(orders.id, candidate.id));
    remaining -= fillQty;
    const bidId = side === "bid" ? order.id : candidate.id;
    const askId = side === "bid" ? candidate.id : order.id;
    fills.push({ bidId, askId, priceMicro: fillPrice, qty: fillQty });
    // settle the trade peer-to-peer into the ledger (ask owner = seller)
    const seller = side === "bid" ? candidate.owner : owner;
    const buyer = side === "bid" ? owner : candidate.owner;
    const amount = fillPrice * fillQty;
    await db.insert(royaltyLedger).values([
      {
        assetId, creatorAddress: seller, kind: "trade-credit", amountMicro: amount,
        assetBps: asset.royaltyBps, memo: `order-book fill: sold ${fillQty} execution right(s) @ ${fillPrice} µSOV`,
      },
      {
        assetId, creatorAddress: buyer, kind: "trade-debit", amountMicro: -amount,
        assetBps: asset.royaltyBps, memo: `order-book fill: bought ${fillQty} execution right(s) @ ${fillPrice} µSOV`,
      },
    ]);
    await emit("order.filled", { assetId, bidId, askId, priceMicro: fillPrice, qty: fillQty });
    // v3.0: settle the fill natively in USDC
    await appendSettlement({
      rail: "USDC", asset: "USDC", fromAddress: buyer, toAddress: seller,
      amountMicro: amount, kind: "trade-credit", refId: assetId,
      memo: `order-book fill: ${fillQty} execution right(s) of ${asset.slug} @ ${fillPrice} µUSDC`,
    });
  }
  await db
    .update(orders)
    .set({ filledQty: qty - remaining, status: remaining === 0 ? "filled" : "open" })
    .where(eq(orders.id, order.id));
  const [updated] = await db.select().from(orders).where(eq(orders.id, order.id)).limit(1);
  return { order: updated, fills };
}

export async function listOrders(limit = 50) {
  const rows = await db.select().from(orders).orderBy(desc(orders.createdAt)).limit(limit);
  const assetIds = [...new Set(rows.map((r) => r.assetId))];
  const mods = assetIds.length ? await db.select().from(assets).where(inArray(assets.id, assetIds)) : [];
  const byId = new Map(mods.map((m) => [m.id, m]));
  return rows.map((r) => ({ ...r, assetName: byId.get(r.assetId)?.name ?? null, assetSlug: byId.get(r.assetId)?.slug ?? null }));
}

export async function cancelOrder(id: string, owner: string) {
  const [row] = await db
    .update(orders)
    .set({ status: "cancelled" })
    .where(sql`${orders.id} = ${id} AND ${orders.owner} = ${owner} AND ${orders.status} = 'open'`)
    .returning();
  return row ?? null;
}


/** Verify the settlement hash chain and every fiat HMAC gateway signature. */
export async function verifySettlementLog() {
  const rows = await db.select().from(settlements).orderBy(asc(settlements.createdAt), asc(settlements.id));
  let head = SETTLEMENT_CHAIN_GENESIS;
  let chainValid = true;
  let hmacValid = true;
  let fiatCount = 0;
  let stableCount = 0;
  for (const r of rows) {
    const payload = {
      rail: r.rail, asset: r.asset, fromAddress: r.fromAddress, toAddress: r.toAddress,
      amountMicro: r.amountMicro, kind: r.kind, refId: r.refId ?? null, memo: r.memo,
      at: new Date(r.createdAt).toISOString(),
    };
    const expected = settlementTxHash(head, payload);
    if (expected !== r.txHash) chainValid = false;
    head = r.txHash;
    if (r.rail === "fiat") {
      fiatCount += 1;
      const chargePayload = { gateway_charge: r.fromAddress, cents: r.amountMicro, currency: r.asset, at: new Date(r.createdAt).toISOString() };
      if (!gatewayVerify(chargePayload, r.sig)) hmacValid = false;
    }
    if (r.rail === "USDC" || r.rail === "USDT") stableCount += 1;
  }
  return { chainValid, hmacValid, transfers: rows.length, fiatTransfers: fiatCount, stableTransfers: stableCount, chainHead: head };
}
