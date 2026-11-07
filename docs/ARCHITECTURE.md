# Sovereign Code Exchange — Sovereign-Industrial Code-Asset & Productivity NFT Exchange

A production-grade reference implementation of the **Sovereign-Code-Exchange Protocol**: a self-hosted
Next.js (App Router) + PostgreSQL (Drizzle ORM) node where

1. **non-technical users** (delivery riders, creators, small-business owners) acquire, assemble and run
   verified, high-performance computational/business modules from a plain-language intent — no coding required; and
2. **developers/creators worldwide** mint their modules as **Code-as-Asset NFTs** and earn **lifetime
   automated micro-royalties + gas dividends** whenever their module is executed or composed.

Zero proprietary runtime dependencies for the protocol core (Node.js standard library + BigInt crypto only).

---

## 1. System Topology & Protocol Architecture Blueprint

```
  USER INTENT ──► [III] Marketplace Assembler ──► dependency graph ──► ASSEMBLY (ordered asset ids)
                        │  parseIntent()              (liquidity routing: best benchmarked p50)      │
                        ▼                                                                             ▼
              [I] ASSET REGISTRY ◄── registerAsset(): sha256 + Z_q ring commitment + benchmark ── assets[]
                        │                                                                             │
                        ▼                                                                             ▼
              [II] META-KERNEL: worker sandbox + heap/time limits + entropy invariant + EVENT BUS ◄─────┘
                        │  per cycle × per module: runAssetModule() → ok | QUARANTINE (isolated; pipeline survives)
                        ▼
              execution_steps + events        [III] ROYALTY LEDGER: 1.0 SOV/cycle → creator(royaltyBps) + gas pool
```

### Layer I — Code-Asset NFT & Immutable Metadata Registry
`src/lib/ring.ts`, table `assets`
- `code_hash` = `sha256(code)` (hex)
- Ring commitment over the finite field **Z_q** with `q = 2^255 − 19` (Ed25519 prime), generator `g = 2`:
  `a = H("sovereign-code-exchange/asset-registry/v1" ‖ code_hash) mod q`, `C = g^a mod q`
  (`modPow` implemented with BigInt square-and-multiply — zero dependencies).
- Immutable execution `manifest`: entrypoint, capabilities, hard limits
  (`timeoutMs`, `memoryMb`, `maxOutputBytes`, `maxEntropyBitsPerChar`), required output keys.
- `benchmarks`: live p50 latency / heap / output hash measured through the real kernel at registration.
- Royalty interface: `royalty_bps` (basis points) + `creator_address`.
- `POST /api/assets/:id/verify` recomputes hash + commitment and asserts equality (state-invariant assertion).

### Layer II — Sovereign Asynchronous Tensor & Event Bus
`src/lib/kernel.ts`, `src/lib/bus.ts`, tables `events`, `execution_steps`
- Every module execution runs in an isolated `worker_threads` worker. Module code is compiled via
  `new Function` with `require` and `process` shadowed — no I/O, no escape from the sandbox.
- Hard limits: heap via `resourceLimits`, wall-clock via timeout + `terminate()`.
- Main-thread structural invariants on every output: max bytes, Shannon entropy bits/char, required keys.
- **Automatic Domain Quarantine**: any violation is classified (`timeout | memory | invariant | runtime`),
  the asset row is set to `quarantined` with the reason, the step is recorded, and the pipeline continues
  with pass-through flow. Quarantined modules are skipped in later cycles.
- Async event bus (`emit`/`onEvent`) streams `asset.registered`, `asset.executed`, `asset.quarantined`,
  `royalty.credited`, `execution.started/finished`, … into the `events` table.

### Layer III — Intent-Driven Assembler & Marketplace Engine
`src/lib/intent.ts`, `src/lib/marketplace.ts`, tables `intents`, `assemblies`, `royalty_ledger`
- `parseIntent()` maps natural language to an ordered capability set (intake → transform → logistics →
  billing → publish → notify → sink → sensor → scheduler) with keyword evidence + confidence.
- The matching engine resolves each capability to the **best active asset** (lowest benchmarked p50, then oldest)
  — automated liquidity routing of compute — and builds the dependency graph (SVG-rendered in the UI).
- Assembling credits a **composition fee** (0.1 SOV/asset) to each creator immediately.
- Every **execution cycle** settles **1.0 SOV per module**: `royaltyBps` to the creator, remainder to
  `pool:gas-dividends`. Integer micro-SOV ledger (`royalty_ledger`), append-only.

### Layer IV — Self-Hosting Genesis Driver & Test Harness
`src/lib/genesis.ts`, `POST /api/genesis`
- Idempotently seeds 9 industrial sample modules (intake collector, ETL, fault-tolerant logistics router,
  payout invoicer, podcast publisher, notifier, secure data sink, fault-injecting sensor fusion, cron scheduler).
- `run: true` parses the canonical intent (*"automated delivery dispatch and podcast publishing pipeline with
  secure data warehousing, audit logging and telemetry monitoring"*), assembles it and executes a multi-cycle
  production run — the telemetry module violates the entropy invariant on cycle 2 and is **automatically
  quarantined mid-run** while the pipeline completes.

---

## 2. Run it

```bash
cp .env.example .env 2>/dev/null # or set DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db
npx drizzle-kit push            # apply schema
npm run build && npm start      # production node
# then: open / and press "▶ Run genesis (3 cycles)"   (or: curl -X POST localhost:3000/api/genesis -d '{"run":true}')
```

### HTTP API

| Method | Path | Purpose |
| --- | --- | --- |
| GET/POST | `/api/assets` | list registry (with earnings) / mint a Code-Asset NFT (hash + ring + benchmark) |
| GET/PATCH | `/api/assets/:id` | asset detail / update (code change re-hashes, re-commits, re-benchmarks) |
| POST | `/api/assets/:id/verify` | recompute sha256 + Z_q commitment, assert invariants |
| GET/POST | `/api/intents` | recent intents / parse natural language → dependency graph |
| GET | `/api/intents/:id` | one intent |
| GET/POST | `/api/assemblies` | list / assemble from `intentId` or explicit `assetIds[]` (+ composition royalties) |
| GET | `/api/assemblies/:id` | assembly + its assets |
| GET/POST | `/api/executions` | history / run an assembly N cycles through the meta-kernel |
| GET | `/api/executions/:id` | run detail: steps, assets, event stream |
| GET | `/api/ledger?limit=&assetId=` | royalty ledger entries |
| GET | `/api/creators` | lifetime balances per creator |
| GET | `/api/stats` | dashboard aggregates |
| GET/POST | `/api/genesis` | node status / seed modules (`{run:false}`) or full genesis run (`{run:true, cycles:3}`) |
| GET | `/api/health` | healthcheck |

### Module contract (what developers ship)

```js
// module.exports.execute(input, ctx) -> object merged into the pipeline flow
// input: { cycle, seed, ...outputsOfPreviousStages }
// ctx:   { cycle, assetId, assetSlug }
// require()/process are disabled inside the sandbox; limits are enforced by the kernel.
module.exports.execute = function (input, ctx) {
  return { myOutput: 42 };
};
```

---

## 3. Open-Source Readiness & Contribution Manifest

This codebase is designed to be published **as-is** as a public global good:

1. **License**: release under the **MIT License** (add a `LICENSE` file with the MIT text before publishing).
2. **Publish**:
   ```bash
   git init && git add -A
   git commit -m "Sovereign Code Exchange v1 — Code-Asset NFT & Productivity Exchange"
   git remote add origin https://github.com/<org>/sovereign-code-exchange.git
   git push -u origin main
   ```
3. **No secrets in repo**: only `DATABASE_URL` is needed and must stay in `.env` (gitignored). All other
   configuration is code.
4. **How developers plug in and earn**:
   - open `/marketplace` → "Mint new Code-Asset NFT" (or `POST /api/assets`) with `creatorAddress` + `royaltyBps`;
   - the node hashes + ring-commits + benchmarks the module and makes it matchable by intents immediately;
   - every execution cycle and every composition credits the creator in `/ledger` — lifetime automated revenue.
5. **Contribution guidelines**: keep the protocol core zero-dependency; add capabilities to
   `CAPABILITIES` in `src/lib/intent.ts`; add sample modules to `SAMPLE_MODULES` in `src/lib/genesis.ts`;
   never weaken kernel limits — extend the invariant checks instead.

### Validation

```bash
npx next typegen
npx tsc --noEmit
npm run build
```

---

# SCSEP / SSU Protocol — Python reference core (`core/` + `genesis_exchange_runner.py`)

The same four-layer protocol is implemented as a **zero-dependency Python 3 reference core** (standard library
only) so it can run anywhere without a database:

| File | Layer | Contents |
| --- | --- | --- |
| `core/ssu_manifest.py` | I | SSU schema: SHA-256 fingerprint, finite ring **Z_q** verification contract (Pedersen-style `C = g^a mod q`, q = 2²⁵⁵−19), `PermissionBoundary` (runtime sandbox limits), pre/post-condition `Invariant` assertions (safe operator table, no `eval`), immutable creator royalty routing, ring verification |
| `core/ssu_exchange.py` | II | Marketplace engine: SSU registry + benchmarks, **order book** (bid/ask, price-time priority, trade settlement), intent parser → capability **DAG** resolution (liquidity routing by benchmarked p50), `RoyaltyLedger` settling micro-dividends per execution call (1.0 SSU) and per composition (0.1 SSU) |
| `core/meta_kernel.py` | III | `asyncio` event bus + high-concurrency kernel: sandboxed execution (whitelisted imports/builtins only), wall-clock timeout, tracemalloc heap cap, output size + Shannon-entropy invariants, pre/post-condition checks, **Automated Fault Quarantine** (instant isolation, pipeline survives) |
| `genesis_exchange_runner.py` | IV | Runnable genesis driver: registers 7 industrial SSUs (route scheduler, content publisher, **post-quantum Lamport-OTS proxy**, secure audit sink, fault-injecting telemetry fuser, cron scheduler, intake collector), demos the order book, resolves the canonical intent, executes 3 cycles, asserts quarantine + royalty credits |

```bash
python3 genesis_exchange_runner.py     # prints full report; ends with "GENESIS VERIFICATION: PASS"
```

## Open-Source Contribution Protocol (SCSEP)

1. **Fork & publish** this repo publicly under the MIT License (add `LICENSE`).
2. **Register your skill**: in the web node use the Marketplace UI / `POST /api/assets`, or in Python build an
   `SSUManifest(source=..., royalty_address=..., royalty_bps=..., capabilities=[...], invariants=[...])` and call
   `exchange.register(manifest)`. Your SSU is fingerprinted, ring-committed, benchmarked and immediately
   discoverable by intents and the order book.
3. **Earn lifetime dividends**: every execution call, DAG composition and order-book fill settles micro-royalties
   to your `royalty_address` automatically — auditable in the ledger (`/ledger`, `/api/ledger`).
4. **Safety contract**: keep modules deterministic and side-effect free; declare honest pre/post-condition
   invariants and tight permission boundaries. The kernel quarantines violators automatically — that protects
   the ecosystem, not just you.

---

# SCSEP / SSU Protocol v3.0 — Dual-Track Settlement

v3.0 adds a **dual-track settlement paradigm** on top of the four-layer core:

- **Track A — fiat gateway (democratization)**: non-technical users buy SSU *execution credits* with a
  card / bank transfer / USSD via an abstracted PSP gateway (`core/ssu_settlement.py :: FiatGateway`,
  web: `POST /api/settlements {action:"purchase", ...}`). No wallet or crypto knowledge required.
- **Track B — native stablecoin rails (developer dignity)**: every execution call settles
  **1.00 USDC** — the creator's `royaltyBps` share goes to their immutable royalty address in **USDC**, the
  remainder is node gas in **USDT**; compositions settle 0.10 USDC the same way; order-book fills settle
  peer-to-peer in the maker's chosen rail. All transfers are append-only and **SHA-256 hash-chained**
  (`tx_hash = sha256(prev_tx || payload)`) — `SettlementLedger.verify_chain()` re-audits the whole log.

```bash
python3 genesis_exchange_runner.py   # v3.0 driver: fiat purchase → intent DAG → 3 cycles → USDC/USDT dividends, PASS
```

Web node: `/settlement` page shows both rails, credit accounts and the chained transfer log; genesis SSUs are
the v3.0 industrial set (`Logistics-Dispatcher-V9`, `Podcast-Publisher-Pro`, `Post-Quantum-Crypto-Proxy`,
`Secure-Audit-Sink`, `Telemetry-Fuser`, `Cron-Armer`, `Order-Intake-Collector`).

## v3.0 hardening notes

- **Zero-knowledge metadata**: every SSU publishes a Pedersen-style vector commitment over its *public*
  metadata (`core/ssu_manifest.py :: zk_commit_metadata`); authors can selectively disclose one field
  (`zk_prove`) and anyone verifies it against the aggregate commitment — the source is never disclosed.
- **Fiat HMAC Gateway**: every fiat charge is authenticated with an HMAC-SHA256 signature over the canonical
  payload (`core/ssu_settlement.py :: gateway_sign/verify`, secret from `SCSEP_GATEWAY_SECRET`); the web node
  stores the signature on the settlement row and `POST /api/settlements/verify` re-audits it (timing-safe).
- **On-chain verifier (Track B)**: USDC/USDT transfers are batched into simulated blocks with Merkle roots
  and per-tx inclusion proofs (`MockChain`, `SettlementLedger.verify_onchain`); the web node re-verifies the
  full SHA-256 settlement chain via `/api/settlements/verify`.
- **25.00 SOV ledger credit logic**: each execution call credits **25.00 SOV** (creator `royaltyBps` share +
  gas pool), each composition 2.50 SOV — printed as live `royalty.credited` logs by the genesis driver.
- **Process-isolated meta-kernel**: SSU code runs in a forked child with `RLIMIT_AS` memory cap and a hard
  deadline (`terminate`/`kill`); runaway tasks (e.g. Chaos-Spin-Loop) are quarantined without kernel collapse.

## Public-Good Manifesto & Contribution Standard (v3.0)

1. Publish this repo under MIT as a global public good; keep the protocol core zero-dependency.
2. Register your SSU (code / agent skill / control flow / heuristic) with an immutable royalty address and
   honest pre/post-condition invariants — web: Marketplace UI or `POST /api/assets`; Python:
   `SSUManifest(..., royalty_address="0x...", royalty_bps=..., invariants=[...])` + `exchange.register(manifest)`.
3. Earn sustainably: every call, composition and trade micro-settles to your address in USDC (plus the node's
   USDT gas), auditable in the hash-chained settlement log and the `/ledger`.
4. Respect the safety contract: deterministic, side-effect-free modules inside the permission boundary; the
   kernel's entropy safety guard quarantines violators in real time to protect the whole ecosystem.
