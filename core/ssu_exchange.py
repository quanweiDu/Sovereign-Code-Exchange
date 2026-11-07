"""SCSEP Layer II — Dynamic Skill & Code Marketplace Engine.

  * SSU registry: register/verify/benchmark SSUs (quarantine at registration if
    the benchmark violates the kernel invariants).
  * Order book: limit orders (bids/asks) on SSU execution rights with immediate
    price-time-priority matching and trade settlement into the ledger.
  * Intent matching: natural language -> capability set -> optimal DAG of
    interoperable SSUs (liquidity routing of compute: lowest benchmarked p50).
  * Royalty ledger: transparent, zero-overhead automated micro-royalty
    settlement on EVERY execution call and composition.

Zero-dependency: Python standard library only.
"""
from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from .meta_kernel import ExecutionResult, MetaKernel
from .ssu_manifest import SSUManifest
from .ssu_settlement import SettlementRouter

EXECUTION_DIVIDEND_MICRO = 25_000_000  # v3.0: 25.00 SOV ledger credit per execution call
COMPOSITION_DIVIDEND_MICRO = 2_500_000 # v3.0: 2.50 SOV per SSU composed into a DAG
TRADE_FEE_BPS = 0                       # order-book trades settle peer-to-peer
GAS_POOL_ADDRESS = "pool:gas-dividends"

# ---------------------------------------------------------------------------
# Intent capability catalogue (stage = topological position in a pipeline DAG)
# ---------------------------------------------------------------------------
CAPABILITIES: list[dict] = [
    {"key": "intake", "stage": 0, "label": "Order / Event Intake Collector",
     "keywords": ["order", "orders", "intake", "collect", "ingest", "scrape", "fetch", "event", "events", "stream", "capture", "inbound"]},
    {"key": "transform", "stage": 1, "label": "Data Transformer / ETL",
     "keywords": ["transform", "etl", "clean", "normalize", "enrich", "aggregate", "filter", "parse", "convert", "summarize"]},
    {"key": "logistics", "stage": 2, "label": "Fault-Tolerant Route Scheduler",
     "keywords": ["delivery", "deliveries", "dispatch", "logistics", "route", "routes", "routing", "scheduler", "rider", "courier", "fleet", "shipment", "transport", "driver"]},
    {"key": "billing", "stage": 3, "label": "Billing & Payout Invoicer",
     "keywords": ["invoice", "billing", "payment", "payout", "pay", "charge", "pricing", "revenue"]},
    {"key": "publish", "stage": 4, "label": "Automated Content Publisher",
     "keywords": ["podcast", "publish", "publishing", "publisher", "audio", "episode", "newsletter", "content", "digest", "broadcast", "rss"]},
    {"key": "notify", "stage": 5, "label": "Notifier / Alerts",
     "keywords": ["notify", "notification", "alert", "email", "sms", "message"]},
    {"key": "sink", "stage": 6, "label": "Secure Data Sink / Audit Log",
     "keywords": ["data", "sink", "warehouse", "store", "persist", "archive", "audit", "log", "logging", "secure", "ledger", "record"]},
    {"key": "security", "stage": 7, "label": "Post-Quantum Cryptography Proxy",
     "keywords": ["quantum", "post-quantum", "pqc", "crypto", "cryptography", "sign", "signature", "seal", "attest", "attestation", "encrypt", "security", "proxy"]},
    {"key": "sensor", "stage": 8, "label": "Sensor Fusion / Telemetry",
     "keywords": ["sensor", "telemetry", "fusion", "iot", "monitor", "monitoring", "metric"]},
    {"key": "scheduler", "stage": 9, "label": "Automation Cron Scheduler",
     "keywords": ["cron", "automation", "automate", "automated", "recurring", "schedule", "workflow", "pipeline", "orchestrate"]},
]
CAPABILITY_BY_KEY = {c["key"]: c for c in CAPABILITIES}


def parse_intent(text: str) -> tuple[list[dict], float]:
    """Parse natural language into an ordered capability set + confidence."""
    tokens = {t for t in "".join(ch if ch.isalnum() else " " for ch in text.lower()).split() if t}
    hits: list[dict] = []
    for cap in CAPABILITIES:
        matched = [k for k in cap["keywords"] if k in tokens]
        if matched:
            hits.append({"key": cap["key"], "label": cap["label"], "stage": cap["stage"], "hits": matched})
    hits.sort(key=lambda h: h["stage"])
    total = sum(len(h["hits"]) for h in hits)
    confidence = 0.0 if not hits else min(1.0, total / (len(hits) * 2 + 1))
    return hits, confidence


# ---------------------------------------------------------------------------
# Royalty ledger — automated micro-royalty settlement per execution call
# ---------------------------------------------------------------------------
@dataclass
class LedgerEntry:
    seq: int
    kind: str  # execution | composition | trade-debit | trade-credit
    ssu_id: str
    address: str
    amount_micro: int
    bps: int | None
    cycle: int | None
    memo: str
    created_at: float


class RoyaltyLedger:
    def __init__(self) -> None:
        self.entries: list[LedgerEntry] = []

    def _append(self, kind: str, ssu_id: str, address: str, amount_micro: int, bps: int | None, cycle: int | None, memo: str) -> LedgerEntry:
        entry = LedgerEntry(len(self.entries) + 1, kind, ssu_id, address, amount_micro, bps, cycle, memo, time.time())
        self.entries.append(entry)
        return entry

    def settle_execution(self, manifest: SSUManifest, cycle: int) -> int:
        """Zero-overhead automated dividend for ONE execution call: 25.00 SOV ledger credit."""
        fee = EXECUTION_DIVIDEND_MICRO
        creator = (fee * manifest.royalty_bps) // 10000
        pool = fee - creator
        self._append("execution", manifest.ssu_id, manifest.royalty_address, creator, manifest.royalty_bps, cycle,
                     f"cycle {cycle} execution dividend for {manifest.name}")
        self._append("execution", manifest.ssu_id, GAS_POOL_ADDRESS, pool, manifest.royalty_bps, cycle,
                     f"gas dividend (remainder) for {manifest.name}")
        self.last_credits = getattr(self, "last_credits", [])
        self.last_credits.append({"kind": "execution", "ssu": manifest.name, "creator": manifest.royalty_address,
                                  "creator_micro": creator, "pool_micro": pool, "cycle": cycle, "fee_sov": fee / 1e6})
        return fee

    def settle_composition(self, manifest: SSUManifest) -> int:
        fee = COMPOSITION_DIVIDEND_MICRO  # 2.50 SOV
        creator = (fee * manifest.royalty_bps) // 10000
        pool = fee - creator
        self._append("composition", manifest.ssu_id, manifest.royalty_address, creator, manifest.royalty_bps, None,
                     f"composed into a DAG: {manifest.name}")
        self._append("composition", manifest.ssu_id, GAS_POOL_ADDRESS, pool, manifest.royalty_bps, None,
                     f"gas dividend (remainder) for {manifest.name}")
        return fee

    def settle_trade(self, ssu_id: str, seller: str, buyer: str, price_micro: int, qty: int) -> None:
        amount = price_micro * qty
        self._append("trade-credit", ssu_id, seller, amount, None, None, f"order-book fill: sold {qty} execution right(s) at {price_micro} µSSU")
        self._append("trade-debit", ssu_id, buyer, -amount, None, None, f"order-book fill: bought {qty} execution right(s) at {price_micro} µSSU")

    def balance(self, address: str) -> int:
        return sum(e.amount_micro for e in self.entries if e.address == address)

    def balances(self) -> dict[str, int]:
        out: dict[str, int] = {}
        for e in self.entries:
            out[e.address] = out.get(e.address, 0) + e.amount_micro
        return dict(sorted(out.items(), key=lambda kv: kv[1], reverse=True))

    def total_settled_micro(self) -> int:
        return sum(e.amount_micro for e in self.entries if e.amount_micro > 0)


# ---------------------------------------------------------------------------
# Order book for SSU execution rights
# ---------------------------------------------------------------------------
@dataclass
class Order:
    order_id: str
    side: str  # "bid" | "ask"
    ssu_id: str
    owner: str
    price_micro: int
    qty: int
    filled_qty: int = 0
    status: str = "open"  # open | filled | cancelled
    created_at: float = field(default_factory=time.time)

    @property
    def open_qty(self) -> int:
        return self.qty - self.filled_qty


class OrderBook:
    def __init__(self) -> None:
        self.orders: list[Order] = []

    def place(self, side: str, ssu_id: str, owner: str, price_micro: int, qty: int = 1) -> tuple[Order, list[tuple[Order, Order, int, int]]]:
        """Place a limit order; match immediately against the opposite side
        (price-time priority). Returns (order, fills) where each fill is
        (bid, ask, fill_price_micro, fill_qty)."""
        order = Order(str(uuid.uuid4()), side, ssu_id, owner, price_micro, qty)
        self.orders.append(order)
        fills: list[tuple[Order, Order, int, int]] = []
        if side == "bid":
            candidates = sorted((o for o in self.orders if o.side == "ask" and o.status == "open" and o.ssu_id == ssu_id and o.price_micro <= price_micro),
                                key=lambda o: (o.price_micro, o.created_at))
            for ask in candidates:
                if order.open_qty == 0:
                    break
                q = min(order.open_qty, ask.open_qty)
                order.filled_qty += q
                ask.filled_qty += q
                fills.append((order, ask, ask.price_micro, q))
                if ask.open_qty == 0:
                    ask.status = "filled"
        else:
            candidates = sorted((o for o in self.orders if o.side == "bid" and o.status == "open" and o.ssu_id == ssu_id and o.price_micro >= price_micro),
                                key=lambda o: (-o.price_micro, o.created_at))
            for bid in candidates:
                if order.open_qty == 0:
                    break
                q = min(order.open_qty, bid.open_qty)
                order.filled_qty += q
                bid.filled_qty += q
                fills.append((bid, order, order.price_micro, q))
                if bid.open_qty == 0:
                    bid.status = "filled"
        if order.open_qty == 0:
            order.status = "filled"
        return order, fills

    def cancel(self, order_id: str, owner: str) -> bool:
        for o in self.orders:
            if o.order_id == order_id and o.owner == owner and o.status == "open":
                o.status = "cancelled"
                return True
        return False

    def open_orders(self) -> list[Order]:
        return [o for o in self.orders if o.status == "open"]


# ---------------------------------------------------------------------------
# SSU registry
# ---------------------------------------------------------------------------
class SSURegistry:
    def __init__(self) -> None:
        self._ssus: dict[str, SSUManifest] = {}
        self.benchmarks: dict[str, dict] = {}

    def register(self, manifest: SSUManifest) -> SSUManifest:
        if manifest.ssu_id in self._ssus:
            raise ValueError(f"SSU {manifest.ssu_id} already registered")
        self._ssus[manifest.ssu_id] = manifest
        return manifest

    def get(self, ssu_id: str) -> SSUManifest | None:
        return self._ssus.get(ssu_id)

    def all(self) -> list[SSUManifest]:
        return list(self._ssus.values())

    def active(self, kernel: MetaKernel) -> list[SSUManifest]:
        return [m for m in self._ssus.values() if not kernel.is_quarantined(m.ssu_id)]

    def by_capability(self, cap_key: str, kernel: MetaKernel) -> list[SSUManifest]:
        cap = CAPABILITY_BY_KEY.get(cap_key)
        out = []
        for m in self.active(kernel):
            if cap_key in m.capabilities:
                out.append(m)
                continue
            if cap and any(k in (t.lower() for t in m.tags) for k in cap["keywords"]):
                out.append(m)
        return out

    def set_benchmark(self, ssu_id: str, result: ExecutionResult) -> None:
        self.benchmarks[ssu_id] = result.to_dict()


def resolve_dag(cap_hits: list[dict], registry: SSURegistry, kernel: MetaKernel) -> dict:
    """Match capabilities to the optimal interoperable SSUs → a DAG.

    Liquidity routing of compute: among active candidates pick the lowest
    benchmarked p50 latency, then the oldest registration.
    """
    nodes: list[dict] = []
    for cap in cap_hits:
        candidates = registry.by_capability(cap["key"], kernel)

        def sort_key(m: SSUManifest):
            b = registry.benchmarks.get(m.ssu_id, {})
            p50 = b.get("duration_ms") if b.get("ok") else float("inf")
            return (p50, m.created_at)

        best = sorted(candidates, key=sort_key)[0] if candidates else None
        nodes.append({
            "id": f"cap:{cap['key']}",
            "capability": cap["key"],
            "label": cap["label"],
            "stage": cap["stage"],
            "resolved": best is not None,
            "ssu_id": best.ssu_id if best else None,
            "name": best.name if best else None,
        })
    edges = [{"from": nodes[i]["id"], "to": nodes[i + 1]["id"]} for i in range(len(nodes) - 1)]
    return {"nodes": nodes, "edges": edges}


# ---------------------------------------------------------------------------
# The exchange
# ---------------------------------------------------------------------------
class SSUExchange:
    def __init__(self, max_concurrency: int = 8, node_address: str = "node:scsep-local-1") -> None:
        self.kernel = MetaKernel(max_concurrency=max_concurrency)
        self.registry = SSURegistry()
        self.book = OrderBook()
        self.ledger = RoyaltyLedger()               # internal SSU-coin accounting (legacy track)
        self.settlement = SettlementRouter(node_address=node_address)  # v3.0 dual-track settlement
        self.kernel.bus.on("ssu.executed", self._on_executed)
        self._pending_royalty: dict[int, SSUManifest] = {}

    # v3.0 Track A: non-technical users buy execution credits with fiat
    def purchase_credits_fiat(self, user: str, fiat_amount: float, currency: str = "USD", method: str = "card") -> dict:
        return self.settlement.purchase_credits_fiat(user, fiat_amount, currency, method)

    # benchmark + possible registration-time quarantine
    async def register(self, manifest: SSUManifest, sample_input: Any | None = None) -> dict:
        self.registry.register(manifest)
        result = await self.kernel.execute(manifest, sample_input if sample_input is not None else {"seed": {}, "cycle": 0}, {"cycle": 0, "ssu_id": manifest.ssu_id, "benchmark": True})
        self.registry.set_benchmark(manifest.ssu_id, result)
        return {"manifest": manifest, "benchmark": result.to_dict(), "status": "quarantined" if not result.ok else "active"}

    def _on_executed(self, payload: dict) -> None:
        pass  # royalties settled explicitly per call in execute_intent (auditable)

    def place_order(self, side: str, ssu_id: str, owner: str, price_micro: int, qty: int = 1, rail: str = "USDC") -> dict:
        order, fills = self.book.place(side, ssu_id, owner, price_micro, qty)
        for bid, ask, price, q in fills:
            self.ledger.settle_trade(ssu_id, seller=ask.owner, buyer=bid.owner, price_micro=price, qty=q)
            self.settlement.settle_trade(rail, seller=ask.owner, buyer=bid.owner, price_micro=price, qty=q, ssu_id=ssu_id)  # v3 native rail
        return {"order": order.__dict__, "fills": [{"bid": b.order_id, "ask": a.order_id, "price_micro": p, "qty": q} for b, a, p, q in fills]}

    async def execute_intent(self, text: str, cycles: int = 3, seed: dict | None = None, payer: str = "user:anon") -> dict:
        """Full marketplace flow: parse intent → resolve DAG → compose (settle
        composition dividends) → execute N cycles through the kernel (settle
        execution dividends per call) → report."""
        caps, confidence = parse_intent(text)
        dag = resolve_dag(caps, self.registry, self.kernel)
        resolved = [n for n in dag["nodes"] if n["resolved"]]
        manifests = [self.registry.get(n["ssu_id"]) for n in resolved]
        manifests = [m for m in manifests if m]

        # composition dividends (v3: settled natively — USDC to creator, USDT gas to node)
        composition_micro = 0
        for m in manifests:
            composition_micro += self.ledger.settle_composition(m)
            self.settlement.settle_composition(m.settlement.get("address", m.royalty_address), m.royalty_bps, m.name, payer)

        await self.kernel.bus.emit("intent.parsed", {"text": text, "confidence": confidence, "nodes": len(dag["nodes"]), "edges": len(dag["edges"]), "resolved": len(resolved)})
        await self.kernel.bus.emit("dag.assembled", {"dag": dag, "composition_micro": composition_micro})

        flow: dict[str, Any] = dict(seed or {})
        steps: list[dict] = []
        royalties_micro = 0
        quarantined_now: list[str] = []
        started = time.time()
        for cycle in range(1, cycles + 1):
            for m in manifests:
                call_input = {**flow, "cycle": cycle, "seed": (seed or {}).get("seed", {})}
                result = await self.kernel.execute(m, call_input, {"cycle": cycle, "ssu_id": m.ssu_id})
                steps.append(result.to_dict())
                if result.ok:
                    if isinstance(result.output, dict):
                        flow.update(result.output)
                    else:
                        flow["last_output"] = result.output
                    royalties_micro += self.ledger.settle_execution(m, cycle)
                    self.settlement.settle_execution(m.settlement.get("address", m.royalty_address), m.royalty_bps, m.name, cycle, payer)  # v3 dual-track
                    credit = self.ledger.last_credits[-1]
                    await self.kernel.bus.emit("royalty.credited", {
                        "ssu": m.name, "cycle": cycle, "fee_sov": credit["fee_sov"],
                        "creator": credit["creator"], "creator_sov": credit["creator_micro"] / 1e6,
                        "pool_sov": credit["pool_micro"] / 1e6, "rail_usdc": True,
                    })  # live author royalty credit log
                elif result.violation not in ("skipped",):
                    quarantined_now.append(m.ssu_id)
        finished = time.time()

        report = {
            "intent": text,
            "confidence": round(confidence, 4),
            "dag": dag,
            "cycles": cycles,
            "steps": steps,
            "flow_keys": sorted(flow.keys()),
            "quarantined": sorted(set(quarantined_now)),
            "royalties_micro": royalties_micro + composition_micro,
            "composition_micro": composition_micro,
            "duration_ms": round((finished - started) * 1000, 2),
            "ledger_balances": self.ledger.balances(),
            "settlement": self.settlement.report(),   # v3.0 dual-track settlement report
            "events": [{"t": t, "type": ty, "payload": p} for t, ty, p in self.kernel.bus.stream],
        }
        await self.kernel.bus.emit("execution.finished", {k: report[k] for k in ("cycles", "quarantined", "royalties_micro")})
        return report
