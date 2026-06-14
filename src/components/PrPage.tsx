import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Sparkles,
  ExternalLink,
  GitPullRequest,
  GitMerge,
  ShieldCheck,
  Loader2,
  Check,
  X,
  MessageSquare,
  AlertTriangle,
} from "lucide-react";
import { safeOpen } from "../lib/safeOpen";
import type { CheckRun, PrDetail, PrReview, RepoView } from "../lib/types";

type MergeMethod = "squash" | "merge" | "rebase";
const MERGE_METHODS = (
  t: (k: string) => string
): { id: MergeMethod; label: string; hint: string }[] => [
  { id: "squash", label: t("prPage.merge.methods.squash.label"), hint: t("prPage.merge.methods.squash.hint") },
  { id: "merge", label: t("prPage.merge.methods.merge.label"), hint: t("prPage.merge.methods.merge.hint") },
  { id: "rebase", label: t("prPage.merge.methods.rebase.label"), hint: t("prPage.merge.methods.rebase.hint") },
];
import { api, errorText } from "../lib/api";
import { CommentList } from "./CommentList";
import {
  DiffExplorer,
  DiffViewToggle,
  loadDiffViewMode,
  saveDiffViewMode,
  splitDiffByFile,
  type DiffViewMode,
} from "./DiffExplorer";

function stateColor(s: string): string {
  if (s === "MERGED") return "text-purple-300";
  if (s === "CLOSED") return "text-red-300";
  return "text-emerald-300";
}
function ciColor(c: string): string {
  if (c === "SUCCESS") return "text-emerald-400";
  if (c === "FAILURE") return "text-red-400";
  return "text-amber-400";
}
function sevBadge(sev: string): string {
  if (sev === "critical") return "border-red-700 bg-red-950/50 text-red-300";
  if (sev === "warning") return "border-amber-700 bg-amber-950/50 text-amber-300";
  return "border-neutral-700 bg-neutral-800 text-neutral-300";
}
function bucketColor(b: string): string {
  if (b === "pass") return "bg-emerald-400";
  if (b === "fail") return "bg-red-400";
  if (b === "pending") return "bg-amber-400";
  return "bg-neutral-500";
}

/** Full-width pull-request view: Files (tree + numbered/split diff) and Discussion tabs. */
export function PrPage({
  repoPath,
  number,
  aiName,
  trunk,
  onClose,
  onAnalyze,
  onMerged,
}: {
  repoPath: string;
  number: number;
  /** Display name of the active AI engine (Ollama model, or "Claude"). */
  aiName: string;
  /** The repo's trunk branch, to warn when merging a PR not based on it. */
  trunk: string | null;
  onClose: () => void;
  onAnalyze: (number: number, mode: string) => void;
  /** Called with the reconciled repo view after a direct merge succeeds. */
  onMerged: (view: RepoView) => void;
}) {
  const { t } = useTranslation();
  const [pr, setPr] = useState<PrDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"files" | "discussion">("files");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [view, setView] = useState<DiffViewMode>(loadDiffViewMode);
  const [review, setReview] = useState<PrReview | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [postingReview, setPostingReview] = useState(false);
  const [postReviewResult, setPostReviewResult] = useState<string | null>(null);
  const [postReviewError, setPostReviewError] = useState<string | null>(null);
  const [reviewBody, setReviewBody] = useState("");
  const [submittingReview, setSubmittingReview] = useState<string | null>(null);
  const [reviewActionError, setReviewActionError] = useState<string | null>(null);
  const [checks, setChecks] = useState<CheckRun[] | null>(null);
  const [loadingChecks, setLoadingChecks] = useState(false);
  const [checksError, setChecksError] = useState<string | null>(null);
  const [confirmingMerge, setConfirmingMerge] = useState(false);
  const [mergeMethod, setMergeMethod] = useState<MergeMethod>("squash");
  const [deleteBranch, setDeleteBranch] = useState(false);
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [mergeNotice, setMergeNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setPr(null);
    setError(null);
    setTab("files");
    setSelectedFile(null);
    setReview(null);
    setReviewError(null);
    setReviewing(false);
    setPostReviewResult(null);
    setPostReviewError(null);
    setReviewBody("");
    setReviewActionError(null);
    setChecks(null);
    setChecksError(null);
    setConfirmingMerge(false);
    setMerging(false);
    setMergeError(null);
    setMergeNotice(null);
    setDeleteBranch(false);
    api
      .prDetail(repoPath, number)
      .then((d) => {
        if (!alive) return;
        setPr(d);
        setSelectedFile(d.files[0]?.path ?? null);
      })
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [repoPath, number]);

  const fileChunks = useMemo(() => splitDiffByFile(pr?.diff ?? ""), [pr]);
  const treeFiles = useMemo(() => (pr?.files ?? []).map((f) => ({ path: f.path })), [pr]);

  async function runReview() {
    setTab("discussion");
    setReviewing(true);
    setReview(null);
    setReviewError(null);
    setPostReviewResult(null);
    setPostReviewError(null);
    try {
      setReview(await api.reviewPr(repoPath, number));
    } catch (e) {
      setReviewError(errorText(e));
    } finally {
      setReviewing(false);
    }
  }

  async function postReview() {
    if (!review) return;
    setPostingReview(true);
    setPostReviewResult(null);
    setPostReviewError(null);
    try {
      setPostReviewResult(
        await api.postReviewComments(repoPath, number, review.summary, review.findings)
      );
    } catch (e) {
      setPostReviewError(errorText(e));
    } finally {
      setPostingReview(false);
    }
  }

  async function doReview(event: "approve" | "request_changes" | "comment") {
    setSubmittingReview(event);
    setReviewActionError(null);
    try {
      setPr(await api.submitPrReview(repoPath, number, event, reviewBody.trim()));
      setReviewBody("");
    } catch (e) {
      setReviewActionError(errorText(e));
    } finally {
      setSubmittingReview(null);
    }
  }

  async function loadChecks() {
    setLoadingChecks(true);
    setChecksError(null);
    try {
      setChecks(await api.prChecks(repoPath, number));
    } catch (e) {
      setChecksError(errorText(e));
    } finally {
      setLoadingChecks(false);
    }
  }

  async function doMerge() {
    setMerging(true);
    setMergeError(null);
    try {
      const v = await api.mergePr(repoPath, number, mergeMethod, deleteBranch);
      onMerged(v); // refresh the stack view (children re-parented, restacked)
      setConfirmingMerge(false);
      setMergeNotice(t("prPage.merge.notice"));
      // Re-fetch so the header flips to MERGED and the Merge button disappears.
      try {
        setPr(await api.prDetail(repoPath, number));
      } catch {
        /* the merge succeeded; a failed refresh is non-fatal */
      }
    } catch (e) {
      setMergeError(errorText(e));
    } finally {
      setMerging(false);
    }
  }

  function changeView(v: DiffViewMode) {
    setView(v);
    saveDiffViewMode(v);
  }

  function openFinding(file: string) {
    if (!file) return;
    setSelectedFile(file);
    setTab("files");
  }

  const tabBtn = (id: "files" | "discussion", label: string) => (
    <button
      onClick={() => setTab(id)}
      className={`border-b-2 px-3 py-1.5 text-xs font-medium ${
        tab === id
          ? "border-indigo-500 text-neutral-100"
          : "border-transparent text-neutral-400 hover:text-neutral-200"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex h-full w-full min-w-0 flex-col bg-neutral-950">
      {/* Header */}
      <div className="shrink-0 border-b border-neutral-800 px-4 pt-2">
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            title={t("prPage.header.backTitle")}
            className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <GitPullRequest className="h-4 w-4 shrink-0 text-indigo-400" />
          <span className="font-mono text-sm text-neutral-100">#{number}</span>
          {pr && <span className={`shrink-0 text-xs ${stateColor(pr.state)}`}>{pr.state}</span>}
          <span className="truncate text-sm text-neutral-200">{pr?.title ?? ""}</span>
          {pr && (
            <button
              onClick={() => safeOpen(pr.url)}
              title={t("prPage.header.openOnGitHub")}
              className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
            >
              <ExternalLink className="h-3.5 w-3.5" /> {t("common.open")}
            </button>
          )}
        </div>

        {pr && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 pl-7 text-xs text-neutral-400">
            <span className="font-mono text-neutral-300">{pr.headRef}</span>
            <span>→</span>
            <span className="font-mono text-neutral-300">{pr.baseRef}</span>
            <span className="text-neutral-600">·</span>
            <span>{pr.author}</span>
            <span className="text-emerald-400">+{pr.additions}</span>
            <span className="text-red-400">−{pr.deletions}</span>
            {pr.reviewDecision && <span className="text-neutral-500">· {pr.reviewDecision}</span>}
            {pr.checks && <span className={ciColor(pr.checks)}>· CI {pr.checks}</span>}
          </div>
        )}

        {/* Actions */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            onClick={() => onAnalyze(number, "summary")}
            title={t("prPage.actions.summaryTitle")}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500"
          >
            <Sparkles className="h-3.5 w-3.5" /> {t("prPage.actions.summary")}
          </button>
          <button
            onClick={() => onAnalyze(number, "detailed")}
            title={t("prPage.actions.detailedTitle")}
            className="inline-flex items-center gap-1.5 rounded-md border border-indigo-600 px-2.5 py-1 text-xs font-medium text-indigo-300 hover:bg-indigo-950/40"
          >
            <Sparkles className="h-3.5 w-3.5" /> {t("prPage.actions.detailed")}
          </button>
          <button
            onClick={runReview}
            disabled={reviewing}
            title={t("prPage.actions.reviewTitle")}
            className="inline-flex items-center gap-1.5 rounded-md border border-indigo-600 px-2.5 py-1 text-xs font-medium text-indigo-300 hover:bg-indigo-950/40 disabled:opacity-50"
          >
            {reviewing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5" />
            )}
            {t("prPage.actions.review")}
          </button>
          {pr?.state === "OPEN" && (
            <>
              <button
                onClick={() => {
                  setMergeError(null);
                  setConfirmingMerge(true);
                }}
                title={t("prPage.actions.mergeTitle")}
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500"
              >
                <GitMerge className="h-3.5 w-3.5" /> {t("prPage.actions.merge")}
              </button>
              <button
                onClick={() => onAnalyze(number, "merge")}
                title={t("prPage.actions.mergeAssistTitle", { ai: aiName })}
                className="inline-flex items-center gap-1.5 rounded-md border border-emerald-700 px-2.5 py-1 text-xs font-medium text-emerald-300 hover:bg-emerald-950/40"
              >
                <Sparkles className="h-3.5 w-3.5" /> {t("prPage.actions.mergeAssist")}
              </button>
            </>
          )}
          {tab === "files" && (
            <div className="ml-auto">
              <DiffViewToggle value={view} onChange={changeView} />
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="mt-2 flex items-center gap-1">
          {tabBtn(
            "files",
            pr ? t("prPage.tabs.filesCount", { count: pr.files.length }) : t("prPage.tabs.files")
          )}
          {tabBtn("discussion", t("prPage.tabs.discussion"))}
        </div>
      </div>

      {/* Body */}
      {mergeNotice && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-md border border-emerald-800 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
          <GitMerge className="h-4 w-4 shrink-0" /> {mergeNotice}
        </div>
      )}
      {error && (
        <div className="m-4 rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}
      {!pr && !error && <p className="p-4 text-sm text-neutral-500">{t("common.loading")}</p>}

      {pr && tab === "files" && (
        <DiffExplorer
          files={treeFiles}
          diffByFile={fileChunks}
          selected={selectedFile}
          onSelect={setSelectedFile}
          view={view}
          findings={review?.findings ?? []}
        />
      )}

      {pr && tab === "discussion" && (
        <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
          {/* AI Review */}
          {(reviewing || reviewError || review) && (
            <div>
              <h4 className="mb-1 flex items-center gap-1.5 text-xs uppercase tracking-wider text-neutral-500">
                <ShieldCheck className="h-3.5 w-3.5" /> {t("prPage.actions.review")}
                {review && <span className="text-neutral-600">({review.findings.length})</span>}
              </h4>
              {reviewing && (
                <div className="flex items-center gap-2 rounded-md border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-xs text-neutral-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("prPage.review.reviewing")}
                </div>
              )}
              {reviewError && (
                <div className="rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-300">
                  {reviewError}
                </div>
              )}
              {review && !reviewing && (
                <div className="space-y-2">
                  {review.summary.trim() && (
                    <p className="whitespace-pre-wrap rounded-md border border-neutral-800 bg-neutral-950/60 p-2 text-xs text-neutral-300">
                      {review.summary}
                    </p>
                  )}
                  {review.findings.length === 0 ? (
                    <p className="text-xs text-neutral-500">{t("prPage.review.noFindings")}</p>
                  ) : (
                    <ul className="space-y-1">
                      {review.findings.map((f, i) => (
                        <li key={i}>
                          <button
                            onClick={() => openFinding(f.file)}
                            title={t("prPage.review.viewFile")}
                            className="w-full rounded-md border border-neutral-800 bg-neutral-950/40 p-2 text-left hover:border-neutral-700 hover:bg-neutral-900"
                          >
                            <div className="flex items-center gap-2">
                              <span
                                className={`shrink-0 rounded border px-1.5 text-[10px] font-semibold uppercase ${sevBadge(
                                  f.severity
                                )}`}
                              >
                                {f.severity}
                              </span>
                              <span className="truncate font-mono text-[11px] text-neutral-400">
                                {f.file}
                                {f.line != null ? `:${f.line}` : ""}
                              </span>
                            </div>
                            <div className="mt-1 text-xs font-medium text-neutral-200">
                              {f.title}
                            </div>
                            <div className="mt-0.5 whitespace-pre-wrap text-xs text-neutral-400">
                              {f.detail}
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="space-y-1">
                    <button
                      onClick={postReview}
                      disabled={postingReview}
                      title={t("prPage.review.postTitle")}
                      className="inline-flex items-center gap-1.5 rounded-md border border-indigo-600 px-2.5 py-1 text-xs font-medium text-indigo-300 hover:bg-indigo-950/40 disabled:opacity-50"
                    >
                      {postingReview ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <MessageSquare className="h-3.5 w-3.5" />
                      )}
                      {t("prPage.review.post")}
                    </button>
                    {postReviewResult && (
                      <div className="rounded-md border border-emerald-800 bg-emerald-950/40 px-2 py-1 text-[11px] text-emerald-300">
                        {postReviewResult}
                      </div>
                    )}
                    {postReviewError && (
                      <div className="rounded-md border border-red-900 bg-red-950/40 px-2 py-1 text-[11px] text-red-300">
                        {postReviewError}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Human review */}
          {pr.state === "OPEN" && (
            <div className="space-y-2">
              <h4 className="text-xs uppercase tracking-wider text-neutral-500">
                {t("prPage.humanReview.heading")}
              </h4>
              <textarea
                value={reviewBody}
                onChange={(e) => setReviewBody(e.target.value)}
                rows={2}
                placeholder={t("prPage.humanReview.placeholder")}
                className="w-full resize-y rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-100 outline-none focus:border-indigo-600"
              />
              {reviewActionError && (
                <div className="rounded-md border border-red-900 bg-red-950/40 px-2 py-1 text-[11px] text-red-300">
                  {reviewActionError}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => doReview("approve")}
                  disabled={!!submittingReview}
                  className="inline-flex items-center gap-1.5 rounded-md border border-emerald-700 px-2.5 py-1 text-xs font-medium text-emerald-300 hover:bg-emerald-950/40 disabled:opacity-50"
                >
                  {submittingReview === "approve" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  {t("prPage.humanReview.approve")}
                </button>
                <button
                  onClick={() => doReview("request_changes")}
                  disabled={!!submittingReview || !reviewBody.trim()}
                  title={!reviewBody.trim() ? t("prPage.humanReview.addComment") : ""}
                  className="inline-flex items-center gap-1.5 rounded-md border border-amber-700 px-2.5 py-1 text-xs font-medium text-amber-300 hover:bg-amber-950/40 disabled:opacity-50"
                >
                  {submittingReview === "request_changes" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <X className="h-3.5 w-3.5" />
                  )}
                  {t("prPage.humanReview.requestChanges")}
                </button>
                <button
                  onClick={() => doReview("comment")}
                  disabled={!!submittingReview || !reviewBody.trim()}
                  title={!reviewBody.trim() ? t("prPage.humanReview.addComment") : ""}
                  className="inline-flex items-center gap-1.5 rounded-md border border-neutral-700 px-2.5 py-1 text-xs font-medium text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
                >
                  {submittingReview === "comment" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <MessageSquare className="h-3.5 w-3.5" />
                  )}
                  {t("prPage.humanReview.comment")}
                </button>
              </div>
            </div>
          )}

          {/* CI checks */}
          <div className="space-y-1.5">
            <button
              onClick={loadChecks}
              disabled={loadingChecks}
              className="inline-flex items-center gap-1.5 rounded-md border border-neutral-700 px-2.5 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
            >
              {loadingChecks ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ShieldCheck className="h-3.5 w-3.5" />
              )}
              {t("prPage.checks.button")}
            </button>
            {checksError && (
              <div className="rounded-md border border-red-900 bg-red-950/40 px-2 py-1 text-[11px] text-red-300">
                {checksError}
              </div>
            )}
            {checks && checks.length === 0 && (
              <p className="text-xs text-neutral-500">{t("prPage.checks.empty")}</p>
            )}
            {checks && checks.length > 0 && (
              <ul className="space-y-1">
                {checks.map((c, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs">
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${bucketColor(c.bucket)}`}
                      title={c.state}
                    />
                    <span className="flex-1 truncate text-neutral-300">{c.name}</span>
                    {c.link && (
                      <button
                        onClick={() => safeOpen(c.link)}
                        title={t("prPage.checks.viewLogs")}
                        className="shrink-0 text-neutral-500 hover:text-indigo-300"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Description */}
          {pr.body.trim() && (
            <div>
              <h4 className="mb-1 text-xs uppercase tracking-wider text-neutral-500">
                {t("prPage.description")}
              </h4>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-neutral-800 bg-neutral-950/60 p-2 font-sans text-xs text-neutral-300">
                {pr.body}
              </pre>
            </div>
          )}

          <CommentList comments={pr.comments} reviews={pr.reviews} />

          {pr.commits.length > 0 && (
            <div>
              <h4 className="mb-1 text-xs uppercase tracking-wider text-neutral-500">
                {t("prPage.commits", { count: pr.commits.length })}
              </h4>
              <ul className="space-y-0.5">
                {pr.commits.map((c, i) => (
                  <li key={i} className="truncate text-xs text-neutral-300">
                    • {c}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Direct-merge confirmation */}
      {confirmingMerge && pr && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => !merging && setConfirmingMerge(false)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-neutral-700 bg-neutral-900 p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="flex items-center gap-2 text-sm font-medium text-neutral-100">
              <GitMerge className="h-4 w-4 text-emerald-400" />{" "}
              {t("prPage.merge.confirmTitle", { number })}
            </h3>
            <p className="mt-1 truncate text-sm text-neutral-300">{pr.title}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-400">
              <span className="font-mono text-neutral-300">{pr.headRef}</span>
              <span>→</span>
              <span className="font-mono text-neutral-300">{pr.baseRef}</span>
              {pr.reviewDecision && <span className="text-neutral-500">· {pr.reviewDecision}</span>}
              {pr.checks && <span className={ciColor(pr.checks)}>· CI {pr.checks}</span>}
            </div>

            {trunk && pr.baseRef !== trunk && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-800 bg-amber-950/40 px-2.5 py-2 text-xs text-amber-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {t("prPage.merge.stackedWarning.before")}{" "}
                  <span className="font-mono">{pr.baseRef}</span>
                  {t("prPage.merge.stackedWarning.middle")}{" "}
                  <span className="font-mono">{trunk}</span>
                  {t("prPage.merge.stackedWarning.after")}
                </span>
              </div>
            )}

            {(pr.checks === "FAILURE" ||
              pr.reviewDecision === "CHANGES_REQUESTED" ||
              pr.reviewDecision === "REVIEW_REQUIRED") && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-800 bg-amber-950/40 px-2.5 py-2 text-xs text-amber-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{t("prPage.merge.ciWarning")}</span>
              </div>
            )}

            <fieldset className="mt-3 space-y-1.5">
              <legend className="mb-1 text-xs uppercase tracking-wider text-neutral-500">
                {t("prPage.merge.method")}
              </legend>
              {MERGE_METHODS(t).map((m) => (
                <label
                  key={m.id}
                  className={`flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-1.5 ${
                    mergeMethod === m.id
                      ? "border-emerald-700 bg-emerald-950/30"
                      : "border-neutral-800 hover:border-neutral-700"
                  }`}
                >
                  <input
                    type="radio"
                    name="merge-method"
                    className="mt-0.5 accent-emerald-500"
                    checked={mergeMethod === m.id}
                    onChange={() => setMergeMethod(m.id)}
                  />
                  <span>
                    <span className="text-xs font-medium text-neutral-200">{m.label}</span>
                    <span className="block text-[11px] text-neutral-500">{m.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs text-neutral-300">
              <input
                type="checkbox"
                className="mt-0.5 accent-emerald-500"
                checked={deleteBranch}
                onChange={(e) => setDeleteBranch(e.target.checked)}
              />
              <span>
                {t("prPage.merge.deleteBranch.label")}
                <span className="block text-[11px] text-neutral-500">
                  {t("prPage.merge.deleteBranch.hint")}
                </span>
              </span>
            </label>

            {mergeError && (
              <div className="mt-3 rounded-md border border-red-900 bg-red-950/40 px-2.5 py-2 text-xs text-red-300">
                {mergeError}
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirmingMerge(false)}
                disabled={merging}
                className="rounded-md border border-neutral-700 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={doMerge}
                disabled={merging}
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {merging ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <GitMerge className="h-3.5 w-3.5" />
                )}
                {t("prPage.actions.merge")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
