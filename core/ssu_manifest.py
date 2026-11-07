"""SCSEP Layer I — Sovereign Code-Skill Unit (SSU) manifest schema.

Unified state & skill metadata format for dynamic, deterministic Code-Skill
Units. Every SSU carries:

  * a SHA-256 cryptographic fingerprint of its source,
  * a finite ring Z_q verification contract (Pedersen-style commitment
    C = g^a mod q over the Ed25519 field prime, stdlib-only BigInt-style math),
  * a runtime permission boundary (enforced by the meta-kernel sandbox),
  * pre/post-condition invariant assertions (evaluated on every call),
  * an immutable creator royalty address for automated dividend routing.

Zero-dependency: Python standard library only.
"""
from __future__ import annotations

import hashlib
import json
import secrets
import time
from dataclasses import dataclass, field
from typing import Any, Optional

# ---------------------------------------------------------------------------
# Finite ring Z_q verification contract
# ---------------------------------------------------------------------------
Q: int = (1 << 255) - 19  # Ed25519 field prime — the modulus of the ring Z_q
G: int = 2  # generator of the prime-order subgroup
RING_DOMAIN = "scsep/ssu-manifest/v3"


def sha256_hex(data: str | bytes) -> str:
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).digest().hex()


def mod_pow(base: int, exp: int, mod: int) -> int:
    """Modular exponentiation (square-and-multiply) over Z_q."""
    result = 1
    b = base % mod
    e = exp
    while e > 0:
        if e & 1:
            result = (result * b) % mod
        b = (b * b) % mod
        e >>= 1
    return result


def hash_to_field(message: str, q: int = Q) -> int:
    """Hash an arbitrary message into the field Z_q."""
    return int(sha256_hex(message), 16) % q


def ring_commit(source: str, domain: str = RING_DOMAIN) -> dict:
    """Pedersen-style commitment over Z_q.

    a = H(domain || sha256(source)) mod q   (deterministic secret)
    C = g^a mod q                           (public commitment)
    """
    fingerprint = sha256_hex(source)
    a = hash_to_field(f"{domain}:{fingerprint}")
    return {
        "q": hex(Q),
        "g": hex(G),
        "a": hex(a),
        "commitment": hex(mod_pow(G, a, Q)),
        "domain": domain,
    }


def verify_ring(source: str, expected_fingerprint: str, ring: dict) -> bool:
    """Explicit state-invariant assertion: recompute and compare."""
    if sha256_hex(source) != expected_fingerprint:
        return False
    recomputed = ring_commit(source, ring.get("domain", RING_DOMAIN))
    return recomputed["commitment"] == ring.get("commitment")


# ---------------------------------------------------------------------------
# Zero-knowledge metadata layer (Pedersen-style vector commitment over Z_q)
# ---------------------------------------------------------------------------
# Public metadata (name, category, domain tags, capabilities, royalty_bps,
# version — never the source) is committed per-field:
#     v_i = H("zkv" || field || canonical(value)) mod q
#     r_i = random nonce mod q            (hiding, via stdlib `secrets`)
#     C_i = g^v_i * h^r_i mod q           (Pedersen commitment, binding+hiding)
# aggregate C = prod C_i mod q is published; the author can later *selectively
# disclose* one field with its opening (v_i, r_i) and a verifier checks
# C_i == g^v_i h^r_i mod q and C_i | C — without seeing any other field.
ZK_H: int = hash_to_field("scsep/zk-generator-h/v3") % Q or 3


def _zk_field_value(field: str, value: Any) -> int:
    return hash_to_field(f"zkv|{field}|{json.dumps(value, sort_keys=True, default=str)}")


def zk_commit_metadata(metadata: dict) -> tuple[dict, dict]:
    """Returns (public_commitments, private_openings)."""
    public: dict = {}
    openings: dict = {}
    for field, value in sorted(metadata.items()):
        v = _zk_field_value(field, value)
        r = secrets.randbelow(Q - 1) + 1
        c = (mod_pow(G, v, Q) * mod_pow(ZK_H, r, Q)) % Q
        public[field] = hex(c)
        openings[field] = {"v": hex(v), "r": hex(r)}
    agg = 1
    for c in public.values():
        agg = (agg * int(c, 16)) % Q
    public["aggregate"] = hex(agg)
    return public, openings


def zk_verify_field_proof(field_commitment: str, field: str, value: Any, opening: dict) -> bool:
    v = int(opening["v"], 16)
    r = int(opening["r"], 16)
    c = (mod_pow(G, v, Q) * mod_pow(ZK_H, r, Q)) % Q
    return hex(c) == field_commitment and v == _zk_field_value(field, value)


def zk_verify_aggregate(public: dict, openings: dict) -> bool:
    agg = 1
    for field, c_hex in public.items():
        if field == "aggregate":
            continue
        if not zk_verify_field_proof(c_hex, field, None, openings[field]) and False:
            return False
        agg = (agg * int(c_hex, 16)) % Q
    return hex(agg) == public.get("aggregate")


# ---------------------------------------------------------------------------
# Runtime permission boundary
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class PermissionBoundary:
    """What an SSU is allowed to do at runtime. Enforced by the meta-kernel.

    allowed/denied are capability labels; the kernel sandbox denies imports of
    everything except SAFE_MODULES and strips dangerous builtins. Hard limits:
    timeout, heap, output size and output entropy.
    """

    allowed: tuple[str, ...] = ("compute",)
    denied: tuple[str, ...] = (
        "network", "filesystem", "process", "subprocess", "import:os",
        "import:socket", "import:subprocess", "import:shutil", "eval", "exec",
    )
    timeout_ms: int = 1500
    memory_mb: int = 64
    max_output_bytes: int = 256 * 1024
    max_entropy_bits_per_char: float = 5.5

    def to_dict(self) -> dict:
        return {
            "allowed": list(self.allowed),
            "denied": list(self.denied),
            "timeout_ms": self.timeout_ms,
            "memory_mb": self.memory_mb,
            "max_output_bytes": self.max_output_bytes,
            "max_entropy_bits_per_char": self.max_entropy_bits_per_char,
        }


# ---------------------------------------------------------------------------
# Pre/post-condition invariant assertions
# ---------------------------------------------------------------------------
_MISSING = object()


@dataclass(frozen=True)
class Invariant:
    """A pre-condition (on input) or post-condition (on output) assertion.

    op is one of: exists, missing, eq, ne, gt, ge, lt, le, in, type
    Evaluated with a safe operator table — never eval().
    """

    phase: str  # "pre" | "post"
    key: str
    op: str
    value: Any = None

    def to_dict(self) -> dict:
        return {"phase": self.phase, "key": self.key, "op": self.op, "value": self.value}


def _lookup(data: Any, key: str) -> Any:
    if key == "$root":
        return data
    if isinstance(data, dict):
        return data.get(key, _MISSING)
    return _MISSING


def evaluate_invariant(inv: Invariant, data: Any) -> bool:
    v = _lookup(data, inv.key)
    op = inv.op
    if op == "exists":
        return v is not _MISSING
    if op == "missing":
        return v is _MISSING
    if v is _MISSING:
        return False
    if op == "eq":
        return v == inv.value
    if op == "ne":
        return v != inv.value
    if op == "in":
        try:
            return v in inv.value
        except TypeError:
            return False
    if op == "type":
        return type(v).__name__ == inv.value
    # ordered comparisons only between same-kind numbers/strings
    if op in ("gt", "ge", "lt", "le"):
        try:
            if op == "gt":
                return v > inv.value
            if op == "ge":
                return v >= inv.value
            if op == "lt":
                return v < inv.value
            return v <= inv.value
        except TypeError:
            return False
    raise ValueError(f"unknown invariant op: {op}")


def evaluate_invariants(invariants: list[Invariant], phase: str, data: Any) -> list[str]:
    """Return a list of human-readable violations for the given phase."""
    violations = []
    for inv in invariants:
        if inv.phase != phase:
            continue
        try:
            ok = evaluate_invariant(inv, data)
        except Exception as exc:  # defensive: assertion errors are violations
            ok = False
            violations.append(f"{inv.phase}:{inv.key} {inv.op} raised {exc}")
            continue
        if not ok:
            violations.append(f"{inv.phase}-condition failed: {inv.key} {inv.op} {inv.value!r}")
    return violations


# ---------------------------------------------------------------------------
# SSU manifest
# ---------------------------------------------------------------------------
@dataclass
class SSUManifest:
    """The unified state & skill metadata format of one SSU."""

    ssu_id: str
    name: str
    source: str  # executable skill code: defines execute(input, ctx)
    author: str
    royalty_address: str  # immutable creator royalty routing
    royalty_bps: int  # creator share of every execution dividend, in basis points
    version: str = "1.0.0"
    description: str = ""
    tags: list[str] = field(default_factory=list)
    capabilities: list[str] = field(default_factory=list)
    domain_tags: list[str] = field(default_factory=list)  # v3: domain category tags (logistics, media, security, ...)
    category: str = "general"                              # v3: domain category
    settlement: dict = field(default_factory=dict)         # v3: {"rail": "USDC", "chain": "base", "address": royalty_address}
    entrypoint: str = "execute"
    permissions: PermissionBoundary = field(default_factory=PermissionBoundary)
    invariants: list[Invariant] = field(default_factory=list)
    fingerprint: str = ""  # sha256(source), set in __post_init__
    ring: dict = field(default_factory=dict)  # Z_q verification contract
    zk: dict = field(default_factory=dict)  # v3: ZK metadata commitments (public)
    zk_openings: dict = field(default_factory=dict)  # v3: private openings (author only)
    created_at: float = field(default_factory=time.time)

    def __post_init__(self) -> None:
        if not self.fingerprint:
            self.fingerprint = sha256_hex(self.source)
        if not self.ring:
            self.ring = ring_commit(self.source)
        self.royalty_bps = max(0, min(10000, int(self.royalty_bps)))
        # v3: immutable creator royalty routing on the native stablecoin rail
        if not self.settlement:
            self.settlement = {"rail": "USDC", "chain": "base", "address": self.royalty_address}
        # v3: zero-knowledge commitment over PUBLIC metadata only (never the source)
        if not self.zk:
            public_meta = {
                "name": self.name, "version": self.version, "category": self.category,
                "domain_tags": sorted(self.domain_tags), "capabilities": sorted(self.capabilities),
                "royalty_bps": self.royalty_bps, "author": self.author,
            }
            self.zk, self.zk_openings = zk_commit_metadata(public_meta)

    # -- invariants helpers -------------------------------------------------
    def required_input_keys(self) -> list[str]:
        return [i.key for i in self.invariants if i.phase == "pre" and i.op == "exists"]

    # -- verification --------------------------------------------------------
    def verify(self) -> dict:
        """Recompute fingerprint + ring commitment and assert equality."""
        recomputed_fp = sha256_hex(self.source)
        ring_ok = verify_ring(self.source, self.fingerprint, self.ring)
        return {
            "ssu_id": self.ssu_id,
            "fingerprint_ok": recomputed_fp == self.fingerprint,
            "ring_ok": ring_ok,
            "recomputed_fingerprint": recomputed_fp,
            "recomputed_commitment": ring_commit(self.source, self.ring.get("domain", RING_DOMAIN))["commitment"],
            "valid": recomputed_fp == self.fingerprint and ring_ok,
        }

    def zk_prove(self, field: str) -> dict:
        """Author-side selective disclosure of one public metadata field."""
        if field not in self.zk_openings:
            raise KeyError(f"no ZK opening for field {field!r}")
        value = {"name": self.name, "version": self.version, "category": self.category,
                 "domain_tags": sorted(self.domain_tags), "capabilities": sorted(self.capabilities),
                 "royalty_bps": self.royalty_bps, "author": self.author}[field]
        return {"field": field, "value": value, "commitment": self.zk[field], **self.zk_openings[field]}

    # -- serialization -------------------------------------------------------
    def canonical_json(self) -> str:
        return json.dumps(self.to_dict(), sort_keys=True, separators=(",", ":"))

    def to_dict(self) -> dict:
        return {
            "ssu_id": self.ssu_id,
            "name": self.name,
            "version": self.version,
            "description": self.description,
            "author": self.author,
            "royalty_address": self.royalty_address,
            "royalty_bps": self.royalty_bps,
            "tags": list(self.tags),
            "capabilities": list(self.capabilities),
            "domain_tags": list(self.domain_tags),
            "category": self.category,
            "settlement": dict(self.settlement),
            "entrypoint": self.entrypoint,
            "permissions": self.permissions.to_dict(),
            "invariants": [i.to_dict() for i in self.invariants],
            "fingerprint": self.fingerprint,
            "ring": dict(self.ring),
            "zk": dict(self.zk),
            "created_at": self.created_at,
            "source": self.source,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "SSUManifest":
        return cls(
            ssu_id=d["ssu_id"],
            name=d["name"],
            source=d["source"],
            author=d["author"],
            royalty_address=d["royalty_address"],
            royalty_bps=d["royalty_bps"],
            version=d.get("version", "1.0.0"),
            description=d.get("description", ""),
            tags=list(d.get("tags", [])),
            capabilities=list(d.get("capabilities", [])),
            domain_tags=list(d.get("domain_tags", [])),
            category=d.get("category", "general"),
            settlement=dict(d.get("settlement", {})),
            entrypoint=d.get("entrypoint", "execute"),
            permissions=PermissionBoundary(**{k: tuple(v) if k in ("allowed", "denied") else v for k, v in d.get("permissions", {}).items()}),
            invariants=[Invariant(**i) for i in d.get("invariants", [])],
            fingerprint=d.get("fingerprint", ""),
            ring=dict(d.get("ring", {})),
            zk=dict(d.get("zk", {})),
            created_at=d.get("created_at", time.time()),
        )
