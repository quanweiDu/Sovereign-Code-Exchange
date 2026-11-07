// Layer 2 — Sovereign Asynchronous Tensor & Event Bus kernel.
//
// Every Code-Asset module is executed inside an isolated worker thread with
// hard resource limits (heap via resourceLimits, wall-clock via timeout).
// The main thread then asserts the structural safety invariants of the output
// (size, Shannon entropy, required output keys). Any violation triggers
// AUTOMATIC DOMAIN QUARANTINE: the module's outcome is classified, the caller
// isolates it, and the broader pipeline keeps running.
import { Worker } from "node:worker_threads";
import {
  sha256Hex,
  shannonEntropyBitsPerChar,
  stableStringify,
} from "@/lib/ring";
import type { ModuleLimits, PostCondition, ViolationKind } from "@/lib/types";

export const DEFAULT_LIMITS: ModuleLimits = {
  timeoutMs: 1500,
  memoryMb: 64,
  maxOutputBytes: 256 * 1024,
  maxEntropyBitsPerChar: 5.5,
};

// The sandbox bootstrap runs inside the worker. Module code is compiled with
// `new Function` and receives ONLY (module, exports, input, ctx) — `require`
// and `process` are shadowed and unavailable inside module code.
const WORKER_BOOTSTRAP = [
  "const { parentPort, workerData } = require('node:worker_threads');",
  "(async () => {",
  "  const startedAt = Date.now();",
  "  try {",
  "    const mod = { exports: {} };",
  "    const factory = new Function('module','exports','require','process','input','ctx',",
  "      workerData.code + '\\n;return (module.exports && module.exports.execute) ? module.exports.execute : module.exports;');",
  "    const execute = factory(mod, mod.exports, function () { throw new Error('require() is disabled inside the Sovereign sandbox'); }, undefined, workerData.input, workerData.ctx);",
  "    if (typeof execute !== 'function') { throw new Error('Module must export execute(input, ctx)'); }",
  "    const output = await execute(workerData.input, workerData.ctx);",
  "    parentPort.postMessage({ ok: true, output: output === undefined ? null : output,",
  "      heapUsedBytes: process.memoryUsage().heapUsed, durationMs: Date.now() - startedAt });",
  "  } catch (err) {",
  "    parentPort.postMessage({ ok: false, error: String((err && err.message) || err), durationMs: Date.now() - startedAt });",
  "  }",
  "})();",
].join("\n");

export interface StepOutcome {
  ok: boolean;
  output: unknown;
  error: string | null;
  violation: ViolationKind;
  durationMs: number;
  heapMb: number | null;
  outputHash: string | null;
  outputBytes: number;
  entropy: number | null;
}

function classifyRuntimeError(message: string): ViolationKind {
  return /heap|out of memory|array buffer|allocation failed/i.test(message) ? "memory" : "runtime";
}

export interface RunModuleArgs {
  code: string;
  input: unknown;
  ctx: Record<string, unknown>;
  limits?: Partial<ModuleLimits>;
  requiredOutputKeys?: string[];
  requiredInputKeys?: string[];
  postconditions?: PostCondition[];
}

/**
 * Execute one module once inside a quarantined worker domain.
 * Resolves with a fully classified StepOutcome — never throws.
 */
export function runAssetModule(args: RunModuleArgs): Promise<StepOutcome> {
  const limits: ModuleLimits = { ...DEFAULT_LIMITS, ...(args.limits ?? {}) };
  return new Promise<StepOutcome>((resolve) => {
    let settled = false;
    let timedOut = false;
    let worker: Worker;
    try {
      worker = new Worker(WORKER_BOOTSTRAP, {
        eval: true,
        workerData: { code: args.code, input: args.input ?? null, ctx: args.ctx },
        resourceLimits: {
          maxOldGenerationSizeMb: Math.max(8, limits.memoryMb),
          maxYoungGenerationSizeMb: Math.max(1, Math.min(16, Math.floor(limits.memoryMb / 4))),
        },
      });
    } catch (err) {
      const message = String((err as Error)?.message ?? err);
      resolve({
        ok: false,
        output: null,
        error: message,
        violation: classifyRuntimeError(message),
        durationMs: 0,
        heapMb: null,
        outputHash: null,
        outputBytes: 0,
        entropy: null,
      });
      return;
    }

    const hardCapMs = Math.min(limits.timeoutMs + 2000, 8000);
    const timer = setTimeout(() => {
      timedOut = true;
      void worker.terminate();
    }, hardCapMs);

    const finish = (outcome: StepOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(outcome);
    };

    worker.on("message", (msg: { ok: boolean; output?: unknown; error?: string; heapUsedBytes?: number; durationMs?: number }) => {
      if (msg.ok) {
        // Structural safety invariants asserted on the main thread.
        const serialized = stableStringify(msg.output);
        const outputBytes = Buffer.byteLength(serialized, "utf8");
        const entropy = shannonEntropyBitsPerChar(serialized);
        const outputHash = sha256Hex(serialized);
        if (outputBytes > limits.maxOutputBytes) {
          finish({
            ok: false, output: null, violation: "invariant",
            error: `output size ${outputBytes}B exceeds maxOutputBytes=${limits.maxOutputBytes}`,
            durationMs: msg.durationMs ?? 0, heapMb: (msg.heapUsedBytes ?? 0) / 1048576,
            outputHash: null, outputBytes, entropy,
          });
          return;
        }
        if (entropy > limits.maxEntropyBitsPerChar) {
          finish({
            ok: false, output: null, violation: "invariant",
            error: `output entropy ${entropy.toFixed(2)} bits/char exceeds threshold ${limits.maxEntropyBitsPerChar} (possible corruption / unbounded randomness)`,
            durationMs: msg.durationMs ?? 0, heapMb: (msg.heapUsedBytes ?? 0) / 1048576,
            outputHash: null, outputBytes, entropy,
          });
          return;
        }
        const required = args.requiredOutputKeys ?? [];
        if (required.length > 0) {
          const outObj = (msg.output ?? null) as Record<string, unknown> | null;
          const missing = required.filter((k) => !outObj || typeof outObj !== "object" || !(k in outObj));
          if (missing.length > 0) {
            finish({
              ok: false, output: null, violation: "invariant",
              error: `output missing required manifest keys: ${missing.join(", ")}`,
              durationMs: msg.durationMs ?? 0, heapMb: (msg.heapUsedBytes ?? 0) / 1048576,
              outputHash: null, outputBytes, entropy,
            });
            return;
          }
        }
        finish({
          ok: true, output: msg.output ?? null, violation: null, error: null,
          durationMs: msg.durationMs ?? 0, heapMb: (msg.heapUsedBytes ?? 0) / 1048576,
          outputHash, outputBytes, entropy,
        });
        return;
      }
      const err = String(msg.error ?? "unknown module error");
      finish({
        ok: false, output: null, error: err, violation: classifyRuntimeError(err),
        durationMs: msg.durationMs ?? 0, heapMb: null, outputHash: null, outputBytes: 0, entropy: null,
      });
    });

    worker.on("error", (err: Error) => {
      const message = String(err?.message ?? err);
      const violation: ViolationKind = timedOut ? "timeout" : classifyRuntimeError(message);
      finish({
        ok: false, output: null, violation,
        error: timedOut ? `module exceeded timeout of ${limits.timeoutMs}ms and was terminated by the kernel` : message,
        durationMs: limits.timeoutMs, heapMb: null, outputHash: null, outputBytes: 0, entropy: null,
      });
    });

    worker.on("exit", (code: number) => {
      if (settled) return;
      finish({
        ok: false, output: null,
        violation: timedOut ? "timeout" : "runtime",
        error: timedOut
          ? `module exceeded timeout of ${limits.timeoutMs}ms and was terminated by the kernel`
          : `worker exited unexpectedly with code ${code}`,
        durationMs: limits.timeoutMs, heapMb: null, outputHash: null, outputBytes: 0, entropy: null,
      });
    });
  });
}
