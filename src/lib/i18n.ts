// App internationalization (react-i18next). The UI language follows the machine
// locale by default (detected from `navigator.language`) and can be overridden from
// Settings. The four shipped languages are French, English, Spanish and German.
//
// Resources are bundled (imported JSON), so init is synchronous and there is no
// loading flash. `useTranslation()` works app-wide via `initReactI18next` — no
// <I18nextProvider> wrapper is needed.
//
// Git / CLI keywords (merge, restack, submit, rebase, push, commit, …) and proper
// nouns (gitui, Claude, Ollama, Anthropic, GitHub, PR) are intentionally kept
// untranslated inside the catalogs.

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";

import fr from "../locales/fr.json";
import en from "../locales/en.json";
import es from "../locales/es.json";
import de from "../locales/de.json";

export const LANGS = [
  { code: "fr", label: "Français" },
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "de", label: "Deutsch" },
] as const;

export type Lang = (typeof LANGS)[number]["code"];
/** A stored preference: an explicit language, or "auto" (follow the machine). */
export type LangPref = Lang | "auto";

const SUPPORTED: readonly Lang[] = ["fr", "en", "es", "de"];
const LANG_KEY = "gitui.lang";

function isLang(v: unknown): v is Lang {
  return typeof v === "string" && (SUPPORTED as readonly string[]).includes(v);
}

/** The machine's preferred language, mapped to a supported one (English fallback). */
export function detectMachineLang(): Lang {
  const cands = [...(navigator.languages ?? []), navigator.language].filter(
    (l): l is string => typeof l === "string" && l.length > 0
  );
  for (const c of cands) {
    const base = c.slice(0, 2).toLowerCase();
    if (isLang(base)) return base;
  }
  return "en";
}

/** Read the persisted preference ("auto" if unset/invalid). */
export function loadLangPref(): LangPref {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (v === "auto" || isLang(v)) return v;
  } catch {
    /* storage unavailable */
  }
  return "auto";
}

/** Resolve a preference to a concrete language. */
export function resolveLang(pref: LangPref): Lang {
  return pref === "auto" ? detectMachineLang() : pref;
}

/** Tell the Rust backend which language to write Claude prompts in (best-effort). */
export function syncBackendLang(lang: Lang): void {
  invoke("set_ui_language", { lang }).catch(() => {
    /* the command may not be ready yet at very first paint; harmless */
  });
}

const initialPref = loadLangPref();
const initialLang = resolveLang(initialPref);

void i18n.use(initReactI18next).init({
  resources: {
    fr: { translation: fr },
    en: { translation: en },
    es: { translation: es },
    de: { translation: de },
  },
  lng: initialLang,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  returnNull: false,
});

document.documentElement.lang = initialLang;
syncBackendLang(initialLang);

/**
 * Persist a language preference ("auto" or an explicit code), apply it live across
 * the UI, reflect it on <html lang>, and push it to the backend so AI prompts follow.
 */
export function setLangPref(pref: LangPref): void {
  try {
    localStorage.setItem(LANG_KEY, pref);
  } catch {
    /* ignore */
  }
  const lang = resolveLang(pref);
  void i18n.changeLanguage(lang);
  document.documentElement.lang = lang;
  syncBackendLang(lang);
}

export default i18n;
