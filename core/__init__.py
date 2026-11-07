"""SCSEP — Sovereign Code & Skill Exchange Protocol.

Zero-dependency reference core (Python standard library only):

- core.ssu_manifest     — Layer I: SSU schema (SHA-256 fingerprint, Z_q ring
                          verification contract, permission boundary,
                          pre/post-condition invariants, royalty routing)
- core.ssu_exchange     — Layer II: marketplace engine (registry, order book,
                          intent matching into SSU DAGs, micro-royalty ledger)
- core.meta_kernel      — Layer III: async runtime kernel + event bus with
                          automated fault quarantine
- core.ssu_settlement  — v3.0 dual-track settlement (fiat gateway + USDC/USDT rails)
- genesis_exchange_runner.py — Layer IV: integrated genesis test driver
"""

__all__ = ["ssu_manifest", "ssu_exchange", "meta_kernel", "ssu_settlement"]
__version__ = "3.0.0"
