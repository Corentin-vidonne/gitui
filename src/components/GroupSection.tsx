import { useEffect, useRef, useState, type DragEvent } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  MoreVertical,
  Pencil,
  Trash2,
  DownloadCloud,
} from "lucide-react";
import type { GroupSection as SectionData, RepoGroup } from "../lib/groups";
import type { UpdateItem } from "../lib/types";
import { MoveToMenu } from "./MoveToMenu";

const DND_MIME = "application/x-gitui-repo";

/** Last path segment, used for display. Mirrors App.tsx's repoName. */
function repoName(path: string): string {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** Inline "…" menu on a group header: rename / sync / delete. */
function GroupMenu({
  syncBusy,
  onRename,
  onDelete,
  onSync,
}: {
  syncBusy: boolean;
  onRename: () => void;
  onDelete: () => void;
  onSync: () => void;
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

  const item =
    "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-neutral-800";

  return (
    <div ref={ref} className="relative flex">
      <button
        title="Group actions"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={`rounded p-0.5 text-neutral-500 hover:text-neutral-200 ${
          open ? "opacity-100" : "opacity-0 group-hover/hdr:opacity-100"
        }`}
      >
        <MoreVertical className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-full z-20 mt-1 w-44 rounded-md border border-neutral-700 bg-neutral-900 p-1 normal-case tracking-normal shadow-xl"
        >
          <button
            onClick={() => {
              onRename();
              setOpen(false);
            }}
            className={`${item} text-neutral-200`}
          >
            <Pencil className="h-3.5 w-3.5" /> Rename
          </button>
          <button
            disabled={syncBusy}
            onClick={() => {
              onSync();
              setOpen(false);
            }}
            className={`${item} text-neutral-200 disabled:opacity-50`}
          >
            <DownloadCloud className={`h-3.5 w-3.5 ${syncBusy ? "animate-spin" : ""}`} />
            {syncBusy ? "Syncing…" : "Sync group"}
          </button>
          <button
            onClick={() => {
              onDelete();
              setOpen(false);
            }}
            className={`${item} text-rose-300 hover:bg-rose-950/40`}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete group
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * One collapsible sidebar section (a real group, or the Ungrouped catch-all when
 * `section.group` is null). The whole section is a drag-and-drop target; repo
 * rows inside are draggable. Aggregated update badge = sum of unseen updates
 * across the section's repos, shown even when collapsed.
 */
export function GroupSection({
  section,
  groups,
  selected,
  workspace,
  updates,
  syncBusy,
  dragPath,
  isDropTarget,
  hideHeader = false,
  onOpenRepo,
  onRemoveRepo,
  onAssignRepo,
  onCreateGroupForRepo,
  onToggleCollapsed,
  onRenameGroup,
  onDeleteGroup,
  onSyncGroup,
  onRepoDragStart,
  onRepoDragEnd,
  onDragOverSection,
  onDragLeaveSection,
}: {
  section: SectionData;
  groups: RepoGroup[];
  selected: string | null;
  workspace: boolean;
  updates: Record<string, UpdateItem[]>;
  syncBusy: boolean;
  dragPath: string | null;
  isDropTarget: boolean;
  /** Hide the section header (used for the flat list when no groups exist). */
  hideHeader?: boolean;
  onOpenRepo: (p: string) => void;
  onRemoveRepo: (p: string) => void;
  onAssignRepo: (path: string, groupId: string | null) => void;
  onCreateGroupForRepo: (path: string) => void;
  onToggleCollapsed: (id: string) => void;
  onRenameGroup: (id: string) => void;
  onDeleteGroup: (id: string) => void;
  onSyncGroup: (id: string) => void;
  onRepoDragStart: (path: string) => void;
  onRepoDragEnd: () => void;
  onDragOverSection: () => void;
  onDragLeaveSection: () => void;
}) {
  const group = section.group;
  const collapsed = group?.collapsed ?? false;
  const updateCount = section.repos.reduce(
    (n, p) => n + (updates[p]?.length ?? 0),
    0
  );

  function onDragOver(e: DragEvent) {
    if (e.dataTransfer.types.includes(DND_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      onDragOverSection();
    }
  }
  function onDragLeave(e: DragEvent) {
    // Ignore leaves into descendant elements to avoid highlight flicker.
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      onDragLeaveSection();
    }
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    const path =
      e.dataTransfer.getData(DND_MIME) || e.dataTransfer.getData("text/plain");
    if (path) onAssignRepo(path, group ? group.id : null);
    onDragLeaveSection();
    onRepoDragEnd();
  }

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`rounded-md ${isDropTarget ? "ring-1 ring-indigo-600" : ""}`}
    >
      {/* Header */}
      {!hideHeader && (
      <div
        onClick={() => group && onToggleCollapsed(group.id)}
        className={`group/hdr flex select-none items-center gap-1 rounded-md px-2 py-1 text-xs uppercase tracking-wider text-neutral-500 ${
          group ? "cursor-pointer hover:bg-neutral-900" : "cursor-default"
        }`}
      >
        {group ? (
          collapsed ? (
            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          )
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        {group && <Folder className="h-3.5 w-3.5 shrink-0 text-neutral-500" />}
        <span className="truncate">{group ? group.name : "Ungrouped"}</span>
        <span className="ml-auto flex items-center gap-1.5">
          {updateCount > 0 && (
            <span
              title={`${updateCount} new update(s) in this group`}
              className="rounded-full bg-indigo-600 px-1.5 text-[10px] font-semibold normal-case text-white"
            >
              {updateCount}
            </span>
          )}
          <span className="text-[10px] text-neutral-600">{section.repos.length}</span>
          {group && (
            <GroupMenu
              syncBusy={syncBusy}
              onRename={() => onRenameGroup(group.id)}
              onDelete={() => onDeleteGroup(group.id)}
              onSync={() => onSyncGroup(group.id)}
            />
          )}
        </span>
      </div>
      )}

      {/* Body */}
      {!collapsed &&
        section.repos.map((p) => (
          <div
            key={p}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(DND_MIME, p);
              e.dataTransfer.setData("text/plain", p);
              e.dataTransfer.effectAllowed = "move";
              onRepoDragStart(p);
            }}
            onDragEnd={onRepoDragEnd}
            className={`group relative flex items-center gap-2 rounded-md py-1.5 pl-6 pr-2 text-sm ${
              selected === p && !workspace
                ? "bg-neutral-800 text-neutral-100"
                : "text-neutral-400 hover:bg-neutral-900"
            } ${dragPath === p ? "opacity-50" : ""}`}
          >
            <button
              onClick={() => onOpenRepo(p)}
              title={p}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
            >
              <span className="truncate">{repoName(p)}</span>
            </button>
            <span className="flex items-center gap-1">
              {updates[p]?.length ? (
                <span
                  title={`${updates[p].length} new update(s)`}
                  className="rounded-full bg-indigo-600 px-1.5 text-[10px] font-semibold text-white"
                >
                  {updates[p].length}
                </span>
              ) : null}
              <MoveToMenu
                currentGroupId={group ? group.id : null}
                groups={groups}
                onAssign={(gid) => onAssignRepo(p, gid)}
                onCreateGroup={() => onCreateGroupForRepo(p)}
              />
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveRepo(p);
                }}
                className="hidden cursor-pointer text-neutral-600 hover:text-rose-400 group-hover:block"
              >
                ✕
              </span>
            </span>
          </div>
        ))}
    </div>
  );
}
