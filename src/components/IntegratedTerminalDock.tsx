import {
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

/** One open terminal tab: a live PTY session + its working dir / shell profile. */
type Tab = { id: string; title: string; shellId: string; cwd: string | null };

/**
 * A single xterm-backed shell session. Mounted ONCE per tab and kept alive while the dock
 * is open (it's only `hidden` when its tab is inactive), so switching tabs preserves
 * scrollback and the running process. Mirrors `TerminalDock`'s PTY wiring, but spawns a
 * plain shell (`term_open_shell`) instead of `claude`.
 */
function TerminalPane({
  tab,
  active,
  dockVisible,
  palette,
}: {
  tab: Tab;
  active: boolean;
  /** Whether the whole dock is currently shown (vs hidden but kept mounted). */
  dockVisible: boolean;
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

  // Create the terminal + PTY session exactly once for this tab.
  useEffect(() => {
    const id = tab.id;
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
        cwd: tab.cwd,
        shell: tab.shellId || null,
        cols: term.cols,
        rows: term.rows,
      }).catch((err) => term.write(`\r\n\x1b[31m${errorText(err)}\x1b[0m\r\n`));
      await opened;
      if (alive && active) term.focus();
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
    // Mount once: a tab's identity (id/cwd/shell) never changes after creation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When this tab becomes the visible one — its tab is selected AND the dock is shown — it
  // transitions from `display:none` to visible, so re-fit (its host now has real dimensions)
  // and focus it for typing. Depending on `dockVisible` also refits after the dock is reshown.
  useEffect(() => {
    if (!active || !dockVisible) return;
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;
    const raf = requestAnimationFrame(() => {
      try {
        fit.fit();
      } catch {
        /* ignore */
      }
      invoke("term_resize", { id: tab.id, cols: term.cols, rows: term.rows }).catch(() => {});
      term.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [active, dockVisible, tab.id]);

  return (
    <div
      ref={hostRef}
      className={`absolute inset-0 px-2 pb-2 ${active ? "" : "hidden"}`}
    />
  );
}

/**
 * The integrated terminal: a resizable bottom dock hosting one or more shell tabs. New tabs
 * open the configured default shell (the "＋" button) or a chosen profile (the "⌄" menu),
 * VS Code-style. Sessions stay alive across tab switches AND across repo switches / show-hide
 * toggles — the parent keeps this mounted and flips `visible`, so hiding the dock only sets
 * `display:none` (the shells keep running). Only closing the last tab tears it down
 * (`onClosed`). Styled to match the app (theme-aware xterm colors, neutral chrome, indigo).
 */
export function IntegratedTerminalDock({
  repoPath,
  defaultShell,
  visible,
  onHide,
  onClosed,
}: {
  /** Working directory for newly opened tabs (the active repo, or null → home). */
  repoPath: string | null;
  /** Default shell profile id (from Settings); "" = system default. */
  defaultShell: string;
  /** Whether the dock is shown. When false it's hidden (kept mounted) so sessions persist. */
  visible: boolean;
  /** Hide the dock (X button) — sessions keep running. */
  onHide: () => void;
  /** The last tab was closed — fully tear the dock down. */
  onClosed: () => void;
}) {
  const { t } = useTranslation();
  const palette = useThemePalette();
  const [height, setHeight] = useState(320);
  const [shells, setShells] = useState<ShellProfile[]>([]);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // A title for a new tab: the profile label, suffixed " (n)" when it repeats.
  function makeTab(profile: ShellProfile | undefined, existing: Tab[]): Tab {
    const label = profile?.label ?? "Terminal";
    const same = existing.filter(
      (x) => x.title.replace(/ \(\d+\)$/, "") === label
    ).length;
    return {
      id: newId(),
      title: same === 0 ? label : `${label} (${same + 1})`,
      shellId: profile?.id ?? "",
      cwd: repoPath,
    };
  }

  function addTab(shellId?: string) {
    const id = shellId ?? defaultShell;
    const profile = shells.find((s) => s.id === id) ?? shells[0];
    // Build the tab (and its id) once, outside the updater, so StrictMode's double-invoked
    // updater can't generate two ids / desync the active tab.
    const tab = makeTab(profile, tabs);
    setTabs((prev) => [...prev, tab]);
    setActiveId(tab.id);
    setMenuOpen(false);
  }

  function closeTab(id: string) {
    const idx = tabs.findIndex((x) => x.id === id);
    const next = tabs.filter((x) => x.id !== id);
    if (next.length === 0) {
      onClosed(); // no sessions left to preserve — tear the dock down
      return;
    }
    setTabs(next);
    if (activeId === id) {
      setActiveId(next[Math.min(idx, next.length - 1)].id);
    }
  }

  // Detect the available shells once, then open the first tab with the configured default.
  // The `alive` guard makes this idempotent under StrictMode's double-mount (only the
  // surviving run sets state), so exactly one initial tab is created.
  useEffect(() => {
    let alive = true;
    const openFirst = (list: ShellProfile[]) => {
      if (!alive) return;
      setShells(list);
      const def = list.find((s) => s.id === defaultShell) ?? list[0];
      const tab = makeTab(def, []);
      setTabs([tab]);
      setActiveId(tab.id);
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
      {/* Tab strip + new-tab split button. */}
      <div className="flex h-9 shrink-0 items-center gap-1 px-2 text-xs text-neutral-300">
        <TerminalIcon className="ml-1 mr-0.5 h-3.5 w-3.5 shrink-0 text-indigo-400" />
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tabs.map((tab) => {
            const isActive = tab.id === activeId;
            return (
              <div
                key={tab.id}
                onClick={() => setActiveId(tab.id)}
                title={tab.title}
                className={`group flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md py-1 pl-2 pr-1 ${
                  isActive
                    ? "bg-neutral-800 text-neutral-100"
                    : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200"
                }`}
              >
                <TerminalIcon className="h-3 w-3 shrink-0 opacity-70" />
                <span className="max-w-[11rem] truncate">{tab.title}</span>
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

      {/* Panes: all tabs stay mounted; inactive ones are hidden to preserve their session. */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {tabs.map((tab) => (
          <TerminalPane
            key={tab.id}
            tab={tab}
            active={tab.id === activeId}
            dockVisible={visible}
            palette={palette}
          />
        ))}
      </div>
    </div>
  );
}
