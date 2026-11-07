// Formatting helpers shared by server and client components.

export const MICRO_PER_SOV = 1_000_000;

export function fmtSov(micro: number | string | null | undefined): string {
  const m = Number(micro ?? 0);
  const sov = m / MICRO_PER_SOV;
  return sov.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

export function fmtMicro(micro: number | string | null | undefined): string {
  return Number(micro ?? 0).toLocaleString("en-US");
}

export function shortHash(hash: string | null | undefined, len = 10): string {
  if (!hash) return "—";
  return hash.length <= len ? hash : `${hash.slice(0, len)}…${hash.slice(-6)}`;
}

export function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  return `${Math.round(ms)} ms`;
}

export function fmtDate(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function bpsToPct(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}
