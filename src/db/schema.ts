import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  AssetGraph,
  AssetManifest,
  Benchmarks,
  ExecutionSummary,
  ParsedIntent,
  RingParams,
} from "@/lib/types";

/**
 * Layer 1 — Code-Asset NFT & Immutable Metadata Registry.
 * Every row is an immutable "Code-as-Asset" NFT: sha256 code hash, Z_q ring
 * commitment, execution manifest (limits + required outputs), performance
 * benchmarks and a royalty-distribution interface (royaltyBps + creator).
 */
export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    version: text("version").notNull().default("1.0.0"),
    tags: text("tags").array().notNull().default([]),
    code: text("code").notNull(),
    codeHash: text("code_hash").notNull(), // sha256(code), hex
    manifest: jsonb("manifest").$type<AssetManifest>().notNull(),
    ring: jsonb("ring").$type<RingParams>().notNull(),
    benchmarks: jsonb("benchmarks").$type<Benchmarks>(),
    royaltyBps: integer("royalty_bps").notNull().default(500), // creator share in basis points
    creatorAddress: text("creator_address").notNull(),
    creatorName: text("creator_name").notNull().default("anonymous"),
    status: text("status").notNull().default("active"), // active | quarantined
    quarantineReason: text("quarantine_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("assets_status_idx").on(t.status),
    index("assets_creator_idx").on(t.creatorAddress),
  ],
);

/** Layer 3 — parsed natural-language intents and their dependency graphs. */
export const intents = pgTable("intents", {
  id: uuid("id").primaryKey().defaultRandom(),
  rawText: text("raw_text").notNull(),
  parsed: jsonb("parsed").$type<ParsedIntent>().notNull(),
  graph: jsonb("graph").$type<AssetGraph>().notNull(),
  confidence: real("confidence").notNull().default(0),
  status: text("status").notNull().default("resolved"), // resolved | partial | unresolved
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Assembled pipelines: an ordered dependency graph of Code-Asset NFTs. */
export const assemblies = pgTable(
  "assemblies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    intentId: uuid("intent_id").references(() => intents.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    assetIds: jsonb("asset_ids").$type<string[]>().notNull(), // topologically ordered
    graph: jsonb("graph").$type<AssetGraph>().notNull(),
    status: text("status").notNull().default("ready"), // ready | degraded
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("assemblies_intent_idx").on(t.intentId)],
);

/** Layer 2/4 — multi-cycle production runs of an assembly. */
export const executions = pgTable(
  "executions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assemblyId: uuid("assembly_id")
      .notNull()
      .references(() => assemblies.id, { onDelete: "cascade" }),
    cycles: integer("cycles").notNull().default(1),
    status: text("status").notNull().default("running"), // running | completed | failed
    seed: jsonb("seed").$type<Record<string, unknown>>(),
    summary: jsonb("summary").$type<ExecutionSummary>(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("executions_assembly_idx").on(t.assemblyId)],
);

/** Per-cycle, per-module execution steps recorded by the meta-kernel. */
export const executionSteps = pgTable(
  "execution_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    executionId: uuid("execution_id")
      .notNull()
      .references(() => executions.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    cycle: integer("cycle").notNull(),
    status: text("status").notNull(), // ok | quarantined | skipped
    violation: text("violation"), // timeout | memory | invariant | runtime
    error: text("error"),
    durationMs: integer("duration_ms"),
    heapMb: real("heap_mb"),
    outputHash: text("output_hash"), // sha256 of stable-stringified output
    outputBytes: integer("output_bytes"),
    entropy: real("entropy"), // bits/char of output
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("steps_execution_idx").on(t.executionId),
    index("steps_asset_idx").on(t.assetId),
  ],
);

/**
 * Layer 3 — micro-royalty & gas-dividend ledger. Every execution cycle (and
 * every assembly composition) immediately credits the original creator.
 * Amounts are integer micro-SOV (1 SOV = 1_000_000 micro).
 */
export const royaltyLedger = pgTable(
  "royalty_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    executionId: uuid("execution_id").references(() => executions.id, { onDelete: "set null" }),
    stepId: uuid("step_id").references(() => executionSteps.id, { onDelete: "set null" }),
    assemblyId: uuid("assembly_id").references(() => assemblies.id, { onDelete: "set null" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    creatorAddress: text("creator_address").notNull(),
    kind: text("kind").notNull(), // execution | composition
    amountMicro: bigint("amount_micro", { mode: "number" }).notNull(),
    assetBps: integer("asset_bps").notNull(), // royaltyBps of the asset at credit time
    cycle: integer("cycle"),
    memo: text("memo").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ledger_asset_idx").on(t.assetId),
    index("ledger_creator_idx").on(t.creatorAddress),
    index("ledger_execution_idx").on(t.executionId),
  ],
);

/**
 * Layer II — order book for SSU execution rights. Bids/asks match on
 * price-time priority; fills settle peer-to-peer into the royalty ledger.
 */
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    side: text("side").notNull(), // bid | ask
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    owner: text("owner").notNull(),
    priceMicro: bigint("price_micro", { mode: "number" }).notNull(),
    qty: integer("qty").notNull().default(1),
    filledQty: integer("filled_qty").notNull().default(0),
    status: text("status").notNull().default("open"), // open | filled | cancelled
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("orders_asset_idx").on(t.assetId),
    index("orders_status_idx").on(t.status),
  ],
);

/**
 * v3.0 — Dual-track settlement log (Track A fiat gateway + Track B native
 * USDC/USDT). Append-only, hash-chained (tx_hash = sha256(prev || payload)).
 */
export const settlements = pgTable(
  "settlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rail: text("rail").notNull(), // fiat | USDC | USDT
    asset: text("asset").notNull(), // USD | USDC | USDT | CREDITS
    fromAddress: text("from_address").notNull(),
    toAddress: text("to_address").notNull(),
    amountMicro: bigint("amount_micro", { mode: "number" }).notNull(),
    kind: text("kind").notNull(), // fiat-purchase | credit-mint | execution-debit | royalty-dividend | gas-dividend | trade-credit | trade-debit
    refId: text("ref_id"), // execution/assembly/asset id when applicable
    memo: text("memo").notNull().default(""),
    txHash: text("tx_hash").notNull(),
    sig: text("sig"), // HMAC-SHA256 fiat-gateway signature (fiat rail)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("settlements_rail_idx").on(t.rail), index("settlements_created_idx").on(t.createdAt)],
);

/** v3.0 — fiat-purchased execution credits per user (1 credit = 1 µUSDC of exec). */
export const accounts = pgTable("accounts", {
  address: text("address").primaryKey(),
  creditsMicro: bigint("credits_micro", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Layer 2 — the persisted event-bus stream (kernel telemetry). */
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    executionId: uuid("execution_id").references(() => executions.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("events_execution_idx").on(t.executionId)],
);

export type AssetRow = typeof assets.$inferSelect;
export type AssetInsert = typeof assets.$inferInsert;
export type IntentRow = typeof intents.$inferSelect;
export type AssemblyRow = typeof assemblies.$inferSelect;
export type ExecutionRow = typeof executions.$inferSelect;
export type ExecutionStepRow = typeof executionSteps.$inferSelect;
export type LedgerRow = typeof royaltyLedger.$inferSelect;
export type EventRow = typeof events.$inferSelect;
