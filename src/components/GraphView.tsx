"use client";

import type { AssetGraph, GraphNode } from "@/lib/types";

/**
 * Layered SVG rendering of an intent dependency graph.
 * Nodes are laid out by pipeline stage (left → right), stacked vertically per stage.
 */
export default function GraphView({ graph }: { graph: AssetGraph }) {
  const nodes = graph.nodes;
  if (nodes.length === 0) {
    return <p className="rounded-xl border border-dashed border-slate-700 p-4 text-center text-sm text-slate-500">No capabilities detected.</p>;
  }
  const stageGroups = new Map<number, GraphNode[]>();
  for (const n of nodes) {
    const arr = stageGroups.get(n.stage) ?? [];
    arr.push(n);
    stageGroups.set(n.stage, arr);
  }
  const stages = [...stageGroups.keys()].sort((a, b) => a - b);
  const NODE_W = 190;
  const NODE_H = 58;
  const GAP_X = 70;
  const GAP_Y = 26;
  const pos = new Map<string, { x: number; y: number }>();
  stages.forEach((stage, si) => {
    const group = stageGroups.get(stage) ?? [];
    const totalH = group.length * NODE_H + (group.length - 1) * GAP_Y;
    group.forEach((n, gi) => {
      pos.set(n.id, { x: 20 + si * (NODE_W + GAP_X), y: 20 + gi * (NODE_H + GAP_Y) + (300 - totalH) / 2 });
    });
  });
  const width = 40 + stages.length * (NODE_W + GAP_X);
  const height = 320;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950 p-4">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="min-w-full">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#34d399" />
          </marker>
        </defs>
        {graph.edges.map((e, i) => {
          const a = pos.get(e.from);
          const b = pos.get(e.to);
          if (!a || !b) return null;
          const x1 = a.x + NODE_W;
          const y1 = a.y + NODE_H / 2;
          const x2 = b.x;
          const y2 = b.y + NODE_H / 2;
          const mx = (x1 + x2) / 2;
          return (
            <path
              key={i}
              d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
              fill="none"
              stroke="#34d399"
              strokeOpacity={0.55}
              strokeWidth={1.5}
              markerEnd="url(#arrow)"
            />
          );
        })}
        {nodes.map((n) => {
          const p = pos.get(n.id);
          if (!p) return null;
          const resolved = n.status === "resolved";
          return (
            <g key={n.id}>
              <rect
                x={p.x}
                y={p.y}
                width={NODE_W}
                height={NODE_H}
                rx={10}
                fill={resolved ? "rgba(16,185,129,0.08)" : "rgba(244,63,94,0.08)"}
                stroke={resolved ? "#10b981" : "#f43f5e"}
                strokeOpacity={0.6}
                strokeDasharray={resolved ? undefined : "4 3"}
              />
              <text x={p.x + 10} y={p.y + 18} fill={resolved ? "#6ee7b7" : "#fda4af"} fontSize={10} fontFamily="monospace">
                {n.capability.toUpperCase()}
              </text>
              <text x={p.x + 10} y={p.y + 34} fill="#e2e8f0" fontSize={11} fontWeight={600}>
                {n.assetName ? truncate(n.assetName, 24) : truncate(n.label, 24)}
              </text>
              <text x={p.x + 10} y={p.y + 49} fill="#64748b" fontSize={9} fontFamily="monospace">
                {resolved ? `stage ${n.stage} · ${n.assetSlug ?? ""}` : "NO MATCHING ASSET"}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="mt-2 font-mono text-[11px] text-slate-500">
        {byId.size} nodes · {graph.edges.length} edges · resolved {nodes.filter((n) => n.status === "resolved").length}/{nodes.length}
      </p>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
