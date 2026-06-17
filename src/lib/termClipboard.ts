import type { Terminal } from "@xterm/xterm";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";

const isMac =
  typeof navigator !== "undefined" && /mac/i.test(navigator.platform || "");

/**
 * Wire terminal-style copy/paste into an xterm instance, using the Tauri clipboard plugin so
 * it works uniformly across Windows/macOS/Linux webviews (where `navigator.clipboard.readText`
 * is unreliable). Bindings:
 *   - Copy: Ctrl/⌘+Shift+C; Ctrl/⌘+C *with a selection* (plain Ctrl+C with none → SIGINT); Ctrl+Insert.
 *   - Paste: Ctrl/⌘+Shift+V; Ctrl/⌘+V; Shift+Insert.
 * Paste goes through `term.paste()` so bracketed-paste mode is honored. xterm allows a single
 * custom key handler; the integrated/AI terminals set no other, so this is safe.
 */
export function attachClipboard(term: Terminal): void {
  term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
    if (e.type !== "keydown") return true;
    const accel = isMac ? e.metaKey : e.ctrlKey;

    // Copy.
    if ((accel && e.code === "KeyC") || (e.ctrlKey && e.code === "Insert")) {
      const sel = term.getSelection();
      const wantCopy = e.shiftKey || e.code === "Insert" || !!sel;
      if (wantCopy) {
        if (sel) void writeText(sel).catch(() => {});
        e.preventDefault();
        return false;
      }
      return true; // plain Ctrl+C with no selection → let SIGINT through
    }

    // Paste.
    if ((accel && e.code === "KeyV") || (e.shiftKey && e.code === "Insert")) {
      e.preventDefault();
      void readText()
        .then((txt) => {
          if (txt) term.paste(txt);
        })
        .catch(() => {});
      return false;
    }

    return true;
  });
}
