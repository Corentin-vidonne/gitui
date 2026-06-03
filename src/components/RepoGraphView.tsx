import { useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import * as dagre from "dagre";
import { Boxes } from "lucide-react";
import { api, errorText } from "../lib/api";
import type { RepoGraph } from "../lib/types";
import type { RepoGroup } from "../lib/groups";
import { useThemePalette } from "../lib/theme";
import { Spinner } from "./Spinner";

const NODE_W = 192;
const NODE_H = 56;

/**
 * Distinct, dark-friendly hues used to tint each group's container box and its
 * member nodes. Assigned by group order (stable), wrapping when there are more
 * groups than colors.
 */
type GroupColor = { stroke: string; fill: string; text: string };
const GROUP_COLORS: GroupColor[] = [
  { stroke: "#6366f1", fill: "rgba(99,102,241,0.07)", text: "#a5b4fc" }, // indigo
  { stroke: "#14b8a6", fill: "rgba(20,184,166,0.07)", text: "#5eead4" }, // teal
  { stroke: "#f59e0b", fill: "rgba(245,158,11,0.07)", text: "#fcd34d" }, // amber
  { stroke: "#ec4899", fill: "rgba(236,72,153,0.07)", text: "#f9a8d4" }, // pink
  { stroke: "#22c55e", fill: "rgba(34,197,94,0.07)", text: "#86efac" }, // green
  { stroke: "#0ea5e9", fill: "rgba(14,165,233,0.07)", text: "#7dd3fc" }, // sky
  { stroke: "#a855f7", fill: "rgba(168,85,247,0.07)", text: "#d8b4fe" }, // purple
  { stroke: "#ef4444", fill: "rgba(239,68,68,0.07)", text: "#fca5a5" }, // red
];

function RepoNodeCard({ data }: NodeProps) {
  const d = data as unknown as {
    name: string;
    remote: string | null;
    accent: string | null;
  };
  return (
    <div className="w-48 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 hover:border-indigo-600">
      <Handle type="target" position={Position.Left} className="!h-1.5 !w-1.5 !border-0 !bg-neutral-700" />
      <div className="flex items-center gap-1.5">
        <Boxes
          className={`h-3.5 w-3.5 shrink-0 ${d.accent ? "" : "text-indigo-400"}`}
          style={d.accent ? { color: d.accent } : undefined}
        />
        <span className="truncate text-xs font-medium text-neutral-100">{d.name}</span>
      </div>
      {d.remote && (
        <div className="mt-0.5 truncate text-[10px] text-neutral-500">{d.remote}</div>
      )}
      <Handle type="source" position={Position.Right} className="!h-1.5 !w-1.5 !border-0 !bg-neutral-700" />
    </div>
  );
}

/**
 * A translucent container drawn behind a group's repo nodes, labelled with the
 * group name (fieldset-legend style). Non-interactive: pointer events pass
 * through so panning still works and the repo nodes on top stay clickable.
 */
function GroupNodeCard({ data }: NodeProps) {
  const d = data as unknown as GroupColor & { label: string };
  return (
    <div
      className="relative h-full w-full rounded-xl border"
      style={{ borderColor: d.stroke, backgroundColor: d.fill }}
    >
      <span
        className="absolute -top-2.5 left-4 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: d.text, backgroundColor: "var(--app-bg)" }}
      >
        {d.label}
      </span>
    </div>
  );
}

const nodeTypes: NodeTypes = { repo: RepoNodeCard, group: GroupNodeCard };

export function RepoGraphView({
  repos,
  groups,
  assignments,
  onOpenRepo,
}: {
  repos: string[];
  groups: RepoGroup[];
  /** repoPath -> groupId (from the shared group state). */
  assignments: Record<string, string>;
  onOpenRepo: (path: string) => void;
}) {
  const [graph, setGraph] = useState<RepoGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const palette = useThemePalette();

  useEffect(() => {
    let alive = true;
    setGraph(null);
    setError(null);
    api
      .repoGraph(repos)
      .then((g) => alive && setGraph(g))
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [repos]);

  // Stable groupId -> color, keyed by group order so a group keeps its hue.
  const groupColor = useMemo(() => {
    const m = new Map<string, GroupColor>();
    [...groups]
      .sort((a, b) => a.order - b.order)
      .forEach((g, i) => m.set(g.id, GROUP_COLORS[i % GROUP_COLORS.length]));
    return m;
  }, [groups]);

  const { nodes, edges } = useMemo(() => {
    if (!graph) return { nodes: [] as Node[], edges: [] as Edge[] };

    // Groups that actually have members among the displayed repos.
    const present = new Map<string, string[]>(); // groupId -> repo node ids
    for (const n of graph.nodes) {
      const gid = assignments[n.id];
      if (gid && groupColor.has(gid)) {
        const arr = present.get(gid) ?? [];
        arr.push(n.id);
        present.set(gid, arr);
      }
    }

    // Compound layout: parenting member nodes to a cluster keeps each group's
    // repos contiguous, so the container boxes don't overlap.
    const g = new dagre.graphlib.Graph({ compound: true });
    g.setGraph({ rankdir: "LR", nodesep: 30, ranksep: 90 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const gid of present.keys()) g.setNode(`cluster:${gid}`, {});
    graph.nodes.forEach((n) => {
      g.setNode(n.id, { width: NODE_W, height: NODE_H });
      const gid = assignments[n.id];
      if (gid && present.has(gid)) g.setParent(n.id, `cluster:${gid}`);
    });
    graph.edges.forEach((e) => g.setEdge(e.from, e.to));
    dagre.layout(g);

    const repoNodes: Node[] = graph.nodes.map((n) => {
      const p = g.node(n.id);
      const color = groupColor.get(assignments[n.id]) ?? null;
      return {
        id: n.id,
        type: "repo",
        position: { x: (p?.x ?? 0) - NODE_W / 2, y: (p?.y ?? 0) - NODE_H / 2 },
        data: {
          name: n.name,
          remote: n.remoteUrl,
          accent: color?.text ?? null,
        } as unknown as Record<string, unknown>,
      };
    });

    // Container boxes computed from member node positions (predictable, with
    // padding + top room for the label) rather than dagre's own cluster bbox.
    const PAD = 26;
    const TOP = 30;
    const posById = new Map(repoNodes.map((rn) => [rn.id, rn.position]));
    const groupNodes: Node[] = [];
    for (const [gid, ids] of present) {
      const color = groupColor.get(gid);
      const group = groups.find((gr) => gr.id === gid);
      if (!color || !group) continue;
      const xs = ids.map((id) => posById.get(id)!.x);
      const ys = ids.map((id) => posById.get(id)!.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs) + NODE_W;
      const maxY = Math.max(...ys) + NODE_H;
      groupNodes.push({
        id: `cluster:${gid}`,
        type: "group",
        position: { x: minX - PAD, y: minY - TOP },
        selectable: false,
        draggable: false,
        connectable: false,
        style: {
          width: maxX - minX + PAD * 2,
          height: maxY - minY + TOP + PAD,
          pointerEvents: "none",
        },
        data: { ...color, label: group.name } as unknown as Record<string, unknown>,
      });
    }

    const edges: Edge[] = graph.edges.map((e, i) => ({
      id: `${e.from}->${e.to}-${i}`,
      source: e.from,
      target: e.to,
      label: e.via,
      type: "smoothstep",
      animated: true,
      style: { stroke: palette.graphEdgeAccent },
      labelStyle: { fill: palette.graphLabel, fontSize: 10 },
      labelBgStyle: { fill: palette.graphLabelBg },
    }));

    // Group boxes first so they paint behind the repo nodes.
    return { nodes: [...groupNodes, ...repoNodes], edges };
  }, [graph, palette, assignments, groupColor, groups]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-red-400">{error}</div>
    );
  }
  if (!graph) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-neutral-600">
        <Spinner className="h-6 w-6" />
        Analyzing repositories…
      </div>
    );
  }
  if (graph.nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-neutral-600">
        Add repositories to see the links between them.
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, n) => {
          if (n.type === "repo") onOpenRepo(n.id);
        }}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        nodesDraggable={false}
        nodesConnectable={false}
        minZoom={0.1}
      >
        <Background color={palette.graphBg} gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
