// Repo grouping: a frontend-only concern stored in localStorage alongside the
// flat `gitui.repos` list. `gitui.repos` stays the source of truth for which
// repos exist; this module only records group definitions and a
// repoPath -> groupId assignment map. A repo with no assignment is "Ungrouped",
// so installs that predate this feature migrate implicitly (no key => all
// ungrouped). One group per repo (folder model).

export type RepoGroup = {
  id: string;
  name: string;
  /** Ascending sort key for the sidebar sections. */
  order: number;
  collapsed: boolean;
};

export type RepoGroupsState = {
  groups: RepoGroup[];
  /** repoPath -> groupId. Absent => Ungrouped. */
  assignments: Record<string, string>;
  /** Monotonic counter backing stable group ids/order (no Date.now/random). */
  seq: number;
};

/** Sentinel id for the Ungrouped section. Never persisted as a real group. */
export const UNGROUPED = "__ungrouped__";

const GROUPS_KEY = "gitui.repoGroups";

const EMPTY: RepoGroupsState = { groups: [], assignments: {}, seq: 0 };

export function loadGroups(): RepoGroupsState {
  try {
    const raw = localStorage.getItem(GROUPS_KEY);
    if (!raw) return { ...EMPTY };
    const p = JSON.parse(raw) as Partial<RepoGroupsState>;
    return {
      groups: p.groups ?? [],
      assignments: p.assignments ?? {},
      seq: p.seq ?? p.groups?.length ?? 0,
    };
  } catch {
    return { ...EMPTY };
  }
}

export function saveGroups(s: RepoGroupsState) {
  localStorage.setItem(GROUPS_KEY, JSON.stringify(s));
}

// --- Pure reducers: each returns a new state (or the same object when nothing
// changed, so React can skip a render). None of them touch `gitui.repos`. ---

export function createGroup(
  s: RepoGroupsState,
  name: string
): { state: RepoGroupsState; id: string } {
  const trimmed = name.trim();
  const seq = s.seq + 1;
  const id = `g${seq}`;
  const group: RepoGroup = { id, name: trimmed, order: seq, collapsed: false };
  return { state: { ...s, groups: [...s.groups, group], seq }, id };
}

export function renameGroup(
  s: RepoGroupsState,
  id: string,
  name: string
): RepoGroupsState {
  const trimmed = name.trim();
  if (!trimmed) return s;
  return {
    ...s,
    groups: s.groups.map((g) => (g.id === id ? { ...g, name: trimmed } : g)),
  };
}

export function deleteGroup(s: RepoGroupsState, id: string): RepoGroupsState {
  // Drop the group and every assignment pointing at it; those repos fall back
  // to Ungrouped. The repos themselves (gitui.repos) are untouched.
  const assignments: Record<string, string> = {};
  for (const [path, gid] of Object.entries(s.assignments)) {
    if (gid !== id) assignments[path] = gid;
  }
  return { ...s, groups: s.groups.filter((g) => g.id !== id), assignments };
}

export function assignRepo(
  s: RepoGroupsState,
  path: string,
  groupId: string | null
): RepoGroupsState {
  const target = groupId === UNGROUPED ? null : groupId;
  const current = s.assignments[path] ?? null;
  if (current === target) return s; // no-op (e.g. drop onto the same group)
  const assignments = { ...s.assignments };
  if (target === null) delete assignments[path];
  else assignments[path] = target;
  return { ...s, assignments };
}

export function toggleCollapsed(s: RepoGroupsState, id: string): RepoGroupsState {
  return {
    ...s,
    groups: s.groups.map((g) =>
      g.id === id ? { ...g, collapsed: !g.collapsed } : g
    ),
  };
}

/** Forget a repo's assignment (called when the repo is removed). */
export function forgetRepo(s: RepoGroupsState, path: string): RepoGroupsState {
  if (!(path in s.assignments)) return s;
  const assignments = { ...s.assignments };
  delete assignments[path];
  return { ...s, assignments };
}

/** Drop assignments whose repo path no longer exists in `repos`. */
export function pruneAssignments(
  s: RepoGroupsState,
  repos: string[]
): RepoGroupsState {
  const live = new Set(repos);
  const stale = Object.keys(s.assignments).filter((p) => !live.has(p));
  if (stale.length === 0) return s;
  const assignments = { ...s.assignments };
  for (const p of stale) delete assignments[p];
  return { ...s, assignments };
}

// --- Selector ---

export type GroupSection = {
  /** null => the Ungrouped section. */
  group: RepoGroup | null;
  repos: string[];
};

/**
 * Build the ordered list of sidebar sections. Real groups come first (sorted by
 * `order`), then the Ungrouped section last. Repo order within a section follows
 * the insertion order of `repos` (gitui.repos). Assignments pointing at a
 * missing group id are treated as Ungrouped (defensive).
 */
export function buildSections(
  s: RepoGroupsState,
  repos: string[]
): GroupSection[] {
  const known = new Set(s.groups.map((g) => g.id));
  const ordered = [...s.groups].sort((a, b) => a.order - b.order);

  const sections: GroupSection[] = ordered.map((group) => ({
    group,
    repos: repos.filter((p) => s.assignments[p] === group.id),
  }));

  const ungrouped = repos.filter((p) => {
    const gid = s.assignments[p];
    return !gid || !known.has(gid);
  });
  sections.push({ group: null, repos: ungrouped });

  return sections;
}
