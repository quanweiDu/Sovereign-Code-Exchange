"""SCSEP v3.0 Layer III — Asynchronous meta-kernel runtime.

An asyncio event bus governs multi-domain SSU pipeline execution. Every SSU call
runs in a FORKED CHILD PROCESS (hard isolation):

  * runtime permission boundary: restricted builtins + import whitelist
    (no os/socket/subprocess/...), enforced before module code runs;
  * hard memory limit via RLIMIT_AS set in the child (MemoryError on breach);
  * hard deadline via join(timeout) + terminate()/kill() — a runaway task is
    killed, never blocks the kernel;
  * output invariants on the main side: serializability, max bytes, Shannon
    entropy, and the SSU's own pre/post-condition assertions.

AUTOMATED FAULT QUARANTINE (Entropy Safety Guard): any SSU exhibiting illegal
state mutations, unhandled exceptions, memory breach, deadline overrun or
entropy runaway is instantly isolated in real time — recorded in the quarantine
registry, all later calls skipped — without systemic kernel collapse.

Zero-dependency: Python standard library only (asyncio, multiprocessing, ...).
"""
from __future__ import annotations

import asyncio
import builtins
import importlib
import inspect
import json
import math
import multiprocessing
import os
import resource
import time
from dataclasses import dataclass
from typing import Any, Callable

from .ssu_manifest import SSUManifest, evaluate_invariants, sha256_hex

# ---------------------------------------------------------------------------
# Permission-boundary sandbox: safe builtins + module whitelist
# ---------------------------------------------------------------------------
SAFE_MODULES = {"json", "math", "hashlib", "base64", "re", "string", "datetime", "collections", "itertools", "functools", "statistics"}

_SAFE_BUILTIN_NAMES = (
    "abs", "all", "any", "bool", "bytes", "chr", "dict", "divmod", "enumerate",
    "filter", "float", "format", "frozenset", "hash", "hex", "int", "isinstance",
    "len", "list", "map", "max", "min", "oct", "ord", "pow", "range", "repr",
    "round", "set", "sorted", "str", "sum", "tuple", "type", "zip", "print",
    "Exception", "ValueError", "TypeError", "KeyError", "IndexError",
    "RuntimeError", "StopIteration", "ArithmeticError", "ZeroDivisionError",
    "True", "False", "None",
)

SAFE_BUILTINS = {name: getattr(builtins, name) for name in _SAFE_BUILTIN_NAMES if hasattr(builtins, name)}


def _safe_import(name: str, *args: Any, **kwargs: Any):
    """Permission boundary: only whitelisted stdlib modules may be imported."""
    root = name.split(".")[0]
    if root in SAFE_MODULES:
        return importlib.import_module(name)
    raise PermissionError(f"import of {name!r} is denied by the SSU permission boundary")


SAFE_BUILTINS["__import__"] = _safe_import  # imports resolve through the boundary


def make_sandbox_namespace(input_data: Any, ctx: dict) -> dict:
    ns: dict[str, Any] = {
        "__builtins__": dict(SAFE_BUILTINS),
        "input": input_data,
        "ctx": ctx,
        "json": importlib.import_module("json"),
        "math": importlib.import_module("math"),
        "hashlib": importlib.import_module("hashlib"),
        "base64": importlib.import_module("base64"),
    }
    return ns


def _child_main(conn, source: str, entrypoint: str, input_data: Any, ctx: dict, memory_mb: int) -> None:
    """Runs inside the forked child: hard memory cap, then sandboxed module exec."""
    try:
        cap = max(16, memory_mb) * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (cap, cap))
    except Exception:
        pass
    try:
        ns = make_sandbox_namespace(input_data, ctx)
        code = compile(source, "<ssu-sandbox>", "exec")
        exec(code, ns)  # noqa: S102 — this IS the sandbox boundary
        fn = ns.get(entrypoint)
        if not callable(fn):
            raise RuntimeError(f"SSU must define a callable {entrypoint}(input, ctx)")
        output = fn(input_data, ctx)
        peak_kb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        conn.send({"ok": True, "output": output, "peak_kb": peak_kb})
    except MemoryError:
        conn.send({"ok": False, "error": "MemoryError: heap limit (RLIMIT_AS) exceeded", "kind": "memory"})
    except PermissionError as exc:
        conn.send({"ok": False, "error": f"permission boundary violated: {exc}", "kind": "permission"})
    except BaseException as exc:  # noqa: BLE001 — child must report everything
        conn.send({"ok": False, "error": f"{type(exc).__name__}: {exc}", "kind": "runtime"})
    finally:
        try:
            conn.close()
        except Exception:
            pass


def shannon_entropy_bits_per_char(s: str) -> float:
    if not s:
        return 0.0
    counts: dict[str, int] = {}
    for ch in s:
        counts[ch] = counts.get(ch, 0) + 1
    entropy = 0.0
    n = len(s)
    for c in counts.values():
        p = c / n
        entropy -= p * math.log2(p)
    return entropy


# ---------------------------------------------------------------------------
# Event bus
# ---------------------------------------------------------------------------
class EventBus:
    """Minimal async pub/sub. Handlers may be sync or async; failures never break the bus."""

    def __init__(self) -> None:
        self._handlers: dict[str, list[Callable]] = {}
        self.stream: list[tuple[float, str, dict]] = []

    def on(self, event_type: str, handler: Callable) -> None:
        self._handlers.setdefault(event_type, []).append(handler)

    async def emit(self, event_type: str, payload: dict) -> None:
        self.stream.append((time.time(), event_type, payload))
        handlers = self._handlers.get(event_type, []) + self._handlers.get("*", [])
        awaitables = []
        for h in handlers:
            try:
                result = h(payload)
            except Exception:
                continue  # a failing subscriber never breaks the bus
            if inspect.isawaitable(result):
                awaitables.append(result)
        if awaitables:
            await asyncio.gather(*awaitables, return_exceptions=True)


# ---------------------------------------------------------------------------
# Execution results
# ---------------------------------------------------------------------------
@dataclass
class ExecutionResult:
    ssu_id: str
    ok: bool
    output: Any = None
    error: str | None = None
    violation: str | None = None  # None | timeout | memory | entropy | invariant | runtime | skipped
    duration_ms: float = 0.0
    memory_peak_bytes: int = 0
    entropy: float | None = None
    output_bytes: int = 0
    output_fingerprint: str | None = None
    cycle: int = 0

    def to_dict(self) -> dict:
        return {
            "ssu_id": self.ssu_id,
            "ok": self.ok,
            "violation": self.violation,
            "error": self.error,
            "duration_ms": round(self.duration_ms, 2),
            "memory_peak_bytes": self.memory_peak_bytes,
            "entropy": round(self.entropy, 4) if self.entropy is not None else None,
            "output_bytes": self.output_bytes,
            "output_fingerprint": self.output_fingerprint,
            "cycle": self.cycle,
        }


# ---------------------------------------------------------------------------
# Meta kernel
# ---------------------------------------------------------------------------
class MetaKernel:
    """Governs multi-domain SSU execution with automated fault quarantine."""

    def __init__(self, max_concurrency: int = 8) -> None:
        self.bus = EventBus()
        self.semaphore = asyncio.Semaphore(max_concurrency)
        self.mp = multiprocessing.get_context("fork")
        self.quarantine: dict[str, str] = {}  # ssu_id -> reason

    # -- quarantine ----------------------------------------------------------
    def is_quarantined(self, ssu_id: str) -> bool:
        return ssu_id in self.quarantine

    def quarantine_reason(self, ssu_id: str) -> str | None:
        return self.quarantine.get(ssu_id)

    async def _quarantine(self, ssu_id: str, reason: str, cycle: int = 0) -> None:
        self.quarantine[ssu_id] = reason
        await self.bus.emit("ssu.quarantined", {
            "ssu_id": ssu_id, "reason": reason, "cycle": cycle,
            "note": "SSU isolated in real time (quarantine sandbox); kernel continues without collapse",
        })

    # -- single execution ------------------------------------------------------
    async def execute(self, manifest: SSUManifest, input_data: Any, ctx: dict | None = None) -> ExecutionResult:
        ctx = dict(ctx or {})
        cycle = int(ctx.get("cycle", 0))
        rid = manifest.ssu_id

        # 0. already quarantined → skip instantly, pipeline unaffected
        if self.is_quarantined(manifest.ssu_id):
            await self.bus.emit("ssu.skipped", {"ssu_id": manifest.ssu_id, "cycle": cycle, "reason": self.quarantine[manifest.ssu_id]})
            return ExecutionResult(ssu_id=rid, ok=False, violation="skipped", error=self.quarantine[manifest.ssu_id], cycle=cycle)

        # 1. pre-condition invariant assertions on the input
        pre_violations = evaluate_invariants(manifest.invariants, "pre", input_data)
        if pre_violations:
            reason = "; ".join(pre_violations)
            await self._quarantine(manifest.ssu_id, f"invariant: {reason}", cycle)
            return ExecutionResult(ssu_id=rid, ok=False, violation="invariant", error=reason, cycle=cycle)

        p = manifest.permissions
        timeout_s = p.timeout_ms / 1000.0
        started = time.perf_counter()

        # 2. run in a forked, memory-capped, deadline-bounded child process
        async with self.semaphore:
            loop = asyncio.get_running_loop()
            parent_conn, child_conn = self.mp.Pipe(duplex=False)
            proc = self.mp.Process(
                target=_child_main,
                args=(child_conn, manifest.source, manifest.entrypoint, input_data, ctx, p.memory_mb),
                daemon=True,
            )
            try:
                await loop.run_in_executor(None, proc.start)
                await loop.run_in_executor(None, proc.join, timeout_s)
                if proc.is_alive():
                    # deadline overrun → kill the runaway task (quarantine sandbox)
                    proc.terminate()
                    await loop.run_in_executor(None, proc.join, 1.0)
                    if proc.is_alive():
                        proc.kill()
                        await loop.run_in_executor(None, proc.join, 1.0)
                    reason = f"timeout: exceeded deadline of {p.timeout_ms}ms; child process terminated"
                    await self._quarantine(manifest.ssu_id, reason, cycle)
                    return ExecutionResult(ssu_id=rid, ok=False, violation="timeout", error=reason, duration_ms=p.timeout_ms, cycle=cycle)
                # child finished — collect its message
                msg = None
                if parent_conn.poll(0.5):
                    try:
                        msg = parent_conn.recv()
                    except (EOFError, OSError):
                        msg = None
            finally:
                parent_conn.close()
                if proc.is_alive():
                    proc.kill()

        duration_ms = (time.perf_counter() - started) * 1000.0

        if msg is None:
            reason = f"runtime: child process exited without a result (exitcode={proc.exitcode})"
            await self._quarantine(manifest.ssu_id, reason, cycle)
            return ExecutionResult(ssu_id=rid, ok=False, violation="runtime", error=reason, duration_ms=duration_ms, cycle=cycle)

        if not msg.get("ok"):
            kind = msg.get("kind", "runtime")
            reason = str(msg.get("error", "unknown error"))
            violation = "memory" if kind == "memory" or "MemoryError" in reason or "allocate" in reason else (
                "invariant" if kind == "permission" else "runtime")
            await self._quarantine(manifest.ssu_id, f"{violation}: {reason}", cycle)
            return ExecutionResult(ssu_id=rid, ok=False, violation=violation, error=reason, duration_ms=duration_ms, cycle=cycle)

        output = msg.get("output")
        peak_bytes = int(msg.get("peak_kb", 0)) * 1024

        # 3. structural safety invariants on the output
        try:
            canonical = json.dumps(output, sort_keys=True, default=str)
        except Exception as exc:
            reason = f"output not serializable: {exc}"
            await self._quarantine(manifest.ssu_id, f"invariant: {reason}", cycle)
            return ExecutionResult(ssu_id=rid, ok=False, violation="invariant", error=reason, duration_ms=duration_ms, memory_peak_bytes=peak_bytes, cycle=cycle)

        output_bytes = len(canonical.encode("utf-8"))
        entropy = shannon_entropy_bits_per_char(canonical)
        fingerprint = sha256_hex(canonical)

        if peak_bytes > p.memory_mb * 1024 * 1024:
            reason = f"memory: peak {peak_bytes // 1024}KB exceeds cap {p.memory_mb}MB"
            await self._quarantine(manifest.ssu_id, reason, cycle)
            return ExecutionResult(ssu_id=rid, ok=False, violation="memory", error=reason, duration_ms=duration_ms, memory_peak_bytes=peak_bytes, entropy=entropy, output_bytes=output_bytes, cycle=cycle)
        if output_bytes > p.max_output_bytes:
            reason = f"output size {output_bytes}B exceeds max_output_bytes={p.max_output_bytes}"
            await self._quarantine(manifest.ssu_id, f"invariant: {reason}", cycle)
            return ExecutionResult(ssu_id=rid, ok=False, violation="invariant", error=reason, duration_ms=duration_ms, memory_peak_bytes=peak_bytes, entropy=entropy, output_bytes=output_bytes, cycle=cycle)
        if entropy > p.max_entropy_bits_per_char:
            reason = f"entropy runaway: {entropy:.2f} bits/char exceeds threshold {p.max_entropy_bits_per_char}"
            await self._quarantine(manifest.ssu_id, f"entropy: {reason}", cycle)
            return ExecutionResult(ssu_id=rid, ok=False, violation="entropy", error=reason, duration_ms=duration_ms, memory_peak_bytes=peak_bytes, entropy=entropy, output_bytes=output_bytes, cycle=cycle)

        # 4. post-condition invariant assertions on the output
        post_violations = evaluate_invariants(manifest.invariants, "post", output)
        if post_violations:
            reason = "; ".join(post_violations)
            await self._quarantine(manifest.ssu_id, f"invariant: {reason}", cycle)
            return ExecutionResult(ssu_id=rid, ok=False, violation="invariant", error=reason, duration_ms=duration_ms, memory_peak_bytes=peak_bytes, entropy=entropy, output_bytes=output_bytes, cycle=cycle)

        await self.bus.emit("ssu.executed", {
            "ssu_id": manifest.ssu_id, "cycle": cycle,
            "duration_ms": round(duration_ms, 2), "memory_peak_bytes": peak_bytes,
            "entropy": round(entropy, 4), "output_fingerprint": fingerprint,
        })
        return ExecutionResult(
            ssu_id=rid, ok=True, output=output, violation=None, error=None,
            duration_ms=duration_ms, memory_peak_bytes=peak_bytes, entropy=entropy,
            output_bytes=output_bytes, output_fingerprint=fingerprint, cycle=cycle,
        )

    # -- concurrent execution ---------------------------------------------------
    async def execute_many(self, jobs: list[tuple[SSUManifest, Any, dict]]) -> list[ExecutionResult]:
        return list(await asyncio.gather(*(self.execute(m, i, c) for m, i, c in jobs)))
