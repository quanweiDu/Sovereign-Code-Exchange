// Layer 1 primitives: cryptographic schema for Code-as-Asset NFTs.
// Zero-dependency (node:crypto + BigInt) finite-field Z_q ring commitments.
import { createHash } from "node:crypto";

/** Ed25519 field prime — a 255-bit prime, used as the modulus of the ring Z_q. */
export const FIELD_PRIME_Q: bigint = (1n << 255n) - 19n;
/** Generator of the prime-order subgroup used for commitments. */
export const GENERATOR_G: bigint = 2n;
/** Domain separator for the asset registry. */
export const RING_DOMAIN = "sovereign-code-exchange/asset-registry/v1";

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Modular exponentiation over Z_q using BigInt (square-and-multiply). */
export function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  if (mod === 1n) return 0n;
  let result = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

/** Hash an arbitrary string into the field Z_q. */
export function hashToField(input: string, q: bigint = FIELD_PRIME_Q): bigint {
  return BigInt("0x" + sha256Hex(input)) % q;
}

export interface RingCommitment {
  q: string;
  g: string;
  a: string;
  commitment: string;
  domain: string;
}

/**
 * Pedersen-style commitment over the ring Z_q:
 *   a = H(domain || sha256(code)) mod q        (deterministic secret)
 *   C = g^a mod q                               (public commitment)
 * Verification recomputes C from the code alone, giving a state-invariant
 * assertion that the registered bytecode is exactly the committed bytecode.
 */
export function ringCommit(code: string, domain: string = RING_DOMAIN): RingCommitment {
  const codeHash = sha256Hex(code);
  const a = hashToField(`${domain}:${codeHash}`);
  const commitment = modPow(GENERATOR_G, a, FIELD_PRIME_Q);
  return {
    q: "0x" + FIELD_PRIME_Q.toString(16),
    g: "0x" + GENERATOR_G.toString(16),
    a: "0x" + a.toString(16),
    commitment: "0x" + commitment.toString(16),
    domain,
  };
}

export interface RingVerification {
  hashOk: boolean;
  commitmentOk: boolean;
  recomputedHash: string;
  recomputedCommitment: string;
  valid: boolean;
}

/** Explicit state-invariant assertion: recompute and compare. */
export function verifyRing(
  code: string,
  expectedHash: string,
  ring: { commitment: string },
): RingVerification {
  const recomputedHash = sha256Hex(code);
  const recomputed = ringCommit(code);
  const hashOk = recomputedHash === expectedHash;
  const commitmentOk = recomputed.commitment === ring.commitment;
  return {
    hashOk,
    commitmentOk,
    recomputedHash,
    recomputedCommitment: recomputed.commitment,
    valid: hashOk && commitmentOk,
  };
}

/** Deterministic JSON stringify (sorted keys) so hashes are stable. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortValue((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Shannon entropy in bits per character — the kernel's entropy invariant. */
export function shannonEntropyBitsPerChar(s: string): number {
  if (s.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / s.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}
