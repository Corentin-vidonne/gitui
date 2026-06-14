import { useState } from "react";
import { useTranslation } from "react-i18next";
import { UNGROUPED, type GroupSection as SectionData, type RepoGroup } from "../lib/groups";
import type { UpdateItem } from "../lib/types";
import { GroupSection } from "./GroupSection";

/**
 * Scrollable repo list, grouped into collapsible sections. Owns the transient
 * drag-and-drop UI state (which row is being dragged, which section is the live
 * drop target); all persisted state lives in App. When no real groups exist it
 * falls back to a flat, header-less list to match the original look.
 */
export function Sidebar({
  sections,
  groups,
  selected,
  workspace,
  updates,
  groupSyncBusy,
  onOpenRepo,
  onRemoveRepo,
  onAssignRepo,
  onCreateGroupForRepo,
  onToggleCollapsed,
  onRenameGroup,
  onDeleteGroup,
  onSyncGroup,
}: {
  sections: SectionData[];
  groups: RepoGroup[];
  selected: string | null;
  workspace: boolean;
  updates: Record<string, UpdateItem[]>;
  groupSyncBusy: Record<string, boolean>;
  onOpenRepo: (p: string) => void;
  onRemoveRepo: (p: string) => void;
  onAssignRepo: (path: string, groupId: string | null) => void;
  onCreateGroupForRepo: (path: string) => void;
  onToggleCollapsed: (id: string) => void;
  onRenameGroup: (id: string) => void;
  onDeleteGroup: (id: string) => void;
  onSyncGroup: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [dragPath, setDragPath] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const total = sections.reduce((n, s) => n + s.repos.length, 0);
  const realGroups = sections.filter((s) => s.group);
  const ungrouped = sections.find((s) => !s.group) ?? { group: null, repos: [] };

  const sectionId = (s: SectionData) => s.group?.id ?? UNGROUPED;

  const onRepoDragEnd = () => {
    setDragPath(null);
    setDropTarget(null);
  };

  // Props shared by every GroupSection.
  const common = (s: SectionData) => ({
    section: s,
    groups,
    selected,
    workspace,
    updates,
    syncBusy: s.group ? groupSyncBusy[s.group.id] ?? false : false,
    dragPath,
    isDropTarget: dropTarget === sectionId(s),
    onOpenRepo,
    onRemoveRepo,
    onAssignRepo,
    onCreateGroupForRepo,
    onToggleCollapsed,
    onRenameGroup,
    onDeleteGroup,
    onSyncGroup,
    onRepoDragStart: setDragPath,
    onRepoDragEnd,
    onDragOverSection: () => setDropTarget(sectionId(s)),
    onDragLeaveSection: () =>
      setDropTarget((cur) => (cur === sectionId(s) ? null : cur)),
  });

  return (
    <div className="flex-1 overflow-auto px-2 pb-2">
      {total === 0 ? (
        <div className="px-2 text-sm text-neutral-600">{t("sidebar.empty")}</div>
      ) : realGroups.length === 0 ? (
        <GroupSection {...common(ungrouped)} hideHeader />
      ) : (
        <div className="space-y-1">
          {realGroups.map((s) => (
            <GroupSection key={s.group!.id} {...common(s)} />
          ))}
          {ungrouped.repos.length > 0 && <GroupSection {...common(ungrouped)} />}
        </div>
      )}
    </div>
  );
}
