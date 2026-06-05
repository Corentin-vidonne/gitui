import { useEffect, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  type Edge,
  type Node,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import * as dagre from "dagre";
import type { Branch, StackNode } from "../lib/types";
import { GraphNode, type GraphNodeData } from "./GraphNode";
import { useThemePalette } from "../lib/theme";

const NODE_W = 208;
const NODE_H = 60;
const nodeTypes: NodeTypes = { branch: GraphNode };

export function StackGraph({
  roots,
  untracked,
  selected,
  onSelect,
  onReparent,
}: {
  roots: StackNode[];
  untracked: Branch[];
  selected: string | null;
  onSelect: (name: string) => void;
  /** Drag a branch onto another → set its parent. */
  onReparent: (branch: string, newParent: string) => void;
}) {
  const palette = useThemePalette();
  const layout = useMemo(() => {
    const data: GraphNodeData[] = [];
    const links: { source: string; target: string }[] = [];
    const walk = (n: StackNode) => {
      data.push({ branch: n.branch, selected: n.branch.name === selected });
      n.children.forEach((c) => {
        links.push({ source: n.branch.name, target: c.branch.name });
        walk(c);
      });
    };
    roots.forEach(walk);
    // Untracked branches: standalone nodes (no parent edge) so they're all visible.
    untracked.forEach((b) => data.push({ branch: b, selected: b.name === selected }));

    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: "TB", nodesep: 28, ranksep: 48 });
    g.setDefaultEdgeLabel(() => ({}));
    data.forEach((d) => g.setNode(d.branch.name, { width: NODE_W, height: NODE_H }));
    links.forEach((l) => g.setEdge(l.source, l.target));
    dagre.layout(g);

    const nodes: Node[] = data.map((d) => {
      const p = g.node(d.branch.name);
      return {
        id: d.branch.name,
        type: "branch",
        position: { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 },
        data: d as unknown as Record<string, unknown>,
      };
    });
    const edges: Edge[] = links.map((l) => ({
      id: `${l.source}->${l.target}`,
      source: l.source,
      target: l.target,
      type: "smoothstep",
      style: { stroke: palette.graphEdge },
    }));
    return { nodes, edges };
  }, [roots, untracked, selected, palette]);

  // Stateful copy so nodes can be dragged; re-synced whenever the layout changes.
  const [nodes, setNodes, onNodesChange] = useNodesState(layout.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layout.edges);
  useEffect(() => {
    setNodes(layout.nodes);
    setEdges(layout.edges);
  }, [layout, setNodes, setEdges]);

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        onNodeClick={(_, n) => onSelect(n.id)}
        onNodeDragStop={(_, node) => {
          // Drop the node onto another → re-parent it; otherwise snap back.
          const cx = node.position.x + NODE_W / 2;
          const cy = node.position.y + NODE_H / 2;
          const target = nodes.find(
            (n) =>
              n.id !== node.id &&
              cx >= n.position.x &&
              cx <= n.position.x + NODE_W &&
              cy >= n.position.y &&
              cy <= n.position.y + NODE_H
          );
          const dragged = (node.data as unknown as GraphNodeData).branch;
          if (target && !dragged.isTrunk && target.id !== dragged.parent) {
            onReparent(node.id, target.id);
          } else {
            setNodes(layout.nodes); // snap back
          }
        }}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        nodesDraggable
        nodesConnectable={false}
        minZoom={0.2}
      >
        <Background color={palette.graphBg} gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
