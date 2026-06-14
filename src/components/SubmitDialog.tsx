import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles, Loader2 } from "lucide-react";
import { Modal } from "./Modal";
import { api, errorText } from "../lib/api";
import type { RepoView, SubmitStepInfo } from "../lib/types";

export function SubmitDialog({
  repoPath,
  onDone,
  onClose,
}: {
  repoPath: string;
  onDone: (view: RepoView, summary: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [steps, setSteps] = useState<SubmitStepInfo[] | null>(null);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bodies, setBodies] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  async function generate(branch: string) {
    setGenerating(branch);
    setGenError(null);
    try {
      const d = await api.generatePrDescription(repoPath, branch);
      if (d.title) setTitles((t) => ({ ...t, [branch]: d.title }));
      setBodies((b) => ({ ...b, [branch]: d.body }));
    } catch (e) {
      setGenError(errorText(e));
    } finally {
      setGenerating(null);
    }
  }

  useEffect(() => {
    let alive = true;
    api
      .submitPlan(repoPath, null)
      .then((s) => {
        if (!alive) return;
        setSteps(s);
        const t: Record<string, string> = {};
        s.forEach((st) => {
          if (st.action === "create") t[st.branch] = st.defaultTitle;
        });
        setTitles(t);
      })
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [repoPath]);

  const creates = steps?.filter((s) => s.action === "create").length ?? 0;
  const updates = steps?.filter((s) => s.action === "update").length ?? 0;

  async function confirm() {
    setSubmitting(true);
    setError(null);
    try {
      const view = await api.submit(repoPath, null, draft, titles, bodies);
      const parts = [];
      if (creates) parts.push(t("submitDialog.summary.created", { count: creates }));
      if (updates) parts.push(t("submitDialog.summary.updated", { count: updates }));
      onDone(view, parts.join(", ") || t("submitDialog.summary.submitted"));
    } catch (e) {
      setError(errorText(e));
      setSubmitting(false);
    }
  }

  const badge = (action: string) =>
    action === "create"
      ? "bg-emerald-950/50 text-emerald-300"
      : action === "update"
      ? "bg-amber-950/50 text-amber-300"
      : "bg-neutral-800 text-neutral-400";

  return (
    <Modal title={t("submitDialog.title")} onClose={onClose}>
      {steps === null && !error && (
        <p className="text-sm text-neutral-500">{t("submitDialog.loadingPlan")}</p>
      )}
      {error && (
        <div className="mb-3 rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}
      {steps && steps.length === 0 && (
        <p className="text-sm text-neutral-500">{t("submitDialog.nothingToSubmit")}</p>
      )}
      {steps && steps.length > 0 && (
        <div className="space-y-3">
          <div className="max-h-72 space-y-2 overflow-auto">
            {steps.map((s) => (
              <div key={s.branch} className="rounded-md border border-neutral-800 p-2">
                <div className="flex min-w-0 items-center gap-2 text-xs">
                  <span className="truncate font-mono text-neutral-200">{s.branch}</span>
                  <span className="shrink-0 text-neutral-500">→ {s.base}</span>
                  <span className={`ml-auto shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] ${badge(s.action)}`}>
                    {s.action === "create"
                      ? t("submitDialog.badge.newPr")
                      : s.action === "update"
                      ? t("submitDialog.badge.updateBase")
                      : t("submitDialog.badge.upToDate")}
                  </span>
                </div>
                {s.action === "create" && (
                  <div className="mt-1.5 space-y-1.5">
                    <div className="flex gap-2">
                      <input
                        value={titles[s.branch] ?? ""}
                        onChange={(e) =>
                          setTitles((t) => ({ ...t, [s.branch]: e.target.value }))
                        }
                        placeholder={t("submitDialog.prTitlePlaceholder")}
                        className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100 outline-none focus:border-indigo-600"
                      />
                      <button
                        type="button"
                        onClick={() => generate(s.branch)}
                        disabled={generating === s.branch}
                        title={t("submitDialog.describeTitle")}
                        className="inline-flex shrink-0 items-center gap-1 rounded border border-indigo-700 px-2 text-[11px] text-indigo-300 hover:bg-indigo-950/40 disabled:opacity-50"
                      >
                        {generating === s.branch ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Sparkles className="h-3 w-3" />
                        )}
                        {t("submitDialog.describe")}
                      </button>
                    </div>
                    <textarea
                      value={bodies[s.branch] ?? ""}
                      onChange={(e) =>
                        setBodies((b) => ({ ...b, [s.branch]: e.target.value }))
                      }
                      rows={3}
                      placeholder={t("submitDialog.prBodyPlaceholder")}
                      className="w-full resize-y rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-300 outline-none focus:border-indigo-600"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          {genError && (
            <div className="rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-300">
              {genError}
            </div>
          )}

          <label className="flex items-center gap-2 text-xs text-neutral-300">
            <input
              type="checkbox"
              checked={draft}
              onChange={(e) => setDraft(e.target.checked)}
            />
            {t("submitDialog.createAsDraft")}
          </label>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm text-neutral-400 hover:bg-neutral-800"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={confirm}
              disabled={submitting || (creates === 0 && updates === 0)}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {submitting ? t("submitDialog.submitting") : "Submit"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
