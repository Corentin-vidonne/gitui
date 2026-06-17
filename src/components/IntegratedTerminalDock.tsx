import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Terminal as TerminalIcon,
  Plus,
  ChevronDown,
  SplitSquareHorizontal,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import i18n from "../lib/i18n";
import { api, errorText } from "../lib/api";
import { useThemePalette, type ThemePalette } from "../lib/theme";
import type { ShellProfile } from "../lib/types";

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `sh-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/** One live PTY session: its shell profile, working dir, and flex weight within its group. */
type Pane = { id: string; shellId: string; cwd: string | null; weight: number };
/** A tab = a group of one or more panes laid out side by side (VS Code "split terminal"). */
type Tab = { id: string; title: string; panes: Pane[] };

/** Minimum share of a split group's width a single pane may shrink to while dragging. */
const MIN_WEIGHT_FRACTION = 0.12;

/**
 * A single xterm-backed shell session. Mounted ONCE per pane and kept alive for the whole
 * lifetime of the dock (it is never remounted — only its group/dock get `display:none`), so
 * sessions survive tab switches, splits, repo switches, and show/hide toggles. Spawns a plain
 * shell via `term_open_shell` (mirrors `TerminalDock`'s PTY wiring).
 */
function TerminalPane({
  pane,
  visible,
  focused,
  palette,
}: {
  pane: Pane;
  /** Whether this pane is currently displayed (its group is the active tab AND the dock is shown). */
  visible: boolean;
  /** Whether this is the focused pane of its group (gets keyboard focus + the focus ring). */
  focused: boolean;
  palette: ThemePalette;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  // Read the palette via a ref inside the mount effect so a theme switch updates the live
  // terminal (effect below) without tearing down and recreating the session.
  const paletteRef = useRef(palette);
  paletteRef.current = palette;

  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = {
        background: palette.termBg,
        foreground: palette.termFg,
        cursor: palette.termCursor,
        selectionBackground: palette.termSelection,
      };
    }
  }, [palette]);

  // Create the terminal + PTY session exactly once for this pane.
  useEffect(() => {
    const id = pane.id;
    const p = paletteRef.current;
    const term = new Terminal({
      fontSize: 12,
      fontFamily: 'ui-monospace, "Cascadia Code", Consolas, monospace',
      theme: {
        background: p.termBg,
        foreground: p.termFg,
        cursor: p.termCursor,
        selectionBackground: p.termSelection,
      },
      cursorBlink: true,
    });
    termRef.current = term;
    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);
    if (hostRef.current) term.open(hostRef.current);

    const safeFit = () => {
      try {
        fit.fit();
      } catch {
        /* not laid out / hidden yet */
      }
    };
    safeFit();

    let alive = true;
    // Tracks the in-flight shell open so cleanup can close the session only AFTER it is
    // actually registered in the backend — closing immediately could race ahead of the
    // not-yet-inserted session and no-op, leaking the spawned shell process.
    let opened: Promise<unknown> = Promise.resolve();
    const unlisteners: Array<() => void> = [];
    const onData = term.onData((d) => {
      invoke("term_write", { id, data: d }).catch(() => {});
    });

    (async () => {
      const offOut = await listen<{ id: string; data: string }>("term-output", (e) => {
        if (e.payload.id === id) term.write(decodeBase64(e.payload.data));
      });
      const offExit = await listen<string>("term-exit", (e) => {
        // Read the label lazily (non-hook i18n) so a language switch after mount is honored;
        // this listener is captured once for the pane's whole lifetime.
        if (e.payload === id)
          term.write(`\r\n\x1b[90m[${i18n.t("integratedTerminal.sessionEnded")}]\x1b[0m\r\n`);
      });
      unlisteners.push(offOut, offExit);
      if (!alive) {
        offOut();
        offExit();
        return;
      }
      opened = invoke("term_open_shell", {
        id,
        cwd: pane.cwd,
        shell: pane.shellId || null,
        cols: term.cols,
        rows: term.rows,
      }).catch((err) => term.write(`\r\n\x1b[31m${errorText(err)}\x1b[0m\r\n`));
      await opened;
      if (alive && focused) term.focus();
    })();

    const ro = new ResizeObserver(() => {
      safeFit();
      invoke("term_resize", { id, cols: term.cols, rows: term.rows }).catch(() => {});
    });
    if (hostRef.current) ro.observe(hostRef.current);

    return () => {
      alive = false;
      onData.dispose();
      ro.disconnect();
      unlisteners.forEach((u) => u());
      // Close only after the open settles, so the session is in the backend map when we
      // close it (a no-op `term_close` before insertion would orphan the shell process).
      void opened.finally(() => invoke("term_close", { id }).catch(() => {}));
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // Mount once: a pane's identity (id/cwd/shell) never changes after creation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the pane becomes visible (its group activates / the dock is reshown) re-fit — its
  // host now has real dimensions — and focus it if it's the group's focused pane.
  useEffect(() => {
    if (!visible) return;
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;
    const raf = requestAnimationFrame(() => {
      try {
        fit.fit();
      } catch {
        /* ignore */
      }
      invoke("term_resize", { id: pane.id, cols: term.cols, rows: term.rows }).catch(() => {});
      if (focused) term.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [visible, focused, pane.id]);

  return <div ref={hostRef} className="absolute inset-0 px-1 pb-1" />;
}

/**
 * The integrated terminal: a resizable bottom dock of shell tabs. Each tab is a GROUP that
 * can hold several panes side by side ("Split" — the ⊟ button), with draggable separators.
 * New tabs open the default shell (＋) or a chosen profile (⌄ menu); a split mirrors the
 * focused pane's profile. Every session stays alive across tab switches, splits, repo
 * switches and show/hide toggles — the parent keeps this mounted and flips `visible`, so
 * hiding only sets `display:none`. Only closing the last pane tears the dock down (`onClosed`).
 */
export function IntegratedTerminalDock({
  repoPath,
  defaultShell,
  visible,
  onHide,
  onClosed,
}: {
  /** Working directory for newly opened panes (the active repo, or null → home). */
  repoPath: string | null;
  /** Default shell profile id (from Settings); "" = system default. */
  defaultShell: string;
  /** Whether the dock is shown. When false it's hidden (kept mounted) so sessions persist. */
  visible: boolean;
  /** Hide the dock (X button) — sessions keep running. */
  onHide: () => void;
  /** The last pane was closed — fully tear the dock down. */
  onClosed: () => void;
}) {
  const { t } = useTranslation();
  const palette = useThemePalette();
  const [height, setHeight] = useState(320);
  const [shells, setShells] = useState<ShellProfile[]>([]);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [focusedPaneId, setFocusedPaneId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  function newPane(profile: ShellProfile | undefined): Pane {
    return { id: newId(), shellId: profile?.id ?? "", cwd: repoPath, weight: 1 };
  }

  // A title for a new tab: the profile label, suffixed " (n)" when it repeats.
  function titleFor(profile: ShellProfile | undefined, existing: Tab[]): string {
    const label = profile?.label ?? "Terminal";
    const same = existing.filter((x) => x.title.replace(/ \(\d+\)$/, "") === label).length;
    return same === 0 ? label : `${label} (${same + 1})`;
  }

  // Open a new tab (its own group with a single pane).
  function addTab(shellId?: string) {
    const id = shellId ?? defaultShell;
    const profile = shells.find((s) => s.id === id) ?? shells[0];
    // Build the tab (and its ids) once, outside the updater, so StrictMode's double-invoked
    // updater can't generate two ids / desync the active tab.
    const pane = newPane(profile);
    const tab: Tab = { id: newId(), title: titleFor(profile, tabs), panes: [pane] };
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
    setFocusedPaneId(pane.id);
    setMenuOpen(false);
  }

  // Split the active tab: add a pane beside the others (mirrors the focused pane's profile).
  function splitActive() {
    const tab = tabs.find((x) => x.id === activeTabId);
    if (!tab) return;
    const focused = tab.panes.find((p) => p.id === focusedPaneId) ?? tab.panes[0];
    const profile =
      shells.find((s) => s.id === focused?.shellId) ??
      shells.find((s) => s.id === defaultShell) ??
      shells[0];
    const pane = newPane(profile);
    setTabs((prev) =>
      prev.map((x) => (x.id === tab.id ? { ...x, panes: [...x.panes, pane] } : x))
    );
    setFocusedPaneId(pane.id);
  }

  function selectTab(tabId: string) {
    const tab = tabs.find((x) => x.id === tabId);
    if (!tab) return;
    setActiveTabId(tabId);
    // Focus the focused pane if it's in this tab, otherwise the first pane.
    if (!tab.panes.some((p) => p.id === focusedPaneId)) setFocusedPaneId(tab.panes[0].id);
  }

  // Close a whole tab (and all its panes). Closing the last tab tears the dock down.
  function closeTab(tabId: string) {
    const idx = tabs.findIndex((x) => x.id === tabId);
    const next = tabs.filter((x) => x.id !== tabId);
    if (next.length === 0) {
      onClosed();
      return;
    }
    setTabs(next);
    if (activeTabId === tabId) {
      const na = next[Math.min(idx, next.length - 1)];
      setActiveTabId(na.id);
      setFocusedPaneId(na.panes[0].id);
    }
  }

  // Close a single pane within a group. If it was the group's last pane the tab goes too;
  // if that was the last tab the dock tears down.
  function closePane(paneId: string) {
    const owner = tabs.find((x) => x.panes.some((p) => p.id === paneId));
    if (!owner) return;
    if (owner.panes.length === 1) {
      closeTab(owner.id);
      return;
    }
    const removedIdx = owner.panes.findIndex((p) => p.id === paneId);
    const next = tabs.map((x) =>
      x.id === owner.id ? { ...x, panes: x.panes.filter((p) => p.id !== paneId) } : x
    );
    setTabs(next);
    if (focusedPaneId === paneId) {
      // Move focus to the closed pane's neighbor (the pane now at its index, else the last).
      const t2 = next.find((x) => x.id === owner.id);
      if (t2) setFocusedPaneId(t2.panes[Math.min(removedIdx, t2.panes.length - 1)].id);
    }
  }

  // Drag a separator between panes `idx-1` and `idx` of `tabId`, shifting flex weight between
  // them proportionally to the pointer delta over the group's width.
  function startSplitResize(tabId: string, idx: number, e: ReactMouseEvent) {
    e.preventDefault();
    const container = (e.currentTarget as HTMLElement).parentElement;
    if (!container) return;
    const width = container.getBoundingClientRect().width || 1;
    const startX = e.clientX;
    const tab = tabs.find((x) => x.id === tabId);
    if (!tab) return;
    const start = tab.panes.map((p) => p.weight);
    const total = start.reduce((a, b) => a + b, 0);
    const li = idx - 1;
    const ri = idx;
    const pair = start[li] + start[ri];
    const min = total * MIN_WEIGHT_FRACTION;
    const onMove = (ev: MouseEvent) => {
      const dW = ((ev.clientX - startX) / width) * total;
      const newL = Math.max(min, Math.min(pair - min, start[li] + dW));
      const newR = pair - newL;
      setTabs((prev) =>
        prev.map((x) => {
          if (x.id !== tabId) return x;
          const panes = x.panes.map((p, i) =>
            i === li ? { ...p, weight: newL } : i === ri ? { ...p, weight: newR } : p
          );
          return { ...x, panes };
        })
      );
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
    };
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // Detect the available shells once, then open the first tab with the configured default.
  // The `alive` guard makes this idempotent under StrictMode's double-mount (only the
  // surviving run sets state), so exactly one initial tab/pane is created.
  useEffect(() => {
    let alive = true;
    const openFirst = (list: ShellProfile[]) => {
      if (!alive) return;
      setShells(list);
      const def = list.find((s) => s.id === defaultShell) ?? list[0];
      const pane = newPane(def);
      const tab: Tab = { id: newId(), title: titleFor(def, []), panes: [pane] };
      setTabs([tab]);
      setActiveTabId(tab.id);
      setFocusedPaneId(pane.id);
    };
    api.listShells().then(openFirst).catch(() => openFirst([]));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close the profile menu on any outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const off = () => setMenuOpen(false);
    window.addEventListener("click", off);
    return () => window.removeEventListener("click", off);
  }, [menuOpen]);

  function startResize(e: ReactMouseEvent) {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    const onMove = (ev: MouseEvent) =>
      setHeight(
        Math.min(window.innerHeight * 0.8, Math.max(160, startH - (ev.clientY - startY)))
      );
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
    };
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  return (
    // Hidden (not unmounted) when !visible, so the shell sessions keep running in the
    // background and survive repo switches / show-hide toggles.
    <div
      style={{ height }}
      className={`flex shrink-0 flex-col border-t border-neutral-800 bg-neutral-950 ${
        visible ? "" : "hidden"
      }`}
    >
      <div
        onMouseDown={startResize}
        className="h-1 shrink-0 cursor-row-resize bg-neutral-800 transition-colors hover:bg-indigo-600"
      />
      {/* Tab strip + split / new-tab buttons. */}
      <div className="flex h-9 shrink-0 items-center gap-1 px-2 text-xs text-neutral-300">
        <TerminalIcon className="ml-1 mr-0.5 h-3.5 w-3.5 shrink-0 text-indigo-400" />
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                onClick={() => selectTab(tab.id)}
                title={tab.title}
                className={`group flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md py-1 pl-2 pr-1 ${
                  isActive
                    ? "bg-neutral-800 text-neutral-100"
                    : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200"
                }`}
              >
                <TerminalIcon className="h-3 w-3 shrink-0 opacity-70" />
                <span className="max-w-[11rem] truncate">{tab.title}</span>
                {tab.panes.length > 1 && (
                  <span className="rounded bg-neutral-700/70 px-1 text-[9px] font-medium text-neutral-300">
                    {tab.panes.length}
                  </span>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                  title={t("common.close")}
                  className="rounded p-0.5 text-neutral-500 opacity-0 hover:bg-neutral-700 hover:text-neutral-200 group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>

        <button
          onClick={splitActive}
          title={t("integratedTerminal.split")}
          className="shrink-0 rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
        >
          <SplitSquareHorizontal className="h-3.5 w-3.5" />
        </button>

        <div className="relative shrink-0">
          <div className="flex items-center">
            <button
              onClick={() => addTab()}
              title={t("integratedTerminal.newTab")}
              className="rounded-l p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
              title={t("integratedTerminal.chooseShell")}
              className="rounded-r p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
            >
              <ChevronDown className="h-3 w-3" />
            </button>
          </div>
          {menuOpen && (
            <div className="absolute bottom-full right-0 z-20 mb-1 min-w-[13rem] overflow-hidden rounded-md border border-neutral-700 bg-neutral-900 py-1 shadow-xl">
              {shells.length === 0 ? (
                <div className="px-3 py-1.5 text-neutral-500">
                  {t("integratedTerminal.noShells")}
                </div>
              ) : (
                shells.map((s) => (
                  <button
                    key={s.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      addTab(s.id);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-neutral-300 hover:bg-neutral-800"
                  >
                    <TerminalIcon className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
                    <span className="truncate">{s.label}</span>
                    {s.id === defaultShell && (
                      <span className="ml-auto pl-2 text-[10px] text-neutral-500">
                        {t("integratedTerminal.default")}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <button
          onClick={onHide}
          title={t("common.close")}
          className="ml-1 shrink-0 rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Groups stacked; only the active one is shown, its panes laid out side by side.
          Every pane stays mounted so all sessions persist. */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {tabs.map((tab) => {
          const groupActive = tab.id === activeTabId;
          const split = tab.panes.length > 1;
          return (
            <div
              key={tab.id}
              className={`absolute inset-0 flex ${groupActive ? "" : "hidden"}`}
            >
              {tab.panes.map((pane, i) => (
                <Fragment key={pane.id}>
                  {i > 0 && (
                    <div
                      onMouseDown={(e) => startSplitResize(tab.id, i, e)}
                      className="w-1 shrink-0 cursor-col-resize bg-neutral-800 transition-colors hover:bg-indigo-600"
                    />
                  )}
                  <div
                    onFocus={() => setFocusedPaneId(pane.id)}
                    onMouseDown={() => setFocusedPaneId(pane.id)}
                    style={{ flexGrow: pane.weight, flexBasis: 0 }}
                    className="group relative min-w-0 shrink"
                  >
                    <TerminalPane
                      pane={pane}
                      visible={groupActive && visible}
                      focused={pane.id === focusedPaneId}
                      palette={palette}
                    />
                    {split && pane.id === focusedPaneId && (
                      <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-indigo-500/40" />
                    )}
                    {split && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          closePane(pane.id);
                        }}
                        title={t("common.close")}
                        className="absolute right-1.5 top-1.5 z-10 rounded p-0.5 text-neutral-500 opacity-0 hover:bg-neutral-800 hover:text-neutral-200 focus:opacity-100 group-hover:opacity-100"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </Fragment>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
