// Layer 3 — intent parsing: natural language -> capability set -> dependency graph.
// Pure functions (no I/O) so the parser is fully testable.
import type { AssetGraph, CapabilityHit, GraphEdge, GraphNode, ParsedIntent } from "@/lib/types";

export interface CapabilityDef {
  key: string;
  label: string;
  stage: number; // pipeline stage used for topological ordering
  keywords: string[];
  blurb: string;
}

export const CAPABILITIES: CapabilityDef[] = [
  {
    key: "intake", label: "Order / Event Intake Collector", stage: 0,
    keywords: ["order", "orders", "intake", "collect", "collector", "ingest", "ingestion", "scrape", "fetch", "event", "events", "stream", "capture", "inbound", "webhook"],
    blurb: "Ingests raw business events / orders into the pipeline.",
  },
  {
    key: "transform", label: "Data Transformer / Enrichment ETL", stage: 1,
    keywords: ["transform", "etl", "clean", "cleanse", "normalize", "enrich", "enrichment", "aggregate", "filter", "parse", "convert", "summarize", "ai", "llm", "analytics"],
    blurb: "Cleans, normalizes and enriches the flow.",
  },
  {
    key: "logistics", label: "Fault-Tolerant Logistics Router", stage: 2,
    keywords: ["delivery", "deliveries", "dispatch", "logistics", "route", "routing", "router", "rider", "riders", "courier", "fleet", "shipment", "shipping", "transport", "driver", "drivers"],
    blurb: "Routes jobs to riders / fleet with fault tolerance.",
  },
  {
    key: "billing", label: "Billing & Payout Invoicer", stage: 3,
    keywords: ["invoice", "invoices", "billing", "payment", "payments", "payout", "payouts", "pay", "charge", "pricing", "revenue"],
    blurb: "Computes invoices and worker payouts.",
  },
  {
    key: "publish", label: "Content / Podcast Publisher", stage: 4,
    keywords: ["podcast", "publish", "publishing", "publisher", "audio", "episode", "episodes", "newsletter", "content", "broadcast", "rss", "social"],
    blurb: "Publishes episodes / content derived from the flow.",
  },
  {
    key: "notify", label: "Notifier / Alerts", stage: 5,
    keywords: ["notify", "notification", "notifications", "alert", "alerts", "email", "sms", "message", "messages", "ping"],
    blurb: "Sends notifications to ops channels.",
  },
  {
    key: "sink", label: "Secure Data Sink / Audit Log", stage: 6,
    keywords: ["data", "sink", "warehouse", "warehousing", "store", "storage", "persist", "archive", "audit", "logging", "secure", "database", "ledger", "record", "records", "lake"],
    blurb: "Seals hashed records into the audit warehouse.",
  },
  {
    key: "security", label: "Post-Quantum Cryptography Proxy", stage: 7,
    keywords: ["quantum", "post-quantum", "pqc", "crypto", "cryptography", "sign", "signature", "seal", "attest", "attestation", "encrypt", "security", "proxy"],
    blurb: "Signs / seals the flow with hash-based post-quantum attestations.",
  },
  {
    key: "sensor", label: "Sensor Fusion / Telemetry", stage: 8,
    keywords: ["sensor", "sensors", "telemetry", "fusion", "iot", "monitor", "monitoring", "metric", "metrics"],
    blurb: "Fuses device telemetry into the flow.",
  },
  {
    key: "scheduler", label: "Automation Scheduler", stage: 9,
    keywords: ["schedule", "scheduler", "cron", "automation", "automated", "automate", "recurring", "timer", "workflow", "pipeline", "orchestrate", "orchestration"],
    blurb: "Arms the recurring cron schedule for the pipeline.",
  },
];

export const CAPABILITY_BY_KEY = new Map(CAPABILITIES.map((c) => [c.key, c]));

/** Parse raw natural-language intent into an ordered capability set. */
export function parseIntent(rawText: string): ParsedIntent {
  const text = rawText.toLowerCase();
  const tokens = new Set(text.split(/[^a-z0-9]+/).filter((t) => t.length > 0));
  const hits: CapabilityHit[] = [];
  for (const cap of CAPABILITIES) {
    const matched = cap.keywords.filter((k) => tokens.has(k));
    if (matched.length > 0) {
      hits.push({ key: cap.key, label: cap.label, stage: cap.stage, hits: matched });
    }
  }
  hits.sort((a, b) => a.stage - b.stage);
  const totalHits = hits.reduce((s, h) => s + h.hits.length, 0);
  const confidence = hits.length === 0 ? 0 : Math.min(1, totalHits / (hits.length * 2 + 1));
  return { text: rawText, capabilities: hits, confidence };
}

export interface GraphResolution {
  assetId: string | null;
  assetName: string | null;
  assetSlug: string | null;
}

/**
 * Turn a parsed intent into a dependency graph. `resolve` maps each capability
 * to the concrete Code-Asset NFT chosen by the marketplace matching engine.
 * Edges form the canonical pipeline chain across stages.
 */
export function buildGraph(
  parsed: ParsedIntent,
  resolve: (cap: CapabilityHit) => GraphResolution,
): AssetGraph {
  const nodes: GraphNode[] = parsed.capabilities.map((cap) => {
    const r = resolve(cap);
    return {
      id: `cap:${cap.key}`,
      capability: cap.key,
      label: cap.label,
      stage: cap.stage,
      assetId: r.assetId,
      assetName: r.assetName,
      assetSlug: r.assetSlug,
      status: r.assetId ? "resolved" : "missing",
    };
  });
  const edges: GraphEdge[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({ from: nodes[i].id, to: nodes[i + 1].id });
  }
  return { nodes, edges };
}
