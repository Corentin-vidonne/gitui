import { useEffect, useRef, useState } from "react";
import { Boxes, Check } from "lucide-react";
import { UNGROUPED, type RepoGroup } from "../lib/groups";

/**
 * Group filter for the Workspace graph. `value === null` means "all groups";
 * `UNGROUPED` means the ungrouped repos; otherwise an explicit group id.
 * Mirrors the CommitFilter popover.
 */
export function WorkspaceGroupFilter({
  groups,
  value,
  onChange,
}: {
  groups: RepoGroup[];
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const label =
    value === null
      ? "All groups"
      : value === UNGROUPED
      ? "Ungrouped"
      : groups.find((g) => g.id === value)?.name ?? "All groups";

  const item =
    "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-neutral-800";
  const mark = (on: boolean) => (
    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
      {on && <Check className="h-3 w-3 text-indigo-400" />}
    </span>
  );

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-sm hover:bg-neutral-800 ${
          value === null
            ? "border-neutral-700 bg-neutral-900 text-neutral-200"
            : "border-indigo-600 bg-indigo-950/50 text-indigo-200"
        }`}
      >
        <Boxes className="h-3.5 w-3.5" />
        {label}
      </button>

      {open && (
        <div className="absolute left-0 z-20 mt-1 w-48 rounded-md border border-neutral-700 bg-neutral-900 p-1 shadow-xl">
          <button
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
            className={item}
          >
            {mark(value === null)}
            <span className="text-neutral-200">All groups</span>
          </button>
          {groups.map((g) => (
            <button
              key={g.id}
              onClick={() => {
                onChange(g.id);
                setOpen(false);
              }}
              className={item}
            >
              {mark(value === g.id)}
              <span className="truncate text-neutral-200">{g.name}</span>
            </button>
          ))}
          <button
            onClick={() => {
              onChange(UNGROUPED);
              setOpen(false);
            }}
            className={item}
          >
            {mark(value === UNGROUPED)}
            <span className="text-neutral-300">Ungrouped</span>
          </button>
        </div>
      )}
    </div>
  );
}
