// Runtime theme system: a commutable "Classic" (the original look) vs "Modern"
// (a refined dark, blue-ink + teal redesign). The split is intentional so the
// classic appearance stays available — and pixel-identical — alongside the new
// one, switchable live from Settings.
//
// HOW IT WORKS
// Almost the entire UI is styled with Tailwind utility classes, and Tailwind v4
// resolves every color/radius/shadow/font through CSS variables. `Modern` simply
// re-points those variables under `:root[data-theme="modern"]` (see index.css),
// so every component re-skins automatically with zero markup changes, while
// `Classic` (no attribute) keeps Tailwind's untouched defaults.
//
// The only exceptions are a few libraries (xterm, xyflow) that paint colors in
// JavaScript, outside Tailwind's variables. For those we expose `palette` below;
// its `classic` values are the exact hex literals those components used before.

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ThemeName = "classic" | "modern";

const THEME_KEY = "gitui.theme";

export function loadTheme(): ThemeName {
  try {
    return localStorage.getItem(THEME_KEY) === "modern" ? "modern" : "classic";
  } catch {
    return "classic";
  }
}

/**
 * Colors painted by libraries (xterm, xyflow) that bypass Tailwind's CSS
 * variables and therefore don't follow the `[data-theme]` override on their own.
 * `classic` reproduces the exact hex values previously hardcoded in those
 * components, so the classic appearance is unchanged.
 */
export type ThemePalette = {
  graphBg: string; // xyflow <Background> dot grid
  graphEdge: string; // stack/commit edge stroke
  graphEdgeAccent: string; // workspace (repo) edge stroke
  graphLabel: string; // edge label text fill
  graphLabelBg: string; // edge label background fill
  termBg: string; // xterm background
  termFg: string; // xterm foreground
  termCursor: string; // xterm cursor
  termSelection: string; // xterm selection background
};

const PALETTE: Record<ThemeName, ThemePalette> = {
  classic: {
    graphBg: "#27272a",
    graphEdge: "#3f3f46",
    graphEdgeAccent: "#4f46e5",
    graphLabel: "#a3a3a3",
    graphLabelBg: "#0a0a0a",
    termBg: "#0a0a0a",
    termFg: "#e5e5e5",
    termCursor: "#e5e5e5",
    termSelection: "rgba(255,255,255,0.3)",
  },
  modern: {
    graphBg: "#1b2230",
    graphEdge: "#2e3749",
    graphEdgeAccent: "#14b8a6",
    graphLabel: "#909cb2",
    graphLabelBg: "#0b0d12",
    termBg: "#0b0d12",
    termFg: "#e8ecf3",
    termCursor: "#2dd4bf",
    termSelection: "rgba(45,212,191,0.24)",
  },
};

type ThemeContextValue = {
  theme: ThemeName;
  isModern: boolean;
  setTheme: (t: ThemeName) => void;
  palette: ThemePalette;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** Reflect the active theme onto <html> so the CSS variable overrides apply. */
export function applyThemeAttribute(theme: ThemeName) {
  const el = document.documentElement;
  el.setAttribute("data-theme", theme);
  el.style.colorScheme = "dark"; // both themes are dark for now
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(loadTheme);

  // Apply before paint to avoid a flash when the theme changes at runtime.
  useLayoutEffect(() => {
    applyThemeAttribute(theme);
  }, [theme]);

  const setTheme = useCallback((t: ThemeName) => {
    setThemeState(t);
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {
      /* ignore quota/availability errors */
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      isModern: theme === "modern",
      setTheme,
      palette: PALETTE[theme],
    }),
    [theme, setTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}

/** Theme-aware colors for libraries that paint outside Tailwind (xterm, xyflow). */
export function useThemePalette(): ThemePalette {
  return useTheme().palette;
}
