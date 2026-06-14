import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { CommitNode } from "../lib/types";

export type CommitNodeData = { node: CommitNode; selected: boolean; dimmed?: boolean };

export function CommitNodeCard({ data }: NodeProps) {
  const { node, selected, dimmed } = data as unknown as CommitNodeData;
  return (
    <div
      className={`w-56 rounded-md border px-2.5 py-1.5 transition-opacity ${
        dimmed ? "opacity-20" : ""
      } ${
        selected
          ? "border-indigo-500 bg-indigo-950/60 ring-2 ring-indigo-500/40"
          : "border-neutral-700 bg-neutral-900 hover:border-neutral-600"
      }`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!h-1.5 !w-1.5 !border-0 !bg-neutral-700"
      />
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 font-mono text-[11px] text-amber-300/90">{node.shortSha}</span>
        <span className="min-w-0 truncate text-xs text-neutral-200">{node.subject}</span>
      </div>
      {node.refs.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {node.refs.map((r) => (
            <span
              key={r}
              className="rounded-full bg-indigo-900/60 px-1.5 text-[9px] text-indigo-200"
            >
              {r}
            </span>
          ))}
        </div>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-1.5 !w-1.5 !border-0 !bg-neutral-700"
      />
    </div>
  );
}
