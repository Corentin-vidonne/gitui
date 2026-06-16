import { useEffect, useMemo, useState } from "react";
import { Minus, Square, Copy, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTranslation } from "react-i18next";

// On macOS we keep the native traffic-light buttons (the window uses
// `titleBarStyle: "Overlay"`, so they float over the top-left of our themed strip) and
// render no controls of our own. Windows and Linux run undecorated, so we draw the
// minimize / maximize / close buttons on the right.
const IS_MAC = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);

/**
 * Theme-matched window title bar that replaces the OS-native one. Only the empty filler
 * carries `data-tauri-drag-region` (so the window drags from the bar but never from the
 * control buttons); double-clicking it toggles maximize, handled natively by Tauri.
 * Sits above modals (z-60) so the window controls stay reachable.
 */
export function TitleBar() {
  const { t } = useTranslation();
  // `getCurrentWindow()` reads Tauri internals; guard so a plain browser tab (vite dev
  // without the webview) still renders the bar instead of crashing the whole app.
  const appWindow = useMemo(() => {
    try {
      return getCurrentWindow();
    } catch {
      return null;
    }
  }, []);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!appWindow) return;
    let unlisten: (() => void) | undefined;
    const sync = () => appWindow.isMaximized().then(setMaximized).catch(() => {});
    sync();
    appWindow
      .onResized(sync)
      .then((u) => {
        unlisten = u;
      })
      .catch(() => {});
    return () => unlisten?.();
  }, [appWindow]);

  const minimize = () => appWindow?.minimize().catch(() => {});
  const toggleMaximize = () =>
    appWindow
      ?.toggleMaximize()
      .then(() => appWindow.isMaximized().then(setMaximized))
      .catch(() => {});
  const close = () => appWindow?.close().catch(() => {});

  const btn =
    "inline-flex h-full w-12 items-center justify-center text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100";

  return (
    <div className="relative z-[60] flex h-9 shrink-0 select-none items-stretch border-b border-neutral-800 bg-neutral-950">
      {/* Draggable region. Decorative (no buttons), so the whole strip drags the window
          except over the controls; double-click maximizes. */}
      <div data-tauri-drag-region className="flex-1" />

      {/* Windows / Linux controls; macOS uses its native traffic lights. */}
      {!IS_MAC && (
        <div className="flex items-stretch">
          <button
            type="button"
            onClick={minimize}
            title={t("titleBar.minimize")}
            aria-label={t("titleBar.minimize")}
            className={btn}
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={toggleMaximize}
            title={maximized ? t("titleBar.restore") : t("titleBar.maximize")}
            aria-label={maximized ? t("titleBar.restore") : t("titleBar.maximize")}
            className={btn}
          >
            {maximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={close}
            title={t("titleBar.close")}
            aria-label={t("titleBar.close")}
            className="inline-flex h-full w-12 items-center justify-center text-neutral-400 transition-colors hover:bg-red-600 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
