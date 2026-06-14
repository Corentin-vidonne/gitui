import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { listen } from "@tauri-apps/api/event";
import { TerminalSquare, X, Trash2, Loader2 } from "lucide-react";

/** Mirrors the Rust `cmdlog::CommandEvent` (camelCase over IPC). One command is emitted
 * twice: `running: true` when it starts, then `running: false` with the outcome. */
type CommandEvent = {
  id: number;
  running: boolean;
  program: string;
  args: string[];
  cwd: string | null;
  startedMs: number;
  durationMs: number | null;
  exitCode: number | null;
  success: boolean | null;
  error: string | null;
};

/** Internal git config the `git()` wrapper injects on every call — pure plumbing, hidden
 * from the displayed command line (the raw command is still kept in the row's tooltip). */
const HIDDEN_GIT_CONFIG = new Set(["protocol.ext.allow=never", "core.pager=cat"]);

const MAX_ROWS = 300;

/** The args portion, with the wrapper's `-c <plumbing>` pairs removed and any token that
 * contains whitespace quoted (commit messages, AI prompts…). */
function prettyArgs(program: string, args: string[]): string {
  const parts: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (program === "git" && args[i] === "-c" && HIDDEN_GIT_CONFIG.has(args[i + 1] ?? "")) {
      i++; // skip the `-c` flag and its value
      continue;
    }
    parts.push(args[i]);
  }
  return parts.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ");
}

function clock(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString();
  } catch {
    return "";
  }
}

function durationText(ms: number | null): string {
  if (ms == null) return "";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`;
}

function Row({ ev }: { ev: CommandEvent }) {
  const argLine = prettyArgs(ev.program, ev.args);
  const raw = [ev.program, ...ev.args].join(" ");
  const failed = ev.success === false;
  const tooltip = ev.cwd ? `${raw}\n${ev.cwd}` : raw;
  return (
    <div
      title={tooltip}
      className="flex items-baseline gap-2 border-b border-neutral-900/70 py-0.5"
    >
      <span className="flex w-3 shrink-0 translate-y-px justify-center">
        {ev.running ? (
          <Loader2 className="h-3 w-3 animate-spin text-indigo-400" />
        ) : (
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              failed ? "bg-red-500" : "bg-emerald-500"
            }`}
          />
        )}
      </span>
      <span className={`min-w-0 flex-1 truncate ${failed ? "text-red-300" : "text-neutral-300"}`}>
        <span className="text-neutral-500">{ev.program}</span>{" "}
        {argLine}
      </span>
      {failed && ev.exitCode != null && (
        <span className="shrink-0 text-red-400">exit {ev.exitCode}</span>
      )}
      <span className="shrink-0 text-neutral-600">{durationText(ev.durationMs)}</span>
      <span className="hidden shrink-0 text-neutral-700 sm:inline">{clock(ev.startedMs)}</span>
    </div>
  );
}

/** A read-only bottom dock that streams the *mutating* git/gh commands the app runs (the
 * `git rebase` behind a Restack, the `gh pr create` behind a Submit, …). It's opt-in: when
 * closed (the default) nothing is shown — the regular UX is untouched. Read-only polling
 * (`git status`, `gh pr list`, …) is filtered out on the Rust side. */
export function CommandLogDock({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<CommandEvent[]>([]);
  const [height, setHeight] = useState(260);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Only auto-scroll when the user is already pinned to the bottom (don't yank them up
  // while they're reading earlier rows).
  const stickRef = useRef(true);

  useEffect(() => {
    let alive = true;
    let off: (() => void) | undefined;
    (async () => {
      const unlisten = await listen<CommandEvent>("command-log", (e) => {
        const ev = e.payload;
        setItems((prev) => {
          const i = prev.findIndex((p) => p.id === ev.id);
          if (i !== -1) {
            const copy = prev.slice();
            copy[i] = ev; // started → finished upsert
            return copy;
          }
          const next = [...prev, ev];
          return next.length > MAX_ROWS ? next.slice(next.length - MAX_ROWS) : next;
        });
      });
      if (!alive) unlisten();
      else off = unlisten;
    })();
    return () => {
      alive = false;
      off?.();
    };
  }, []);

  useEffect(() => {
    if (stickRef.current && scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight });
    }
  }, [items]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  }

  function startResize(e: ReactMouseEvent) {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    const onMove = (ev: MouseEvent) =>
      setHeight(
        Math.min(window.innerHeight * 0.8, Math.max(140, startH - (ev.clientY - startY)))
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
    <div
      style={{ height }}
      className="flex shrink-0 flex-col border-t border-neutral-800 bg-neutral-950"
    >
      <div
        onMouseDown={startResize}
        className="h-1 shrink-0 cursor-row-resize bg-neutral-800 transition-colors hover:bg-indigo-600"
      />
      <div className="flex h-9 shrink-0 items-center gap-2 px-3 text-xs text-neutral-300">
        <TerminalSquare className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
        <span className="font-medium">Journal des commandes</span>
        {items.length > 0 && <span className="font-mono text-neutral-600">{items.length}</span>}
        <span className="hidden truncate text-neutral-600 md:inline">
          commandes git / gh exécutées par l'app
        </span>
        <button
          onClick={() => setItems([])}
          disabled={items.length === 0}
          title="Vider le journal"
          className="ml-auto rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-30"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onClose}
          title="Fermer"
          className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-auto px-3 py-1.5 font-mono text-[11px] leading-relaxed"
      >
        {items.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-center font-sans text-xs text-neutral-600">
            Aucune commande pour l'instant. Lance une action (restack, sync, submit…) — les
            commandes git/gh exécutées apparaîtront ici.
          </div>
        ) : (
          items.map((it) => <Row key={it.id} ev={it} />)
        )}
      </div>
    </div>
  );
}
