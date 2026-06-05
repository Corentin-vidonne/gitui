import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Sparkles, X } from "lucide-react";
import { errorText } from "../lib/api";
import { useThemePalette } from "../lib/theme";

export type AnalyzeTarget =
  | { kind: "commit"; sha: string }
  | { kind: "pr"; number: number }
  | { kind: "merge-branches"; source: string; target: string }
  | { kind: "repo" };

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `term-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

export function TerminalDock({
  repoPath,
  target,
  mode,
  aiName,
  onClose,
}: {
  repoPath: string;
  target: AnalyzeTarget;
  mode: string;
  /** Display name of the active AI engine (Ollama model, or "Claude"). */
  aiName: string;
  onClose: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const [height, setHeight] = useState(360);
  const targetKey =
    target.kind === "commit"
      ? target.sha
      : target.kind === "pr"
      ? `pr-${target.number}`
      : target.kind === "merge-branches"
      ? `merge-${target.source}-${target.target}`
      : "repo";

  // Theme-aware terminal colors. Read via a ref inside the (session-creating)
  // effect so switching theme updates the live terminal without recreating it.
  const palette = useThemePalette();
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

  useEffect(() => {
    const id = newId();
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
    term.loadAddon(fit);
    if (hostRef.current) term.open(hostRef.current);

    const safeFit = () => {
      try {
        fit.fit();
      } catch {
        /* element not laid out yet */
      }
    };
    safeFit();

    let alive = true;
    const unlisteners: Array<() => void> = [];

    const onData = term.onData((d) => {
      invoke("term_write", { id, data: d }).catch(() => {});
    });

    (async () => {
      const offOut = await listen<{ id: string; data: string }>("term-output", (e) => {
        if (e.payload.id === id) term.write(decodeBase64(e.payload.data));
      });
      const offExit = await listen<string>("term-exit", (e) => {
        if (e.payload === id) term.write("\r\n\x1b[90m[session ended]\x1b[0m\r\n");
      });
      unlisteners.push(offOut, offExit);
      if (!alive) {
        offOut();
        offExit();
        return;
      }
      let cmd: string;
      let args: Record<string, unknown>;
      if (target.kind === "commit") {
        cmd = "term_open_analyze";
        args = { id, path: repoPath, sha: target.sha, mode, cols: term.cols, rows: term.rows };
      } else if (target.kind === "merge-branches") {
        // Local branch-to-branch merge assistant (git merge, no PR).
        cmd = "term_open_merge_branches";
        args = {
          id,
          path: repoPath,
          source: target.source,
          target: target.target,
          cols: term.cols,
          rows: term.rows,
        };
      } else if (target.kind === "pr" && mode === "merge") {
        // The PR merge assistant has its own command; it doesn't take a verbosity `mode`.
        cmd = "term_open_merge_assist";
        args = { id, path: repoPath, number: target.number, cols: term.cols, rows: term.rows };
      } else if (target.kind === "pr") {
        cmd = "term_open_analyze_pr";
        args = { id, path: repoPath, number: target.number, mode, cols: term.cols, rows: term.rows };
      } else {
        // "repo" target is chat-only and never reaches the terminal dock.
        return;
      }
      await invoke(cmd, args).catch((err) =>
        term.write(`\r\n\x1b[31m${errorText(err)}\x1b[0m\r\n`)
      );
      term.focus();
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
      invoke("term_close", { id }).catch(() => {});
      term.dispose();
      termRef.current = null;
    };
  }, [repoPath, targetKey, mode]);

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

  const label =
    target.kind === "commit"
      ? `commit ${target.sha.slice(0, 8)} · ${mode}`
      : target.kind === "pr"
      ? `PR #${target.number} · ${mode}`
      : target.kind === "merge-branches"
      ? `merge ${target.source} → ${target.target}`
      : "dépôt";

  return (
    <div
      style={{ height }}
      className="flex shrink-0 flex-col border-t border-neutral-800 bg-neutral-950"
    >
      <div
        onMouseDown={startResize}
        className="h-1 shrink-0 cursor-row-resize bg-neutral-800 transition-colors hover:bg-indigo-600"
      />
      <div className="flex h-9 shrink-0 items-center gap-2 px-3 text-xs text-neutral-300">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
        <span className="font-medium" title={aiName}>
          {aiName}
        </span>
        <span className="truncate font-mono text-neutral-500">{label}</span>
        <button
          onClick={onClose}
          className="ml-auto rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden px-2 pb-2" />
    </div>
  );
}
