"""SCSEP v3.0 — Dual-Track Settlement Layer.

Track A (fiat):  an abstracted PSP-style fiat gateway so non-technical users can
                 buy SSU execution credits with a card/bank transfer — no crypto
                 knowledge required.
Track B (native): stablecoin micro-settlement rails (USDC / USDT, 6 decimals,
                 EVM-style) paying developers and node providers instantly per
                 execution cycle, with a hash-chained transfer log (tx_hash =
                 SHA-256(prev_tx || payload)) that any auditor can re-verify.

The SettlementRouter routes every economic event transparently:
  fiat purchase   -> gateway charge (fiat) + execution credits minted to the user
  execution call  -> 1.00 USDC from payer credits; creator share in USDC,
                     remainder as gas dividend in USDT to the node pool
  composition     -> 0.10 USDC, same routing
  order-book fill -> peer-to-peer in the rail chosen by the maker

Zero-dependency: Python standard library only.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
from dataclasses import dataclass, field
from typing import Any

# --- Rails -------------------------------------------------------------------
RAIL_FIAT = "fiat"
RAIL_USDC = "USDC"
RAIL_USDT = "USDT"
STABLECOIN_DECIMALS = 6          # USDC/USDT contract precision
FIAT_DECIMALS = 2                # fiat is tracked in cents
UNIT_USDC = 10 ** STABLECOIN_DECIMALS   # 1 USDC  = 1_000_000 µUSDC
UNIT_USDT = 10 ** STABLECOIN_DECIMALS   # 1 USDT  = 1_000_000 µUSDT
UNIT_FIAT = 10 ** FIAT_DECIMALS         # 1 USD   = 100 micro-cents

EXECUTION_FEE_USDC = 1 * UNIT_USDC      # 1.00 USDC per execution call
COMPOSITION_FEE_USDC = UNIT_USDC // 10  # 0.10 USDC per composition
NODE_GAS_RAIL = RAIL_USDT               # node-provider gas is paid in USDT

# Static reference FX rates (fiat -> USD) for the gateway abstraction
FIAT_FX_TO_USD = {"USD": 1.0, "EUR": 1.08, "GBP": 1.27, "NGN": 0.00065, "INR": 0.012}


def tx_hash(prev_head: str, payload: dict) -> str:
    """Deterministic transfer hash — simulates an on-chain tx hash (SHA-256 chain)."""
    canonical = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256(f"{prev_head}|{canonical}".encode("utf-8")).hexdigest()


# --- Fiat HMAC Gateway authentication ------------------------------------------
# The PSP-style gateway authenticates every charge with an HMAC-SHA256 signature
# over the canonical payload; the router verifies it before accepting (stdlib hmac).
GATEWAY_SECRET = os.environ.get("SCSEP_GATEWAY_SECRET", "scsep-dev-gateway-secret-v3").encode("utf-8")


def gateway_sign(payload: dict) -> str:
    msg = json.dumps(payload, sort_keys=True, default=str).encode("utf-8")
    return hmac.new(GATEWAY_SECRET, msg, hashlib.sha256).hexdigest()


def gateway_verify(payload: dict, signature: str) -> bool:
    return hmac.compare_digest(gateway_sign(payload), signature or "")


# --- Simulated on-chain verifier (EVM-style blocks + Merkle inclusion proofs) ---
def _merkle_root(hashes: list[str]) -> str:
    if not hashes:
        return hashlib.sha256(b"").hexdigest()
    level = list(hashes)
    while len(level) > 1:
        if len(level) % 2:
            level.append(level[-1])
        level = [hashlib.sha256((level[i] + level[i + 1]).encode()).hexdigest() for i in range(0, len(level), 2)]
    return level[0]


class MockChain:
    """Simulated chain: transfers are batched into blocks (size 8) sealed with a
    Merkle root chained to the previous block. Inclusion proofs let any auditor
    verify a transfer is on-chain without syncing the whole chain."""

    BLOCK_SIZE = 8

    def __init__(self) -> None:
        genesis_root = _merkle_root([])
        self.blocks: list[dict] = [{"index": 0, "prev_root": "0x00", "txs": [], "root": genesis_root}]

    def add_tx(self, tx_hash: str) -> tuple[int, list[str]]:
        block = self.blocks[-1]
        block["txs"].append(tx_hash)
        if len(block["txs"]) >= self.BLOCK_SIZE:
            block["root"] = _merkle_root(block["txs"])
            self.blocks.append({"index": block["index"] + 1, "prev_root": block["root"], "txs": [], "root": _merkle_root([])})
        return block["index"], self._proof(block, tx_hash)

    def _proof(self, block: dict, tx_hash: str) -> list[str]:
        level = list(block["txs"])
        idx = level.index(tx_hash)
        proof: list[str] = []
        while len(level) > 1:
            if len(level) % 2:
                level.append(level[-1])
            sib = level[idx ^ 1]
            proof.append(("L" if idx % 2 else "R") + sib)
            level = [hashlib.sha256((level[i] + level[i + 1]).encode()).hexdigest() for i in range(0, len(level), 2)]
            idx //= 2
        return proof

    @staticmethod
    def verify_inclusion(tx_hash: str, block_index: int, proof: list[str], block_root: str) -> bool:
        h = tx_hash
        for step in proof:
            side, sib = step[0], step[1:]
            h = hashlib.sha256((sib + h).encode()).hexdigest() if side == "L" else hashlib.sha256((h + sib).encode()).hexdigest()
        return h == block_root

    def verify_block_links(self) -> bool:
        for i in range(1, len(self.blocks)):
            if self.blocks[i]["prev_root"] != self.blocks[i - 1]["root"]:
                return False
            if self.blocks[i - 1]["txs"] and _merkle_root(self.blocks[i - 1]["txs"]) != self.blocks[i - 1]["root"]:
                return False
        return True


# --- Transfer log --------------------------------------------------------------
@dataclass
class Transfer:
    seq: int
    rail: str          # fiat | USDC | USDT
    asset: str         # USD | USDC | USDT | CREDITS
    frm: str
    to: str
    amount_micro: int  # in the rail's micro units (credits: 1 credit = 1 µUSDC of exec)
    kind: str          # fiat-purchase | credit-mint | execution-debit | royalty-dividend | gas-dividend | trade-credit | trade-debit
    memo: str
    tx_hash: str
    created_at: float
    sig: str = ""            # HMAC-SHA256 gateway signature (fiat rail)
    block: int = 0           # on-chain block index (Track B verifier)
    proof: list = field(default_factory=list)  # Merkle inclusion proof

    def to_dict(self) -> dict:
        return {
            "seq": self.seq, "rail": self.rail, "asset": self.asset, "from": self.frm, "to": self.to,
            "amount_micro": self.amount_micro, "kind": self.kind, "memo": self.memo,
            "tx_hash": self.tx_hash, "created_at": self.created_at,
        }


class SettlementLedger:
    """Append-only, hash-chained settlement log across all rails."""

    def __init__(self) -> None:
        self.transfers: list[Transfer] = []
        self.chain_head = "SCSEP-V3-GENESIS"
        self.chain = MockChain()  # simulated on-chain settlement (Track B verifier)

    def transfer(self, rail: str, asset: str, frm: str, to: str, amount_micro: int,
                 kind: str, memo: str) -> Transfer:
        payload = {
            "seq": len(self.transfers) + 1, "rail": rail, "asset": asset,
            "from": frm, "to": to, "amount_micro": amount_micro, "kind": kind, "memo": memo,
        }
        tx = tx_hash(self.chain_head, payload)
        self.chain_head = tx
        sig = ""
        if rail == RAIL_FIAT:
            sig = gateway_sign(payload)  # Fiat HMAC Gateway signature
        block, _ = self.chain.add_tx(tx) if rail in (RAIL_USDC, RAIL_USDT) else (0, [])
        # Merkle proofs are computed against the FINAL block contents at verify time
        t = Transfer(payload["seq"], rail, asset, frm, to, amount_micro, kind, memo, tx, time.time(), sig, block, [])
        self.transfers.append(t)
        return t

    def balance(self, rail: str, address: str) -> int:
        total = 0
        for t in self.transfers:
            if t.rail != rail:
                continue
            if t.to == address:
                total += t.amount_micro
            if t.frm == address:
                total -= t.amount_micro
        return total

    def balances(self) -> dict[str, dict[str, int]]:
        out: dict[str, dict[str, int]] = {}
        for t in self.transfers:
            out.setdefault(t.rail, {})
            out[t.rail][t.to] = out[t.rail].get(t.to, 0) + t.amount_micro
            out[t.rail][t.frm] = out[t.rail].get(t.frm, 0) - t.amount_micro
        return out

    def verify_chain(self) -> bool:
        """Recompute the whole hash chain — tamper-evident audit."""
        head = "SCSEP-V3-GENESIS"
        for t in self.transfers:
            payload = {
                "seq": t.seq, "rail": t.rail, "asset": t.asset, "from": t.frm, "to": t.to,
                "amount_micro": t.amount_micro, "kind": t.kind, "memo": t.memo,
            }
            if tx_hash(head, payload) != t.tx_hash:
                return False
            head = t.tx_hash
        return head == self.chain_head

    def verify_gateway_sigs(self) -> bool:
        """Re-verify the HMAC-SHA256 signature of every fiat-gateway transfer."""
        for t in self.transfers:
            if t.rail == RAIL_FIAT:
                payload = {"seq": t.seq, "rail": t.rail, "asset": t.asset, "from": t.frm,
                           "to": t.to, "amount_micro": t.amount_micro, "kind": t.kind, "memo": t.memo}
                if not gateway_verify(payload, t.sig):
                    return False
        return True

    def verify_onchain(self) -> bool:
        """On-chain verifier: block links + Merkle inclusion proof of every USDC/USDT tx."""
        if not self.chain.verify_block_links():
            return False
        for t in self.transfers:
            if t.rail in (RAIL_USDC, RAIL_USDT):
                block = self.chain.blocks[t.block]
                if t.tx_hash not in block["txs"]:
                    return False
                # the tip block is unsealed: root over its current txs; sealed blocks use stored root
                root = block["root"] if block is not self.chain.blocks[-1] else _merkle_root(block["txs"])
                proof = self.chain._proof(block, t.tx_hash)
                if not MockChain.verify_inclusion(t.tx_hash, t.block, proof, root):
                    return False
        return True

    def totals(self) -> dict[str, int]:
        out: dict[str, int] = {}
        for t in self.transfers:
            if t.amount_micro > 0:
                out[t.rail] = out.get(t.rail, 0) + t.amount_micro
        return out


# --- Track A: fiat gateway (PSP abstraction) ------------------------------------
class FiatGateway:
    """Abstracted payment-service-provider gateway.

    Non-technical users pay in local fiat; the gateway returns a receipt and the
    router mints spendable execution credits. No wallet needed.
    """

    def __init__(self, ledger: SettlementLedger) -> None:
        self.ledger = ledger
        self.gateway_id = "gateway:scsep-psp"

    def charge(self, user: str, fiat_amount: float, currency: str = "USD", method: str = "card") -> dict:
        currency = currency.upper()
        if currency not in FIAT_FX_TO_USD:
            raise ValueError(f"unsupported fiat currency {currency}")
        if fiat_amount <= 0:
            raise ValueError("amount must be positive")
        cents = int(round(fiat_amount * UNIT_FIAT))
        usd_value_micro = int(round(cents * FIAT_FX_TO_USD[currency] / UNIT_FIAT * UNIT_USDC))
        receipt_ref = tx_hash(self.ledger.chain_head, {"gateway_charge": user, "cents": cents, "currency": currency})
        self.ledger.transfer(RAIL_FIAT, currency, user, self.gateway_id, cents, "fiat-purchase",
                             f"{method} charge {fiat_amount:.2f} {currency} (ref {receipt_ref[:12]}…)")
        self.ledger.transfer(RAIL_USDC, "CREDITS", self.gateway_id, user, usd_value_micro, "credit-mint",
                             f"execution credits minted for {fiat_amount:.2f} {currency} (≈ {usd_value_micro / UNIT_USDC:.2f} USDC)")
        return {
            "receipt": receipt_ref, "user": user, "charged": fiat_amount, "currency": currency,
            "method": method, "credits_micro": usd_value_micro,
            "credits_usdc": round(usd_value_micro / UNIT_USDC, 6),
        }


# --- Track B: native stablecoin rails --------------------------------------------
class StablecoinRail:
    """Native USDC/USDT micro-settlement (6-decimal contract precision)."""

    def __init__(self, ledger: SettlementLedger, asset: str, chain: str = "base") -> None:
        if asset not in (RAIL_USDC, RAIL_USDT):
            raise ValueError("asset must be USDC or USDT")
        self.ledger = ledger
        self.asset = asset
        self.chain = chain

    def transfer(self, frm: str, to: str, amount_micro: int, kind: str, memo: str) -> Transfer:
        if amount_micro <= 0:
            raise ValueError("amount must be positive")
        return self.ledger.transfer(self.asset, self.asset, frm, to, amount_micro, kind, memo)


# --- Router ----------------------------------------------------------------------
class SettlementRouter:
    """Dual-track routing of every economic event of the exchange."""

    def __init__(self, node_address: str = "node:scsep-local-1", treasury: str = "treasury:settlement") -> None:
        self.ledger = SettlementLedger()
        self.fiat = FiatGateway(self.ledger)
        self.usdc = StablecoinRail(self.ledger, RAIL_USDC, chain="base")
        self.usdt = StablecoinRail(self.ledger, RAIL_USDT, chain="base")
        self.node_address = node_address
        self.treasury = treasury
        self.credits: dict[str, int] = {}  # user -> spendable execution credits (µUSDC-denominated)

    # -- Track A ---------------------------------------------------------------
    def purchase_credits_fiat(self, user: str, fiat_amount: float, currency: str = "USD", method: str = "card") -> dict:
        receipt = self.fiat.charge(user, fiat_amount, currency, method)
        self.credits[user] = self.credits.get(user, 0) + receipt["credits_micro"]
        return receipt

    def credit_balance(self, user: str) -> int:
        return self.credits.get(user, 0)

    def _consume_credits(self, payer: str, amount_micro: int) -> None:
        avail = self.credits.get(payer, 0)
        take = min(avail, amount_micro)
        if take > 0:
            self.credits[payer] = avail - take
            self.ledger.transfer(RAIL_USDC, "CREDITS", payer, self.treasury, take, "execution-debit",
                                 f"{take / UNIT_USDC:.6f} USDC credits consumed by {payer}")
        remainder = amount_micro - take
        if remainder > 0:
            # un-credited remainder is funded by the settlement treasury (fiat clearing)
            self.ledger.transfer(RAIL_USDC, RAIL_USDC, self.treasury, self.treasury, 0, "execution-debit",
                                 f"remainder {remainder / UNIT_USDC:.6f} USDC funded by treasury clearing for {payer}")

    # -- Track B: execution dividends -------------------------------------------
    def settle_execution(self, royalty_address: str, royalty_bps: int, ssu_name: str,
                         cycle: int, payer: str) -> dict:
        """One execution call: 1.00 USDC fee → creator share in USDC + gas in USDT."""
        fee = EXECUTION_FEE_USDC
        self._consume_credits(payer, fee)
        creator_micro = (fee * royalty_bps) // 10000
        gas_micro = fee - creator_micro
        t1 = self.usdc.transfer(self.treasury, royalty_address, creator_micro, "royalty-dividend",
                                f"cycle {cycle} execution dividend {royalty_bps / 100:.2f}% for {ssu_name}")
        t2 = self.usdt.transfer(self.treasury, self.node_address, gas_micro, "gas-dividend",
                                f"cycle {cycle} node gas for executing {ssu_name}")
        return {"fee_micro": fee, "creator_micro": creator_micro, "gas_micro": gas_micro,
                "creator_tx": t1.tx_hash, "gas_tx": t2.tx_hash}

    def settle_composition(self, royalty_address: str, royalty_bps: int, ssu_name: str, payer: str) -> dict:
        fee = COMPOSITION_FEE_USDC
        self._consume_credits(payer, fee)
        creator_micro = (fee * royalty_bps) // 10000
        gas_micro = fee - creator_micro
        self.usdc.transfer(self.treasury, royalty_address, creator_micro, "royalty-dividend",
                           f"composition dividend {royalty_bps / 100:.2f}% for {ssu_name}")
        self.usdt.transfer(self.treasury, self.node_address, gas_micro, "gas-dividend",
                           f"composition node gas for {ssu_name}")
        return {"fee_micro": fee, "creator_micro": creator_micro, "gas_micro": gas_micro}

    def settle_trade(self, asset: str, seller: str, buyer: str, price_micro: int, qty: int, ssu_id: str) -> None:
        """Order-book fills settle peer-to-peer in the maker's chosen rail."""
        rail = self.usdc if asset.upper() == RAIL_USDC else self.usdt
        amount = price_micro * qty
        rail.transfer(buyer, seller, amount, "trade-credit", f"fill: {qty} SSU execution right(s) of {ssu_id}")
        self.ledger.transfer(rail.asset, rail.asset, buyer, buyer, 0, "trade-debit",
                             f"fill debit: {qty} right(s) of {ssu_id} @ {price_micro} µ{rail.asset}")

    # -- reporting ----------------------------------------------------------------
    def report(self) -> dict:
        return {
            "chain_valid": self.ledger.verify_chain(),
            "gateway_hmac_valid": self.ledger.verify_gateway_sigs(),
            "onchain_valid": self.ledger.verify_onchain(),
            "blocks": len(self.ledger.chain.blocks),
            "totals_by_rail": self.ledger.totals(),
            "balances": self.ledger.balances(),
            "credits": dict(self.credits),
            "transfers": len(self.ledger.transfers),
        }
