import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { GitPullRequest, CircleDot, Search } from "lucide-react";
import { api } from "../lib/api";

export type PaletteItem = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
  run: () => void;
};

/** Substring match, falling back to a subsequence (fuzzy) match. */
function matches(label: string, q: string): boolean {
  if (!q) return true;
  const l = label.toLowerCase();
  const query = q.toLowerCase();
  if (l.includes(query)) return true;
  let i = 0;
  for (const ch of query) {
    i = l.indexOf(ch, i);
    if (i < 0) return false;
    i++;
  }
  return true;
}

/** A Ctrl/Cmd+K command palette: jump to a branch / PR / issue, or run an action. */
export function CommandPalette({
  items,
  repoPath,
  onOpenPr,
  onOpenIssue,
  onClose,
}: {
  items: PaletteItem[];
  repoPath: string | null;
  onOpenPr: (n: number) => void;
  onOpenIssue: (n: number) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [dynamic, setDynamic] = useState<PaletteItem[]>([]);
  const listRef = useRef<HTMLUListElement>(null);

  // PRs + issues are fetched lazily (gh calls) when the palette opens.
  useEffect(() => {
    if (!repoPath) return;
    let alive = true;
    Promise.all([
      api.listPullRequests(repoPath, "open").catch(() => []),
      api.listIssues(repoPath, "open").catch(() => []),
    ]).then(([prs, issues]) => {
      if (!alive) return;
      setDynamic([
        ...prs.map((p) => ({
          id: `pr-${p.number}`,
          group: "Pull requests",
          label: `#${p.number} ${p.title}`,
          hint: p.state,
          icon: <GitPullRequest className="h-4 w-4 text-indigo-400" />,
          run: () => onOpenPr(p.number),
        })),
        ...issues.map((i) => ({
          id: `issue-${i.number}`,
          group: "Issues",
          label: `#${i.number} ${i.title}`,
          hint: i.state,
          icon: <CircleDot className="h-4 w-4 text-emerald-400" />,
          run: () => onOpenIssue(i.number),
        })),
      ]);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoPath]);

  const filtered = useMemo(
    () => [...items, ...dynamic].filter((it) => matches(it.label, query)),
    [items, dynamic, query]
  );

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function onKeyDown(e: ReactKeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = filtered[active];
      if (it) {
        onClose();
        it.run();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  let lastGroup = "";
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[14vh]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-neutral-800 px-3">
          <Search className="h-4 w-4 shrink-0 text-neutral-500" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Aller à une branche, PR, issue… ou lancer une action"
            className="flex-1 bg-transparent py-3 text-sm text-neutral-100 outline-none placeholder:text-neutral-600"
          />
          <kbd className="rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-500">
            Esc
          </kbd>
        </div>
        <ul ref={listRef} className="max-h-[50vh] overflow-auto py-1">
          {filtered.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-neutral-500">Aucun résultat</li>
          )}
          {filtered.map((it, i) => {
            const header = it.group !== lastGroup ? it.group : null;
            lastGroup = it.group;
            return (
              <li key={it.id}>
                {header && (
                  <div className="px-3 pb-0.5 pt-2 text-[10px] font-medium uppercase tracking-wider text-neutral-600">
                    {header}
                  </div>
                )}
                <button
                  data-idx={i}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => {
                    onClose();
                    it.run();
                  }}
                  className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm ${
                    i === active ? "bg-indigo-600/20 text-neutral-100" : "text-neutral-300"
                  }`}
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center text-neutral-400">
                    {it.icon}
                  </span>
                  <span className="flex-1 truncate">{it.label}</span>
                  {it.hint && (
                    <span className="shrink-0 text-[10px] uppercase text-neutral-500">
                      {it.hint}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
