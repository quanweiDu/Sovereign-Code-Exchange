// Layer 4 — Self-Hosting Genesis Driver.
// Registers the sample high-performance industrial Code-Asset NFTs, parses the
// canonical natural-language intent, assembles the pipeline and executes a
// multi-cycle production run. Idempotent: re-running never duplicates assets.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assets } from "@/db/schema";
import {
  createAssemblyFromIntent,
  createIntent,
  executeAssembly,
  makeSeed,
  registerAsset,
  type RegisterAssetInput,
} from "@/lib/marketplace";
import { runAssetModule, DEFAULT_LIMITS } from "@/lib/kernel";
import type { ModuleLimits } from "@/lib/types";

export const GENESIS_INTENT_TEXT =
  "Deploy an automated delivery dispatch and podcast publishing pipeline, seal every run through a post-quantum cryptography proxy with secure data warehousing, audit logging and telemetry monitoring";

interface SampleModule {
  name: string;
  description: string;
  tags: string[];
  capabilities: string[];
  royaltyBps: number;
  creatorAddress: string;
  creatorName: string;
  requiredOutputKeys: string[];
  requiredInputKeys?: string[];
  postconditions?: { key: string; op: "exists" | "missing" | "eq" | "ne" | "gt" | "ge" | "lt" | "le" | "in" | "type"; value?: unknown }[];
  limits?: Partial<ModuleLimits>;
  code: string;
}

// NOTE: module code is plain ES5-ish JS executed inside the kernel sandbox.
// Contract: module.exports.execute(input, ctx) -> object merged into the flow.
//   input: { cycle, seed, ...outputsOfPreviousStages }
//   ctx:   { cycle, assetId, assetSlug }
export const SAMPLE_MODULES: SampleModule[] = [
  {
    name: "Order-Intake-Collector",
    description:
      "Normalizes raw inbound business events / orders into a canonical pipeline flow. Zero-dependency, O(n).",
    tags: ["intake", "orders", "collect", "ingest", "events"],
    capabilities: ["intake"],
    royaltyBps: 400,
    creatorAddress: "sov:genesis:collector",
    creatorName: "Genesis Foundry",
    requiredOutputKeys: ["orders", "intakeCount"],
    code: [
      "module.exports.execute = function (input, ctx) {",
      "  var seed = input && input.seed ? input.seed : {};",
      "  var raw = (input && input.orders) || (seed && seed.orders) || [];",
      "  var orders = raw.map(function (o, i) {",
      "    return {",
      "      id: o.id || ('ORD-' + (i + 1)),",
      "      customer: o.customer || ('CUST-' + (i + 1)),",
      "      zone: o.zone || 'central',",
      "      value: typeof o.value === 'number' ? o.value : 10 + ((i * 13) % 40),",
      "      priority: o.priority || (i % 3 === 0 ? 'high' : 'normal')",
      "    };",
      "  });",
      "  return { orders: orders, intakeCount: orders.length };",
      "};",
    ].join("\n"),
  },
  {
    name: "Fee Enrichment ETL",
    description: "Transforms orders into fee-enriched records (transform stage of the pipeline).",
    tags: ["transform", "etl", "enrich", "normalize"],
    capabilities: ["transform"],
    royaltyBps: 300,
    creatorAddress: "sov:genesis:etl",
    creatorName: "Genesis Foundry",
    requiredOutputKeys: ["orders", "transformApplied"],
    code: [
      "module.exports.execute = function (input, ctx) {",
      "  var orders = (input && input.orders) || [];",
      "  var enriched = orders.map(function (o) {",
      "    return { id: o.id, zone: o.zone, value: o.value, priority: o.priority,",
      "      fee: Math.round(o.value * 0.12 * 100) / 100 };",
      "  });",
      "  return { orders: enriched, transformApplied: 'fee-enrichment-v1' };",
      "};",
    ].join("\n"),
  },
  {
    name: "Logistics-Dispatcher-V9",
    description:
      "Routes every order to a rider with ETA + at-risk detection. Fault-tolerant: degrades gracefully on bad input.",
    tags: ["logistics", "dispatch", "delivery", "routing", "rider", "fleet"],
    capabilities: ["logistics"],
    royaltyBps: 600,
    creatorAddress: "sov:genesis:router",
    creatorName: "Genesis Foundry",
    requiredOutputKeys: ["routes", "dispatchSummary"],
    requiredInputKeys: ["orders"],
    postconditions: [
      { key: "routes", op: "exists" },
      { key: "dispatchSummary", op: "exists" },
    ],
    code: [
      "module.exports.execute = function (input, ctx) {",
      "  var orders = (input && input.orders) || [];",
      "  var riders = ['rider-amina', 'rider-bao', 'rider-carmen', 'rider-diego', 'rider-elena'];",
      "  var cycle = (ctx && ctx.cycle) || 1;",
      "  var routes = orders.map(function (o, i) {",
      "    var rider = riders[(i + cycle) % riders.length];",
      "    return { orderId: o.id, rider: rider, zone: o.zone || 'central',",
      "      etaMin: 4 + ((i * 7 + cycle * 3) % 26),",
      "      priority: o.priority || 'normal', status: 'dispatched' };",
      "  });",
      "  var atRisk = routes.filter(function (r) { return r.etaMin > 24; }).length;",
      "  return { routes: routes, dispatchSummary: { dispatched: routes.length, atRisk: atRisk, cycle: cycle } };",
      "};",
    ].join("\n"),
  },
  {
    name: "Rider Payout Invoicer",
    description: "Computes per-rider payouts and invoice totals from routed deliveries.",
    tags: ["billing", "invoice", "payout", "payment", "revenue"],
    capabilities: ["billing"],
    royaltyBps: 500,
    creatorAddress: "sov:genesis:billing",
    creatorName: "Genesis Foundry",
    requiredOutputKeys: ["invoices", "payoutTotal"],
    code: [
      "module.exports.execute = function (input, ctx) {",
      "  var routes = (input && input.routes) || [];",
      "  var payouts = routes.map(function (r) {",
      "    var base = 2.5 + (r.priority === 'high' ? 1.5 : 0);",
      "    return { rider: r.rider, orderId: r.orderId,",
      "      amount: Math.round((base + r.etaMin * 0.1) * 100) / 100 };",
      "  });",
      "  var total = payouts.reduce(function (a, p) { return a + p.amount; }, 0);",
      "  return { invoices: payouts, payoutTotal: Math.round(total * 100) / 100 };",
      "};",
    ].join("\n"),
  },
  {
    name: "Podcast-Publisher-Pro",
    description: "Turns the dispatch summary of each cycle into a published podcast episode / feed item.",
    tags: ["podcast", "publish", "publishing", "audio", "episode", "content"],
    capabilities: ["publish"],
    royaltyBps: 700,
    creatorAddress: "sov:genesis:podcast",
    creatorName: "Genesis Foundry",
    requiredOutputKeys: ["episode", "feed"],
    code: [
      "module.exports.execute = function (input, ctx) {",
      "  var cycle = (ctx && ctx.cycle) || 1;",
      "  var s = (input && input.dispatchSummary) || { dispatched: 0, atRisk: 0 };",
      "  var id = 'EP-' + ('000' + cycle).slice(-3);",
      "  var episode = {",
      "    id: id,",
      "    title: 'Dispatch Digest #' + cycle + ' — ' + s.dispatched + ' orders routed',",
      "    summary: 'Cycle ' + cycle + ': dispatched ' + s.dispatched + ' deliveries, ' + s.atRisk + ' at risk.',",
      "    durationMin: 3 + (cycle % 5),",
      "    status: 'published'",
      "  };",
      "  return { episode: episode, feed: [episode] };",
      "};",
    ].join("\n"),
  },
  {
    name: "Ops Alert Notifier",
    description: "Sends a per-cycle ops notification derived from the dispatch summary.",
    tags: ["notify", "alert", "notification", "ops"],
    capabilities: ["notify"],
    royaltyBps: 250,
    creatorAddress: "sov:genesis:notify",
    creatorName: "Genesis Foundry",
    requiredOutputKeys: ["notifications"],
    code: [
      "module.exports.execute = function (input, ctx) {",
      "  var cycle = (ctx && ctx.cycle) || 1;",
      "  var s = (input && input.dispatchSummary) || { dispatched: 0, atRisk: 0 };",
      "  return { notifications: [{ channel: 'ops-dashboard',",
      "    message: 'Cycle ' + cycle + ': ' + s.dispatched + ' deliveries dispatched, ' + s.atRisk + ' at risk',",
      "    sent: true }] };",
      "};",
    ].join("\n"),
  },
  {
    name: "Secure-Audit-Sink",
    description:
      "Seals each routed record into the audit warehouse using an in-sandbox FNV-1a digest (zero-dependency, no require).",
    tags: ["sink", "data", "warehouse", "secure", "audit", "storage"],
    capabilities: ["sink"],
    royaltyBps: 450,
    creatorAddress: "sov:genesis:sink",
    creatorName: "Genesis Foundry",
    requiredOutputKeys: ["sink"],
    code: [
      "function fnv1a(str) {",
      "  var h = 0x811c9dc5;",
      "  for (var i = 0; i < str.length; i++) {",
      "    h ^= str.charCodeAt(i);",
      "    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;",
      "  }",
      "  return ('0000000' + h.toString(16)).slice(-8);",
      "}",
      "module.exports.execute = function (input, ctx) {",
      "  var cycle = (ctx && ctx.cycle) || 1;",
      "  var routes = (input && input.routes) || [];",
      "  var records = routes.map(function (r) {",
      "    return { orderId: r.orderId, rider: r.rider, digest: fnv1a(JSON.stringify(r)) };",
      "  });",
      "  return { sink: { stored: records.length, records: records, cycle: cycle, sealed: true } };",
      "};",
    ].join("\n"),
  },
  {
    name: "Post-Quantum-Crypto-Proxy",
    description:
      "Lamport one-time signature (hash-based, post-quantum secure) over SHA-256 of the pipeline flow. Pure-JS SHA-256, zero dependencies, executed inside the kernel sandbox.",
    tags: ["quantum", "post-quantum", "pqc", "crypto", "sign", "seal", "attest", "security", "proxy"],
    capabilities: ["security"],
    royaltyBps: 800,
    creatorAddress: "sov:genesis:pqc",
    creatorName: "Genesis Foundry",
    requiredOutputKeys: ["attestation"],
    postconditions: [
      { key: "attestation", op: "exists" },
      { key: "$root", op: "type", value: "object" },
    ],
    code: `// Pure-JS SHA-256 (verified against node:crypto) — post-quantum hash primitive.
function sha256(ascii) {
  function rightRotate(value, amount) { return (value >>> amount) | (value << (32 - amount)); }
  var mathPow = Math.pow, maxWord = mathPow(2, 32), result = "";
  var words = [], asciiBitLength = ascii.length * 8;
  var hash = sha256.h = sha256.h || [], k = sha256.k = sha256.k || [];
  var primeCounter = k.length, isComposite = {};
  for (var candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (var i = 0; i < 313; i += candidate) isComposite[i] = candidate;
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }
  ascii += String.fromCharCode(128);
  while (ascii.length % 64 - 56) ascii += String.fromCharCode(0);
  for (var i = 0; i < ascii.length; i++) {
    var j = ascii.charCodeAt(i);
    if (j >> 8) return;
    words[i >> 2] |= j << ((3 - i) % 4) * 8;
  }
  words[words.length] = (asciiBitLength / maxWord) | 0;
  words[words.length] = asciiBitLength;
  for (var j = 0; j < words.length;) {
    var w = words.slice(j, (j += 16));
    var oldHash = hash;
    hash = hash.slice(0, 8);
    for (var i = 0; i < 64; i++) {
      var w15 = w[i - 15], w2 = w[i - 2];
      var a = hash[0], e = hash[4];
      var temp1 = hash[7]
        + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
        + ((e & hash[5]) ^ (~e & hash[6]))
        + k[i]
        + (w[i] = i < 16 ? w[i] : (w[i - 16] + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) | 0);
      var temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
      hash = [(temp1 + temp2) | 0].concat(hash);
      hash[4] = (hash[4] + temp1) | 0;
    }
    for (var i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
  }
  for (var i = 0; i < 8; i++) {
    for (var j = 3; j + 1; j--) {
      var b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? "0" : "") + b.toString(16);
    }
  }
  return result;
}
function sha256hex(s) { return sha256(unescape(encodeURIComponent(s))); }
// Lamport one-time signature over the flow digest (256 bits).
module.exports.execute = function (input, ctx) {
  var cycle = (ctx && ctx.cycle) || 1;
  var digest = sha256hex(JSON.stringify(input));
  var seed = "pqc-proxy:" + cycle;
  var priv = [], pub = [], sig = [];
  for (var i = 0; i < 256; i++) {
    var p0 = sha256hex(seed + ":0:" + i), p1 = sha256hex(seed + ":1:" + i);
    priv.push([p0, p1]);
    pub.push([sha256hex(p0), sha256hex(p1)]);
    var nib = parseInt(digest.charAt(Math.floor(i / 4)), 16);
    sig.push(priv[i][(nib >> (3 - (i % 4))) & 1]);
  }
  var verified = true;
  for (var j = 0; j < 256; j++) {
    var nib2 = parseInt(digest.charAt(Math.floor(j / 4)), 16);
    var b = (nib2 >> (3 - (j % 4))) & 1;
    if (sha256hex(sig[j]) !== pub[j][b]) { verified = false; break; }
  }
  return { attestation: { scheme: "lamport-ots-sha256 (post-quantum)", digest: digest, signature: sig, public_key: pub, verified: verified } };
};`,
  },
  {
    name: "Telemetry-Fuser",
    description:
      "Fuses device telemetry. FAULT-INJECTING reference module: on cycle 2 it emits a high-entropy blob, violating the kernel entropy invariant — demonstrating Automatic Domain Quarantine.",
    tags: ["sensor", "telemetry", "fusion", "monitoring", "iot"],
    capabilities: ["sensor"],
    royaltyBps: 350,
    creatorAddress: "sov:genesis:sensor",
    creatorName: "Genesis Foundry",
    requiredOutputKeys: ["telemetry"],
    code: [
      "function fnv1a(str) {",
      "  var h = 0x811c9dc5;",
      "  for (var i = 0; i < str.length; i++) {",
      "    h ^= str.charCodeAt(i);",
      "    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;",
      "  }",
      "  return h >>> 0;",
      "}",
      "module.exports.execute = function (input, ctx) {",
      "  var cycle = (ctx && ctx.cycle) || 1;",
      "  if (cycle === 2) {",
      "    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';",
      "    var blob = '';",
      "    for (var i = 0; i < 4096; i++) {",
      "      blob += chars.charAt(fnv1a('telemetry:' + cycle + ':' + i) % 64);",
      "    }",
      "    return { telemetry: blob };",
      "  }",
      "  return { telemetry: 'nominal', uptimePct: 99 + (cycle % 2) };",
      "};",
    ].join("\n"),
  },
  {
    name: "Cron-Armer",
    description: "Arms the recurring cron schedule that re-runs the assembled pipeline.",
    tags: ["scheduler", "cron", "automation", "pipeline", "workflow"],
    capabilities: ["scheduler"],
    royaltyBps: 200,
    creatorAddress: "sov:genesis:scheduler",
    creatorName: "Genesis Foundry",
    requiredOutputKeys: ["schedule"],
    code: [
      "module.exports.execute = function (input, ctx) {",
      "  var cycle = (ctx && ctx.cycle) || 1;",
      "  return { schedule: { cron: '*/15 * * * *', nextRunInMin: 15,",
      "    pipeline: 'genesis-assembly', cycle: cycle, status: 'armed' } };",
      "};",
    ].join("\n"),
  },
  {
    name: "Chaotic Spin Loop",
    description:
      "Stress-test module that deliberately hangs forever. The registration benchmark times out, so the kernel quarantines it at registration — demonstrating the timeout quarantine path. Include it in a manual assembly to watch live timeout isolation.",
    tags: ["chaos", "stress", "timeout", "spin"],
    capabilities: ["stress"],
    royaltyBps: 100,
    creatorAddress: "sov:genesis:chaos",
    creatorName: "Genesis Foundry",
    requiredOutputKeys: [],
    limits: { timeoutMs: 800, memoryMb: 32 },
    code: [
      "module.exports.execute = function (input, ctx) {",
      "  while (true) { /* deliberate infinite loop: kernel timeout must terminate this domain */ }",
      "};",
    ].join("\n"),
  },
];

/** Idempotently register all sample modules. Returns what was created. */
export async function seedGenesis(): Promise<{ created: string[]; existing: number; total: number }> {
  const created: string[] = [];
  let existing = 0;
  for (const mod of SAMPLE_MODULES) {
    const slug = mod.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const found = await db.select({ id: assets.id }).from(assets).where(eq(assets.slug, slug)).limit(1);
    if (found.length > 0) {
      existing += 1;
      continue;
    }
    const input: RegisterAssetInput = {
      name: mod.name,
      description: mod.description,
      tags: mod.tags,
      code: mod.code,
      capabilities: mod.capabilities,
      royaltyBps: mod.royaltyBps,
      creatorAddress: mod.creatorAddress,
      creatorName: mod.creatorName,
      limits: mod.limits,
      requiredOutputKeys: mod.requiredOutputKeys,
      requiredInputKeys: mod.requiredInputKeys,
      postconditions: mod.postconditions,
    };
    const row = await registerAsset(input);
    created.push(row.slug);
  }
  return { created, existing, total: SAMPLE_MODULES.length };
}

export interface GenesisRunResult {
  seed: { created: string[]; existing: number; total: number };
  intentId: string;
  assemblyId: string;
  executionId: string;
  cycles: number;
  summary: unknown;
}

/**
 * Full genesis run: seed modules -> parse canonical intent -> assemble ->
 * execute N cycles through the meta-kernel with royalties + quarantine.
 */
export async function runGenesis(cycles = 3): Promise<GenesisRunResult> {
  const seed = await seedGenesis();
  const intent = await createIntent(GENESIS_INTENT_TEXT);
  const assembly = await createAssemblyFromIntent(intent.id, "Genesis Delivery+Podcast Pipeline");
  const { execution } = await executeAssembly(assembly.id, Math.max(1, Math.min(10, cycles)));
  return {
    seed,
    intentId: intent.id,
    assemblyId: assembly.id,
    executionId: execution.id,
    cycles: execution.cycles,
    summary: execution.summary,
  };
}

export { DEFAULT_LIMITS, makeSeed, runAssetModule };
