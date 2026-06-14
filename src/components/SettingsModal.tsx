import { useEffect, useState } from "react";
import {
  Check,
  HelpCircle,
  Wrench,
  Cloud,
  Server,
  RefreshCw,
  X,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import type { Settings } from "../lib/settings";
import { useTheme, type ThemeName } from "../lib/theme";
import { api, errorText } from "../lib/api";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  LANGS,
  loadLangPref,
  setLangPref,
  detectMachineLang,
  type LangPref,
} from "../lib/i18n";

// Live preview swatches per theme: [background, surface/border, accent]. These
// are intentionally literal hex values — they illustrate each theme's palette.
const THEME_OPTIONS = (
  t: TFunction
): {
  value: ThemeName;
  label: string;
  hint: string;
  swatch: [string, string, string];
}[] => [
  {
    value: "classic",
    label: t("settingsModal.themes.classic.label"),
    hint: t("settingsModal.themes.classic.hint"),
    swatch: ["#0a0a0a", "#262626", "#4f46e5"],
  },
  {
    value: "modern",
    label: t("settingsModal.themes.modern.label"),
    hint: t("settingsModal.themes.modern.hint"),
    swatch: ["#0b0d12", "#232a38", "#14b8a6"],
  },
];

const TABS = (t: TFunction) =>
  [
    { id: "general", label: t("settingsModal.tabs.general"), Icon: SlidersHorizontal },
    { id: "ai", label: t("settingsModal.tabs.ai"), Icon: Sparkles },
    { id: "about", label: t("settingsModal.tabs.about"), Icon: HelpCircle },
  ] as const;
type TabId = ReturnType<typeof TABS>[number]["id"];

export function SettingsModal({
  settings,
  onSave,
  onClose,
  onOpenHelp,
  onOpenDeps,
}: {
  settings: Settings;
  onSave: (s: Settings) => void;
  onClose: () => void;
  onOpenHelp: () => void;
  onOpenDeps: () => void;
}) {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const [tab, setTab] = useState<TabId>("general");
  // Language applies live (like the theme), independently of Save.
  const [langPref, setLangPrefState] = useState<LangPref>(loadLangPref);
  const tabs = TABS(t);
  const themeOptions = THEME_OPTIONS(t);
  const detectedLabel =
    LANGS.find((l) => l.code === detectMachineLang())?.label ?? "English";

  function changeLang(pref: LangPref) {
    setLangPrefState(pref);
    setLangPref(pref); // persists, applies live, and syncs the backend prompt language
  }

  const [pollSec, setPollSec] = useState(Math.round(settings.pollIntervalMs / 1000));
  const [notifications, setNotifications] = useState(settings.notifications);
  const [assistantUi, setAssistantUi] = useState(settings.assistantUi);
  const [chatStreaming, setChatStreaming] = useState(settings.chatStreaming);
  const [aiBackend, setAiBackend] = useState(settings.aiBackend);
  const [ollamaHost, setOllamaHost] = useState(settings.ollamaHost);
  const [ollamaModel, setOllamaModel] = useState(settings.ollamaModel);
  const [anthropicModel, setAnthropicModel] = useState(settings.anthropicModel);
  const [models, setModels] = useState<string[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [detectErr, setDetectErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function detectModels() {
    setDetecting(true);
    setDetectErr(null);
    try {
      const list = await api.ollamaModels(ollamaHost);
      setModels(list);
      if (list.length && !list.includes(ollamaModel)) setOllamaModel(list[0]);
      if (!list.length)
        setDetectErr(t("settingsModal.ai.ollama.noModels"));
    } catch (e) {
      setModels([]);
      setDetectErr(errorText(e));
    } finally {
      setDetecting(false);
    }
  }

  // Auto-detect the first time the user switches to Ollama (skip if already tried).
  useEffect(() => {
    if (aiBackend === "ollama" && models.length === 0 && !detectErr && !detecting) {
      void detectModels();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiBackend]);

  function save() {
    const sec = Math.max(30, Number.isFinite(pollSec) ? pollSec : 180);
    onSave({
      pollIntervalMs: sec * 1000,
      notifications,
      assistantUi,
      chatStreaming,
      aiBackend,
      ollamaHost: ollamaHost.trim() || "http://localhost:11434",
      ollamaModel: ollamaModel.trim(),
      anthropicModel: anthropicModel.trim(),
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4">
          <h2 className="text-sm font-semibold text-neutral-100">{t("settingsModal.title")}</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="mt-2 flex gap-1 border-b border-neutral-800 px-3">
          {tabs.map((tabItem) => (
            <button
              key={tabItem.id}
              type="button"
              onClick={() => setTab(tabItem.id)}
              className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
                tab === tabItem.id
                  ? "border-indigo-500 text-neutral-100"
                  : "border-transparent text-neutral-500 hover:text-neutral-300"
              }`}
            >
              <tabItem.Icon className="h-3.5 w-3.5" /> {tabItem.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 space-y-4 overflow-auto px-5 py-4">
          {tab === "general" && (
            <>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-neutral-300">
                  {t("settingsModal.general.language")}
                </label>
                <select
                  value={langPref}
                  onChange={(e) => changeLang(e.target.value as LangPref)}
                  className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-indigo-600"
                >
                  <option value="auto">
                    {t("settingsModal.general.languageAuto", { lang: detectedLabel })}
                  </option>
                  {LANGS.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[10px] text-neutral-500">
                  {t("settingsModal.general.languageHint")}
                </p>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-neutral-300">
                  {t("settingsModal.general.appearance")}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {themeOptions.map((opt) => {
                    const active = theme === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setTheme(opt.value)}
                        className={`relative rounded-lg border px-3 py-2.5 text-left transition-colors ${
                          active
                            ? "border-indigo-500 bg-indigo-950/40 ring-1 ring-indigo-500/40"
                            : "border-neutral-700 hover:border-neutral-600 hover:bg-neutral-800/40"
                        }`}
                      >
                        {active && (
                          <Check className="absolute right-2 top-2 h-3.5 w-3.5 text-indigo-300" />
                        )}
                        <div className="mb-1.5 flex gap-1">
                          {opt.swatch.map((c) => (
                            <span
                              key={c}
                              className="h-3.5 w-3.5 rounded-full ring-1 ring-black/40"
                              style={{ backgroundColor: c }}
                            />
                          ))}
                        </div>
                        <div className="text-sm font-medium text-neutral-100">{opt.label}</div>
                        <div className="text-[10px] text-neutral-500">{opt.hint}</div>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1 text-[10px] text-neutral-500">
                  {t("settingsModal.general.appearanceHint")}
                </p>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-300">
                  {t("settingsModal.general.pollInterval")}
                </label>
                <input
                  type="number"
                  min={30}
                  step={30}
                  value={pollSec}
                  onChange={(e) => setPollSec(parseInt(e.target.value, 10))}
                  className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-indigo-600"
                />
                <p className="mt-1 text-[10px] text-neutral-500">
                  {t("settingsModal.general.pollIntervalHint")}
                </p>
              </div>

              <label className="flex items-center gap-2 text-sm text-neutral-300">
                <input
                  type="checkbox"
                  checked={notifications}
                  onChange={(e) => setNotifications(e.target.checked)}
                  className="accent-indigo-600"
                />
                {t("settingsModal.general.notifications")}
              </label>
            </>
          )}

          {tab === "ai" && (
            <>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-neutral-300">
                  {t("settingsModal.ai.assistantUi.label")}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { value: "chat", label: t("settingsModal.ai.assistantUi.chat"), hint: t("settingsModal.ai.assistantUi.chatHint") },
                      { value: "terminal", label: t("settingsModal.ai.assistantUi.terminal"), hint: t("settingsModal.ai.assistantUi.terminalHint") },
                    ] as const
                  ).map((opt) => {
                    const active = assistantUi === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setAssistantUi(opt.value)}
                        className={`relative rounded-lg border px-3 py-2.5 text-left transition-colors ${
                          active
                            ? "border-indigo-500 bg-indigo-950/40 ring-1 ring-indigo-500/40"
                            : "border-neutral-700 hover:border-neutral-600 hover:bg-neutral-800/40"
                        }`}
                      >
                        {active && (
                          <Check className="absolute right-2 top-2 h-3.5 w-3.5 text-indigo-300" />
                        )}
                        <div className="text-sm font-medium text-neutral-100">{opt.label}</div>
                        <div className="text-[10px] text-neutral-500">{opt.hint}</div>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1 text-[10px] text-neutral-500">
                  {t("settingsModal.ai.assistantUi.hint")}
                </p>
              </div>

              <label
                className={`flex items-center gap-2 text-sm ${
                  assistantUi === "chat" ? "text-neutral-300" : "text-neutral-600"
                }`}
              >
                <input
                  type="checkbox"
                  checked={chatStreaming}
                  disabled={assistantUi !== "chat"}
                  onChange={(e) => setChatStreaming(e.target.checked)}
                  className="accent-indigo-600"
                />
                {t("settingsModal.ai.chatStreaming")}
              </label>

              {/* AI backend: Anthropic cloud vs local Ollama (both drive the `claude` CLI). */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-neutral-300">
                  {t("settingsModal.ai.backend.label")}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { value: "anthropic", label: t("settingsModal.ai.backend.anthropic"), hint: t("settingsModal.ai.backend.anthropicHint"), Icon: Cloud },
                      { value: "ollama", label: t("settingsModal.ai.backend.ollama"), hint: t("settingsModal.ai.backend.ollamaHint"), Icon: Server },
                    ] as const
                  ).map((opt) => {
                    const active = aiBackend === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setAiBackend(opt.value)}
                        className={`relative rounded-lg border px-3 py-2.5 text-left transition-colors ${
                          active
                            ? "border-indigo-500 bg-indigo-950/40 ring-1 ring-indigo-500/40"
                            : "border-neutral-700 hover:border-neutral-600 hover:bg-neutral-800/40"
                        }`}
                      >
                        {active && (
                          <Check className="absolute right-2 top-2 h-3.5 w-3.5 text-indigo-300" />
                        )}
                        <div className="flex items-center gap-1.5 text-sm font-medium text-neutral-100">
                          <opt.Icon className="h-3.5 w-3.5" /> {opt.label}
                        </div>
                        <div className="text-[10px] text-neutral-500">{opt.hint}</div>
                      </button>
                    );
                  })}
                </div>

                {aiBackend === "anthropic" && (
                  <div className="mt-2 space-y-2 rounded-lg border border-neutral-800 bg-neutral-900/60 p-2.5">
                    <div>
                      <label className="mb-1 block text-[11px] text-neutral-400">{t("settingsModal.ai.model")}</label>
                      <input
                        list="anthropic-models"
                        value={anthropicModel}
                        onChange={(e) => setAnthropicModel(e.target.value)}
                        placeholder={t("settingsModal.ai.anthropic.modelPlaceholder")}
                        className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-100 outline-none focus:border-indigo-600"
                      />
                      <datalist id="anthropic-models">
                        <option value="sonnet" />
                        <option value="opus" />
                        <option value="haiku" />
                        <option value="opusplan" />
                      </datalist>
                    </div>
                    <p className="text-[10px] leading-relaxed text-neutral-500">
                      {t("settingsModal.ai.anthropic.modelHintPre")}{" "}
                      <code className="text-neutral-400">sonnet</code>,{" "}
                      <code className="text-neutral-400">opus</code>,{" "}
                      <code className="text-neutral-400">haiku</code>
                      {t("settingsModal.ai.anthropic.modelHintPost")}
                    </p>
                  </div>
                )}

                {aiBackend === "ollama" && (
                  <div className="mt-2 space-y-2 rounded-lg border border-neutral-800 bg-neutral-900/60 p-2.5">
                    <div>
                      <label className="mb-1 block text-[11px] text-neutral-400">{t("settingsModal.ai.ollama.host")}</label>
                      <input
                        value={ollamaHost}
                        onChange={(e) => setOllamaHost(e.target.value)}
                        placeholder="http://localhost:11434"
                        className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-100 outline-none focus:border-indigo-600"
                      />
                    </div>
                    <div>
                      <div className="mb-1 flex items-center justify-between">
                        <label className="text-[11px] text-neutral-400">{t("settingsModal.ai.model")}</label>
                        <button
                          type="button"
                          onClick={detectModels}
                          disabled={detecting}
                          className="inline-flex items-center gap-1 rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
                        >
                          <RefreshCw className={`h-3 w-3 ${detecting ? "animate-spin" : ""}`} />
                          {t("settingsModal.ai.ollama.detect")}
                        </button>
                      </div>
                      <input
                        list="ollama-models"
                        value={ollamaModel}
                        onChange={(e) => setOllamaModel(e.target.value)}
                        placeholder="qwen3-coder:latest"
                        className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-100 outline-none focus:border-indigo-600"
                      />
                      <datalist id="ollama-models">
                        {models.map((m) => (
                          <option key={m} value={m} />
                        ))}
                      </datalist>
                      {detectErr ? (
                        <p className="mt-1 text-[10px] text-amber-400">{detectErr}</p>
                      ) : models.length > 0 ? (
                        <p className="mt-1 text-[10px] text-neutral-500">
                          {t("settingsModal.ai.ollama.detected", { count: models.length })}
                        </p>
                      ) : null}
                    </div>
                    <p className="text-[10px] leading-relaxed text-neutral-500">
                      {t("settingsModal.ai.ollama.hintPre")}{" "}
                      <code className="text-neutral-400">claude</code>
                      {t("settingsModal.ai.ollama.hintMid")}{" "}
                      <code className="text-neutral-400">ollama pull qwen3-coder</code>
                      {t("settingsModal.ai.ollama.hintMid2")}{" "}
                      <code className="text-neutral-400">ollama launch claude</code>
                      {t("settingsModal.ai.ollama.hintMid3")}{" "}
                      <code className="text-neutral-400">:cloud</code>
                      {t("settingsModal.ai.ollama.hintPost")}
                    </p>
                  </div>
                )}
              </div>
            </>
          )}

          {tab === "about" && (
            <>
              <p className="text-xs text-neutral-400">
                {t("settingsModal.about.intro")}
              </p>
              <button
                onClick={onOpenHelp}
                className="flex w-full items-center gap-2 rounded-lg border border-indigo-700/60 bg-indigo-950/30 px-3 py-2 text-sm text-indigo-200 hover:bg-indigo-950/50"
              >
                <HelpCircle className="h-4 w-4 shrink-0" />
                {t("settingsModal.about.help")}
              </button>
              <button
                onClick={onOpenDeps}
                className="flex w-full items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-800/40 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800"
              >
                <Wrench className="h-4 w-4 shrink-0" />
                {t("settingsModal.about.checkTools")}
              </button>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-neutral-800 px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-neutral-400 hover:bg-neutral-800"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={save}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
          >
            {t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
