import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Move, Check, FolderPlus } from "lucide-react";
import type { RepoGroup } from "../lib/groups";

/**
 * Per-repo "Move to…" popover. Lists Ungrouped + every group (a check marks the
 * current one) + "New group…". Follows the CommitFilter popover pattern
 * (click-outside via a document mousedown listener).
 */
export function MoveToMenu({
  currentGroupId,
  groups,
  onAssign,
  onCreateGroup,
}: {
  /** null when the repo is currently ungrouped. */
  currentGroupId: string | null;
  groups: RepoGroup[];
  onAssign: (groupId: string | null) => void;
  onCreateGroup: () => void;
}) {
  const { t } = useTranslation();
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
        title={t("moveToMenu.moveToGroup")}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={`rounded p-0.5 text-neutral-500 hover:text-neutral-200 ${
          open ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
      >
        <Move className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-full z-20 mt-1 w-48 rounded-md border border-neutral-700 bg-neutral-900 p-1 shadow-xl"
        >
          <button
            onClick={() => {
              onAssign(null);
              setOpen(false);
            }}
            className={item}
          >
            <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
              {currentGroupId === null && <Check className="h-3 w-3 text-indigo-400" />}
            </span>
            <span className="truncate text-neutral-300">{t("moveToMenu.ungrouped")}</span>
          </button>

          {groups.map((g) => (
            <button
              key={g.id}
              onClick={() => {
                onAssign(g.id);
                setOpen(false);
              }}
              className={item}
            >
              <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                {currentGroupId === g.id && <Check className="h-3 w-3 text-indigo-400" />}
              </span>
              <span className="truncate text-neutral-200">{g.name}</span>
            </button>
          ))}

          <div className="my-1 border-t border-neutral-800" />
          <button
            onClick={() => {
              onCreateGroup();
              setOpen(false);
            }}
            className={`${item} text-indigo-300`}
          >
            <FolderPlus className="h-3.5 w-3.5 shrink-0" />
            {t("moveToMenu.newGroup")}
          </button>
        </div>
      )}
    </div>
  );
}
