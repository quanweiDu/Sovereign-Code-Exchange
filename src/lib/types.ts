// Shared protocol types for the Sovereign Code & Skill Exchange Protocol (SCSEP).

export interface ModuleLimits {
  timeoutMs: number;
  memoryMb: number;
  maxOutputBytes: number;
  maxEntropyBitsPerChar: number;
}

/** Runtime permission boundary enforced by the kernel sandbox. */
export interface PermissionBoundary {
  allowed: string[]; // e.g. ["compute"]
  denied: string[]; // e.g. ["network", "filesystem", "process", "require"]
}

/** Safe post-condition assertion on a module output (evaluated, never eval'd). */
export interface PostCondition {
  key: string; // output key, or "$root"
  op: "exists" | "missing" | "eq" | "ne" | "gt" | "ge" | "lt" | "le" | "in" | "type";
  value?: unknown;
}

export interface AssetManifest {
  entrypoint: string;
  capabilities: string[];
  limits: ModuleLimits;
  outputs: { requiredKeys: string[] };
  permissions: PermissionBoundary;
  preconditions: { requiredInputKeys: string[] };
  postconditions: PostCondition[];
}

export interface RingParams {
  q: string; // field prime, hex
  g: string; // generator, hex
  a: string; // discrete-log secret derived from code hash, hex
  commitment: string; // C = g^a mod q, hex
  domain: string;
}

export interface Benchmarks {
  runs: number;
  ok: boolean;
  p50Ms: number | null;
  maxMs: number | null;
  heapMb: number | null;
  outputHash: string | null;
  error: string | null;
}

export interface CapabilityHit {
  key: string;
  label: string;
  stage: number;
  hits: string[];
}

export interface ParsedIntent {
  text: string;
  capabilities: CapabilityHit[];
  confidence: number;
}

export type GraphNodeStatus = "resolved" | "missing";

export interface GraphNode {
  id: string;
  capability: string;
  label: string;
  stage: number;
  assetId: string | null;
  assetName: string | null;
  assetSlug: string | null;
  status: GraphNodeStatus;
}

export interface GraphEdge {
  from: string;
  to: string;
}

export interface AssetGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ExecutionSummary {
  cycles: number;
  stepsOk: number;
  stepsQuarantined: number;
  stepsSkipped: number;
  quarantinedAssets: string[];
  royaltiesMicro: number;
  startedAt: string;
  finishedAt: string;
}

export type StepStatus = "ok" | "quarantined" | "skipped";
export type ViolationKind = "timeout" | "memory" | "invariant" | "runtime" | null;

// --- Order book (SSU execution rights) -------------------------------------
export type OrderSide = "bid" | "ask";
export type OrderStatus = "open" | "filled" | "cancelled";

export interface Order {
  id: string;
  side: OrderSide;
  assetId: string;
  owner: string;
  priceMicro: number;
  qty: number;
  filledQty: number;
  status: OrderStatus;
  createdAt: string;
}

export interface OrderFill {
  bidId: string;
  askId: string;
  priceMicro: number;
  qty: number;
}
