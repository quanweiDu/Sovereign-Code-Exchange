#!/usr/bin/env python3
"""SCSEP / SSU Protocol v3.0 — Genesis Exchange Driver & Test Harness.

Uncompressed, fully runnable driver that:

  a) initializes an SSU Exchange Node,
  b) registers sample high-performance industrial SSUs
     (Logistics-Dispatcher-V9, Podcast-Publisher-Pro, Post-Quantum-Crypto-Proxy,
      Secure-Audit-Sink, Order-Intake-Collector, Telemetry-Fuser, Cron-Armer),
  c) lets a NON-TECHNICAL user buy execution credits with fiat (Track A),
  d) resolves a natural-language intent into an executable SSU DAG,
  e) executes the multi-stage pipeline with live runtime logs + invariant checks
     and Automated Fault Quarantine (entropy safety guard),
  f) verifies author royalty dividends settled natively in USDC (Track B) and
     node gas in USDT, with a tamper-evident hash-chained settlement log.

Zero placeholders, zero third-party dependencies (Python stdlib only).

Run:  python3 genesis_exchange_runner.py
"""
from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.ssu_exchange import SSUExchange
from core.ssu_manifest import Invariant, PermissionBoundary, SSUManifest
from core.ssu_settlement import UNIT_USDC, UNIT_USDT

# ---------------------------------------------------------------------------
# Sample industrial SSUs (each defines execute(input, ctx) in a sandboxed ns)
# ---------------------------------------------------------------------------
SAMPLE_SKILLS = [
    {
        "ssu_id": "order-intake-collector",
        "name": "Order-Intake-Collector",
        "category": "logistics",
        "domain_tags": ["logistics", "intake", "orders", "events"],
        "description": "Normalizes raw inbound business events / orders into the pipeline flow.",
        "author": "Genesis Foundry",
        "royalty_address": "0xdev_collector.base",
        "royalty_bps": 400,
        "tags": ["intake", "orders", "collect", "ingest"],
        "capabilities": ["intake"],
        "invariants": [Invariant("post", "orders", "exists"), Invariant("post", "intake_count", "ge", 0)],
        "source": '''
def execute(input, ctx):
    seed = (input or {}).get("seed") or {}
    raw = (input or {}).get("orders") or seed.get("orders") or []
    orders = []
    for i, o in enumerate(raw):
        orders.append({
            "id": o.get("id") or f"ORD-{i+1}",
            "customer": o.get("customer") or f"CUST-{i+1}",
            "zone": o.get("zone") or "central",
            "value": o.get("value") if isinstance(o.get("value"), (int, float)) else 10 + (i * 13) % 40,
            "priority": o.get("priority") or ("high" if i % 3 == 0 else "normal"),
        })
    return {"orders": orders, "intake_count": len(orders)}
''',
    },
    {
        "ssu_id": "logistics-dispatcher-v9",
        "name": "Logistics-Dispatcher-V9",
        "category": "logistics",
        "domain_tags": ["logistics", "dispatch", "routing", "fleet", "delivery"],
        "description": "Fault-tolerant route scheduler: routes every order to a rider with ETA + at-risk flags; pre/post-condition invariants asserted by the kernel.",
        "author": "Genesis Foundry",
        "royalty_address": "0xdev_router.base",
        "royalty_bps": 600,
        "tags": ["logistics", "dispatch", "route", "rider", "fleet", "scheduler"],
        "capabilities": ["logistics"],
        "invariants": [Invariant("pre", "orders", "exists"), Invariant("post", "routes", "exists"), Invariant("post", "dispatch_summary", "exists")],
        "source": '''
def execute(input, ctx):
    orders = (input or {}).get("orders") or []
    cycle = (ctx or {}).get("cycle", 1)
    riders = ["rider-amina", "rider-bao", "rider-carmen", "rider-diego", "rider-elena"]
    routes = []
    for i, o in enumerate(orders):
        eta = 4 + ((i * 7 + cycle * 3) % 26)
        routes.append({
            "order_id": o.get("id"),
            "rider": riders[(i + cycle) % len(riders)],
            "zone": o.get("zone") or "central",
            "eta_min": eta,
            "priority": o.get("priority") or "normal",
            "status": "dispatched" if eta <= 24 else "at-risk",
        })
    at_risk = sum(1 for r in routes if r["eta_min"] > 24)
    return {"routes": routes, "dispatch_summary": {"dispatched": len(routes), "at_risk": at_risk, "cycle": cycle}}
''',
    },
    {
        "ssu_id": "podcast-publisher-pro",
        "name": "Podcast-Publisher-Pro",
        "category": "media",
        "domain_tags": ["media", "publishing", "podcast", "content"],
        "description": "Automated content publisher: turns each cycle's dispatch summary into a published podcast episode / digest.",
        "author": "Genesis Foundry",
        "royalty_address": "0xdev_publisher.base",
        "royalty_bps": 700,
        "tags": ["publish", "podcast", "digest", "content", "episode"],
        "capabilities": ["publish"],
        "invariants": [Invariant("post", "episode", "exists")],
        "source": '''
def execute(input, ctx):
    cycle = (ctx or {}).get("cycle", 1)
    s = (input or {}).get("dispatch_summary") or {"dispatched": 0, "at_risk": 0}
    episode = {
        "id": f"EP-{cycle:03d}",
        "title": f"Dispatch Digest #{cycle} — {s.get('dispatched', 0)} orders routed",
        "summary": f"Cycle {cycle}: dispatched {s.get('dispatched', 0)}, at-risk {s.get('at_risk', 0)}.",
        "status": "published",
    }
    return {"episode": episode, "feed": [episode]}
''',
    },
    {
        "ssu_id": "post-quantum-crypto-proxy",
        "name": "Post-Quantum-Crypto-Proxy",
        "category": "security",
        "domain_tags": ["security", "post-quantum", "pqc", "signatures", "attestation"],
        "description": "Post-quantum cryptography proxy: Lamport one-time signature (hash-based, quantum-resistant) over SHA-256 of the pipeline flow. Stdlib only.",
        "author": "Genesis Foundry",
        "royalty_address": "0xdev_pqc.base",
        "royalty_bps": 800,
        "tags": ["quantum", "post-quantum", "pqc", "crypto", "sign", "seal", "attest", "security", "proxy"],
        "capabilities": ["security"],
        "invariants": [Invariant("post", "attestation", "exists"), Invariant("post", "$root", "type", "dict")],
        "source": '''
import hashlib, json

def _h(b):
    return hashlib.sha256(b).digest()

def execute(input, ctx):
    cycle = (ctx or {}).get("cycle", 1)
    payload = json.dumps(input, sort_keys=True, default=str).encode("utf-8")
    digest = _h(payload)
    seed = ("pqc-proxy:" + str(cycle)).encode("utf-8")
    priv = [(_h(seed + b":0:" + str(i).encode()), _h(seed + b":1:" + str(i).encode())) for i in range(256)]
    pub = [(_h(a), _h(b)) for a, b in priv]
    sig = []
    for i in range(256):
        bit = (digest[i // 8] >> (7 - i % 8)) & 1
        sig.append(priv[i][bit])
    verified = all(_h(sig[i]) == pub[i][(digest[i // 8] >> (7 - i % 8)) & 1] for i in range(256))
    return {"attestation": {
        "scheme": "lamport-ots-sha256 (post-quantum)",
        "chain": "base",
        "digest": digest.hex(),
        "signature": [s.hex() for s in sig],
        "public_key": [p.hex() for pair in pub for p in pair],
        "verified": verified,
    }}
''',
    },
    {
        "ssu_id": "secure-audit-sink",
        "name": "Secure-Audit-Sink",
        "category": "security",
        "domain_tags": ["security", "audit", "storage", "data"],
        "description": "Seals every routed record into a SHA-256 hash-chained audit log.",
        "author": "Genesis Foundry",
        "royalty_address": "0xdev_sink.base",
        "royalty_bps": 450,
        "tags": ["sink", "audit", "log", "secure", "data", "warehouse"],
        "capabilities": ["sink"],
        "invariants": [Invariant("post", "seal", "exists")],
        "source": '''
import hashlib, json

def execute(input, ctx):
    cycle = (ctx or {}).get("cycle", 1)
    routes = (input or {}).get("routes") or []
    chain = (input or {}).get("seal") or "SCSEP-GENESIS"
    records = []
    for r in routes:
        rec = json.dumps(r, sort_keys=True, default=str)
        chain = hashlib.sha256((chain + "|" + rec).encode("utf-8")).hexdigest()
        records.append({"order_id": r.get("order_id"), "rider": r.get("rider"), "digest": chain[-16:]})
    return {"seal": chain, "sink": {"stored": len(records), "records": records, "cycle": cycle, "sealed": True}}
''',
    },
    {
        "ssu_id": "telemetry-fuser",
        "name": "Telemetry-Fuser",
        "category": "iot",
        "domain_tags": ["iot", "telemetry", "sensors", "monitoring"],
        "description": "FAULT-INJECTING reference SSU: on cycle 2 it emits an entropy-runaway blob → the kernel's entropy safety guard quarantines it instantly.",
        "author": "Genesis Foundry",
        "royalty_address": "0xdev_sensor.base",
        "royalty_bps": 350,
        "tags": ["sensor", "telemetry", "fusion", "monitoring"],
        "capabilities": ["sensor"],
        "invariants": [Invariant("post", "telemetry", "exists")],
        "source": '''
import base64, hashlib

def execute(input, ctx):
    cycle = (ctx or {}).get("cycle", 1)
    if cycle == 2:
        blob = b""
        x = b"telemetry-fault"
        while len(blob) < 4096:
            x = hashlib.sha256(x).digest()
            blob += x
        return {"telemetry": base64.b64encode(blob).decode("ascii")}
    return {"telemetry": "nominal", "uptime_pct": 99 + (cycle % 2)}
''',
    },
    {
        "ssu_id": "fee-enrichment-etl",
        "name": "Fee-Enrichment-ETL",
        "category": "logistics",
        "domain_tags": ["etl", "transform", "enrichment", "fees"],
        "description": "Transforms orders into fee-enriched records (ETL stage).",
        "author": "Genesis Foundry",
        "royalty_address": "0xdev_etl.base",
        "royalty_bps": 300,
        "tags": ["transform", "etl", "enrich", "normalize"],
        "capabilities": ["transform"],
        "invariants": [Invariant("post", "transform_applied", "exists")],
        "source": '''
def execute(input, ctx):
    orders = (input or {}).get("orders") or []
    enriched = []
    for o in orders:
        v = o.get("value") if isinstance(o.get("value"), (int, float)) else 10
        enriched.append({"id": o.get("id"), "zone": o.get("zone"), "value": v,
                         "priority": o.get("priority"), "fee": round(v * 0.12, 2)})
    return {"orders": enriched, "transform_applied": "fee-enrichment-v3"}
''',
    },
    {
        "ssu_id": "billing-invoicer-pro",
        "name": "Billing-Invoicer-Pro",
        "category": "finance",
        "domain_tags": ["billing", "invoicing", "payouts", "finance"],
        "description": "Computes per-rider payouts and invoice totals from routed deliveries.",
        "author": "Genesis Foundry",
        "royalty_address": "0xdev_billing.base",
        "royalty_bps": 500,
        "tags": ["billing", "invoice", "payout", "payment"],
        "capabilities": ["billing"],
        "invariants": [Invariant("post", "payout_total", "ge", 0)],
        "source": '''
def execute(input, ctx):
    routes = (input or {}).get("routes") or []
    invoices = []
    total = 0.0
    for r in routes:
        base = 2.5 + (1.5 if r.get("priority") == "high" else 0)
        amt = round(base + r.get("eta_min", 0) * 0.1, 2)
        total += amt
        invoices.append({"rider": r.get("rider"), "order_id": r.get("order_id"), "amount": amt})
    return {"invoices": invoices, "payout_total": round(total, 2)}
''',
    },
    {
        "ssu_id": "ops-alert-notifier",
        "name": "Ops-Alert-Notifier",
        "category": "automation",
        "domain_tags": ["notifications", "alerts", "ops"],
        "description": "Sends a per-cycle ops notification derived from the dispatch summary.",
        "author": "Genesis Foundry",
        "royalty_address": "0xdev_notify.base",
        "royalty_bps": 250,
        "tags": ["notify", "alert", "notification", "ops"],
        "capabilities": ["notify"],
        "invariants": [Invariant("post", "notifications", "exists")],
        "source": '''
def execute(input, ctx):
    cycle = (ctx or {}).get("cycle", 1)
    s = (input or {}).get("dispatch_summary") or {"dispatched": 0, "at_risk": 0}
    return {"notifications": [{"channel": "ops-dashboard", "cycle": cycle,
        "message": f"cycle {cycle}: {s.get('dispatched', 0)} dispatched, {s.get('at_risk', 0)} at risk", "sent": True}]}
''',
    },
    {
        "ssu_id": "chaos-spin-loop",
        "name": "Chaos-Spin-Loop",
        "category": "testing",
        "domain_tags": ["chaos", "stress", "timeout", "testing"],
        "description": "Stress SSU that hangs forever — the kernel's deadline limit must quarantine it (timeout path of the safety guard).",
        "author": "Genesis Foundry",
        "royalty_address": "0xdev_chaos.base",
        "royalty_bps": 100,
        "tags": ["chaos", "stress", "timeout", "spin"],
        "capabilities": ["stress"],
        "invariants": [],
        "source": '''
def execute(input, ctx):
    while True:
        pass  # deliberate infinite loop: kernel deadline quarantine must fire
''',
    },
    {
        "ssu_id": "cron-armer",
        "name": "Cron-Armer",
        "category": "automation",
        "domain_tags": ["automation", "cron", "scheduling", "workflows"],
        "description": "Arms the recurring cron that re-runs the assembled pipeline.",
        "author": "Genesis Foundry",
        "royalty_address": "0xdev_cron.base",
        "royalty_bps": 200,
        "tags": ["cron", "automation", "schedule", "pipeline", "workflow"],
        "capabilities": ["scheduler"],
        "invariants": [Invariant("post", "schedule", "exists")],
        "source": '''
def execute(input, ctx):
    cycle = (ctx or {}).get("cycle", 1)
    return {"schedule": {"cron": "*/15 * * * *", "next_run_in_min": 15, "cycle": cycle, "status": "armed"}}
''',
    },
]

# A non-technical user's plain-language intent
USER_INTENT = (
    "Hi! I run a delivery cooperative and I want to automate route dispatch for my riders, "
    "publish a daily podcast digest about operations, seal everything through a post-quantum "
    "crypto proxy, keep a secure audit log, and monitor telemetry — without writing any code."
)

_ORDERS = [
    {"id": f"ORD-{1000 + i}", "customer": f"CUST-{i+1}", "zone": ["central", "north", "east", "south", "west"][i % 5],
     "value": 12 + (i * 17) % 55, "priority": "high" if i % 3 == 0 else "normal"}
    for i in range(8)
]
SEED = {"orders": _ORDERS, "seed": {"orders": _ORDERS}, "meta": {"source": "genesis-seed"}}


def banner(title: str) -> None:
    print("\n" + "=" * 78 + f"\n  {title}\n" + "=" * 78)


async def main() -> int:
    banner("SCSEP / SSU PROTOCOL v3.0 — GENESIS EXCHANGE NODE initialization")
    exchange = SSUExchange(max_concurrency=8, node_address="node:scsep-local-1")

    banner("a) LAYER I — registering industrial SSUs (SHA-256 fingerprint + Z_q ring contract + benchmark)")
    royalty_log: list[dict] = []
    def on_royalty(payload: dict) -> None:
        royalty_log.append(payload)
        print(f"    💰 royalty.credited: {payload['creator_sov']:.6f} SOV → {payload['creator']} "
              f"(fee {payload['fee_sov']:.2f} SOV, cycle {payload['cycle']}, SSU {payload['ssu']}; gas {payload['pool_sov']:.6f} SOV → pool)")
    exchange.kernel.bus.on("royalty.credited", on_royalty)
    for spec in SAMPLE_SKILLS:
        manifest = SSUManifest(
            ssu_id=spec["ssu_id"], name=spec["name"], source=spec["source"],
            author=spec["author"], royalty_address=spec["royalty_address"], royalty_bps=spec["royalty_bps"],
            description=spec["description"], tags=spec["tags"], capabilities=spec["capabilities"],
            domain_tags=spec["domain_tags"], category=spec["category"],
            invariants=spec["invariants"], permissions=PermissionBoundary(),
        )
        reg = await exchange.register(manifest, sample_input={"seed": SEED["seed"], "orders": SEED["orders"], "cycle": 0})
        v = manifest.verify()
        b = reg["benchmark"]
        status = "ACTIVE" if reg["status"] == "active" else "QUARANTINED"
        print(f"  [{status:11s}] {manifest.name:28s} cat={manifest.category:10s} "
              f"fp={manifest.fingerprint[:10]}… C={manifest.ring['commitment'][:12]}… bench={b['duration_ms']}ms "
              f"royalty→{manifest.settlement['address']} @{manifest.royalty_bps / 100:.0f}% ring_ok={v['valid']}")
        assert v["valid"], f"ring verification failed for {manifest.ssu_id}"
        assert manifest.zk.get("aggregate"), "ZK metadata commitment missing"

    banner("b) TRACK A (fiat) — non-technical user buys execution credits with a card")
    user = "amina@delivery-coop"
    receipt = exchange.purchase_credits_fiat(user, 12.00, currency="USD", method="card")
    print(f"  user: {user}")
    print(f"  charged: {receipt['charged']:.2f} {receipt['currency']} via {receipt['method']}  receipt={receipt['receipt'][:16]}…")
    print(f"  execution credits minted: {receipt['credits_usdc']:.2f} USDC  (balance={exchange.settlement.credit_balance(user) / UNIT_USDC:.2f} USDC)")

    banner("c) ORDER BOOK — execution-rights limit order on Logistics-Dispatcher-V9 (settles in USDC)")
    ask = exchange.place_order("ask", "logistics-dispatcher-v9", "0xdev_router.base", price_micro=500_000, qty=2, rail="USDC")
    bid = exchange.place_order("bid", "logistics-dispatcher-v9", user, price_micro=600_000, qty=2, rail="USDC")
    print(f"  ask 500000 µUSDC x2 placed by 0xdev_router.base; bid 600000 µUSDC x2 by {user}")
    print(f"  fills: {[(f['qty'], f['price_micro']) for f in bid['fills']]} → settled peer-to-peer in USDC")
    assert bid["fills"], "order book failed to match"

    banner("d+e) INTENT RESOLUTION → SSU DAG → multi-cycle pipeline execution (kernel logs + invariants)")
    print(f"  intent: {USER_INTENT!r}\n")
    report = await exchange.execute_intent(USER_INTENT, cycles=3, seed=SEED, payer=user)
    print(f"  intent confidence={report['confidence']}  DAG:")
    for n in report["dag"]["nodes"]:
        print(f"    stage {n['stage']} {n['capability']:10s} -> {'SSU ' + n['ssu_id'] if n['resolved'] else 'UNRESOLVED'}")
    print("\n  live runtime log:")
    for s in report["steps"]:
        flag = "OK" if s["ok"] else ("QUARANTINED" if s["violation"] != "skipped" else "SKIPPED")
        ent = f"{s['entropy']:.2f}b/c" if s["entropy"] is not None else "  -   "
        print(f"    cycle {s['cycle']} {s['ssu_id']:26s} {flag:11s} viol={str(s['violation']):9s} "
              f"{s['duration_ms']:6.2f}ms entropy={ent} fp={str(s['output_fingerprint'])[:10]}…")
        if s["error"]:
            print(f"      reason: {s['error'][:100]}")

    banner("f) VERIFICATION — quarantine + dual-track royalty dividends + chain integrity")
    quarantined = report["quarantined"]
    assert "telemetry-fuser" in quarantined, "entropy safety guard failed to quarantine telemetry-fuser"
    print(f"  ✓ Automated Fault Quarantine: {quarantined} isolated on cycle 2 (entropy runaway); skipped on cycle 3")
    router_ok_cycles = {s["cycle"] for s in report["steps"] if s["ssu_id"] == "logistics-dispatcher-v9" and s["ok"]}
    assert router_ok_cycles == {1, 2, 3}, "kernel collapsed after quarantine"
    print(f"  ✓ kernel did not collapse: Logistics-Dispatcher-V9 OK in cycles {sorted(router_ok_cycles)}")

    rep = report["settlement"]
    assert rep["chain_valid"], "settlement hash chain broken"
    print(f"  ✓ settlement hash chain valid ({rep['transfers']} transfers)")
    print(f"  ✓ totals by rail: " + ", ".join(f"{rail}={amt:,}µ" for rail, amt in rep["totals_by_rail"].items()))
    print("\n  Track B — native stablecoin balances (USDC royalties / USDT node gas):")
    for rail, bals in rep["balances"].items():
        if rail == "USDC":
            for addr, amt in sorted(bals.items(), key=lambda kv: -kv[1]):
                if amt: print(f"    USDC {addr:28s} {amt / UNIT_USDC:>10.6f} USDC")
        if rail == "USDT":
            for addr, amt in sorted(bals.items(), key=lambda kv: -kv[1]):
                if amt: print(f"    USDT {addr:28s} {amt / UNIT_USDT:>10.6f} USDT")
    devs = [a for a in rep["balances"].get("USDC", {}) if a.startswith("0xdev_") and rep["balances"]["USDC"][a] > 0]
    assert len(devs) >= 5, "developers did not receive USDC dividends"
    print(f"\n  ✓ {len(devs)} developers received automated USDC royalty dividends "
          f"(e.g. 0xdev_router.base = {rep['balances']['USDC'].get('0xdev_router.base', 0) / UNIT_USDC:.4f} USDC)")
    print(f"  ✓ node provider gas (USDT): node:scsep-local-1 = {rep['balances'].get('USDT', {}).get('node:scsep-local-1', 0) / UNIT_USDT:.4f} USDT")
    print(f"  ✓ payer {user} credits left: {exchange.settlement.credit_balance(user) / UNIT_USDC:.2f} USDC")

    # 25.00 SOV ledger credit logic
    from core.ssu_exchange import EXECUTION_DIVIDEND_MICRO
    assert EXECUTION_DIVIDEND_MICRO == 25_000_000, "25.00 SOV execution credit logic broken"
    assert royalty_log and all(c["fee_sov"] == 25.0 for c in royalty_log), "every execution call must credit 25.00 SOV"
    print(f"  ✓ 25.00 SOV ledger credit logic: {len(royalty_log)} live author royalty credits logged this run "
          f"(each fee = 25.00 SOV, split creator/gas-pool)")
    # ZK selective disclosure demo
    m = exchange.registry.get("logistics-dispatcher-v9")
    proof = m.zk_prove("royalty_bps")
    from core.ssu_manifest import zk_verify_field_proof
    assert zk_verify_field_proof(proof["commitment"], "royalty_bps", proof["value"], proof), "ZK field proof failed"
    print(f"  ✓ ZK metadata proof: Logistics-Dispatcher-V9 royalty_bps={proof['value']} verified against aggregate commitment {m.zk['aggregate'][:14]}… (source never disclosed)")

    banner("SCSEP v3.0 GENESIS VERIFICATION: PASS — 11 SSUs, 3-cycle DAG, quarantine, 25 SOV credits, USDC/USDT rails")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
