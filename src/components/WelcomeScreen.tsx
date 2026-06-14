import { useState } from "react";
import { useTranslation } from "react-i18next";
import { safeOpen } from "../lib/safeOpen";
import {
  Layers,
  Sparkles,
  Cloud,
  Server,
  ExternalLink,
  RefreshCw,
  Search,
} from "lucide-react";

const CLAUDE_DOCS = "https://docs.claude.com/en/docs/claude-code/setup";
const OLLAMA_DOWNLOAD = "https://ollama.com/download";

const FEATURES = (t: (key: string) => string): { Icon: typeof Layers; title: string; desc: string }[] => [
  {
    Icon: Layers,
    title: t("welcomeScreen.features.stack.title"),
    desc: t("welcomeScreen.features.stack.desc"),
  },
  {
    Icon: RefreshCw,
    title: t("welcomeScreen.features.restack.title"),
    desc: t("welcomeScreen.features.restack.desc"),
  },
  {
    Icon: Sparkles,
    title: t("welcomeScreen.features.ai.title"),
    desc: t("welcomeScreen.features.ai.desc"),
  },
  {
    Icon: Search,
    title: t("welcomeScreen.features.daily.title"),
    desc: t("welcomeScreen.features.daily.desc"),
  },
];

/** First-launch welcome: a short multi-step intro to what gitui does, ending on the AI
 * engine choice (install Claude Code or Ollama). Calls `onFinish(true)` to chain into the
 * interactive tour, or `onFinish(false)` when skipped. */
export function WelcomeScreen({ onFinish }: { onFinish: (startTour: boolean) => void }) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const TOTAL = 3;
  const last = step === TOTAL - 1;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4">
      <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-900 shadow-2xl">
        <div className="min-h-[296px] px-7 pb-3 pt-8">
          {step === 0 && (
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600/20 ring-1 ring-indigo-500/40">
                <Layers className="h-7 w-7 text-indigo-300" />
              </div>
              <h2 className="text-lg font-semibold text-neutral-100">{t("welcomeScreen.intro.title")}</h2>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-neutral-400">
                {t("welcomeScreen.intro.lead1")}{" "}
                <strong className="text-neutral-200">{t("welcomeScreen.intro.leadStrong1")}</strong>{" "}
                {t("welcomeScreen.intro.lead2")}{" "}
                <strong className="text-neutral-200">restack</strong>{" "}
                {t("welcomeScreen.intro.lead3")}
              </p>
            </div>
          )}

          {step === 1 && (
            <div>
              <h2 className="mb-3 text-lg font-semibold text-neutral-100">
                {t("welcomeScreen.features.heading")}
              </h2>
              <ul className="space-y-3">
                {FEATURES(t).map((f) => (
                  <li key={f.title} className="flex gap-3">
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-neutral-800 ring-1 ring-neutral-700">
                      <f.Icon className="h-4 w-4 text-indigo-300" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-neutral-200">{f.title}</div>
                      <div className="text-[11px] leading-relaxed text-neutral-500">{f.desc}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {step === 2 && (
            <div>
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-indigo-300" />
                <h2 className="text-lg font-semibold text-neutral-100">{t("welcomeScreen.ai.heading")}</h2>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-neutral-400">
                {t("welcomeScreen.ai.lead1")}{" "}
                <strong className="text-neutral-200">Claude Code</strong>. {t("welcomeScreen.ai.lead2")}
              </p>

              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-3 rounded-lg border border-neutral-700 bg-neutral-800/40 p-3">
                  <Cloud className="h-5 w-5 shrink-0 text-indigo-300" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-neutral-100">{t("welcomeScreen.ai.claude.title")}</div>
                    <div className="text-[11px] text-neutral-500">
                      {t("welcomeScreen.ai.claude.desc")}
                    </div>
                  </div>
                  <button
                    onClick={() => safeOpen(CLAUDE_DOCS)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-indigo-500"
                  >
                    {t("welcomeScreen.ai.install")} <ExternalLink className="h-3 w-3" />
                  </button>
                </div>

                <div className="flex items-center gap-3 rounded-lg border border-neutral-700 bg-neutral-800/40 p-3">
                  <Server className="h-5 w-5 shrink-0 text-emerald-300" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-neutral-100">{t("welcomeScreen.ai.ollama.title")}</div>
                    <div className="text-[11px] text-neutral-500">
                      {t("welcomeScreen.ai.ollama.desc")}
                    </div>
                  </div>
                  <button
                    onClick={() => safeOpen(OLLAMA_DOWNLOAD)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-emerald-500"
                  >
                    {t("welcomeScreen.ai.install")} <ExternalLink className="h-3 w-3" />
                  </button>
                </div>
              </div>

              <p className="mt-2.5 text-[11px] leading-relaxed text-neutral-500">
                {t("welcomeScreen.ai.note1")}{" "}
                <strong className="text-neutral-400">{t("welcomeScreen.ai.noteSettings")}</strong>{" "}
                {t("welcomeScreen.ai.note2")}
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-neutral-800 px-7 py-3">
          <button
            onClick={() => onFinish(false)}
            className="text-xs text-neutral-500 hover:text-neutral-300"
          >
            {t("welcomeScreen.nav.skip")}
          </button>
          <div className="flex items-center gap-1.5">
            {Array.from({ length: TOTAL }).map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === step ? "w-4 bg-indigo-400" : "w-1.5 bg-neutral-700"
                }`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {step > 0 && (
              <button
                onClick={() => setStep(step - 1)}
                className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800"
              >
                {t("welcomeScreen.nav.previous")}
              </button>
            )}
            {last ? (
              <button
                onClick={() => onFinish(true)}
                className="rounded-md bg-indigo-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
              >
                {t("welcomeScreen.nav.startTour")}
              </button>
            ) : (
              <button
                onClick={() => setStep(step + 1)}
                className="rounded-md bg-indigo-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
              >
                {t("welcomeScreen.nav.next")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
