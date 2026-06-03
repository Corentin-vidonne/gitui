import { useEffect, useMemo, useState } from "react";
import { X, Sparkles, ExternalLink, GitPullRequest, ShieldCheck, Loader2 } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { PrDetail, PrReview } from "../lib/types";
import { api, errorText } from "../lib/api";
import { useTheme } from "../lib/theme";
import { DiffView, splitDiffByFile } from "./DiffView";
import { CommentList } from "./CommentList";

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
/** Badge classes for an AI-review finding severity. */
function sevBadge(sev: string): string {
  if (sev === "critical") return "border-red-700 bg-red-950/50 text-red-300";
  if (sev === "warning") return "border-amber-700 bg-amber-950/50 text-amber-300";
  return "border-neutral-700 bg-neutral-800 text-neutral-300";
}

export function PrDetailPanel({
  repoPath,
  number,
  onClose,
  onAnalyze,
}: {
  repoPath: string;
  number: number;
  onClose: () => void;
  onAnalyze: (number: number, mode: string) => void;
}) {
  const { isModern } = useTheme();
  const [pr, setPr] = useState<PrDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [review, setReview] = useState<PrReview | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setPr(null);
    setError(null);
    setSelectedFile(null);
    setReview(null);
    setReviewError(null);
    setReviewing(false);
    api
      .prDetail(repoPath, number)
      .then((d) => alive && setPr(d))
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [repoPath, number]);

  async function runReview() {
    setReviewing(true);
    setReview(null);
    setReviewError(null);
    try {
      setReview(await api.reviewPr(repoPath, number));
    } catch (e) {
      setReviewError(errorText(e));
    } finally {
      setReviewing(false);
    }
  }

  const fileChunks = useMemo(() => splitDiffByFile(pr?.diff ?? ""), [pr]);
  const shownDiff = selectedFile
    ? fileChunks[selectedFile] ?? "(no diff for this file)"
    : pr?.diff ?? "";

  return (
    <aside className="flex h-full w-full flex-col border-l border-neutral-800 bg-neutral-900/40">
      <div
        className={`flex items-center gap-2 border-b border-neutral-800 px-4 ${
          isModern ? "h-16" : "h-14"
        }`}
      >
        <GitPullRequest className="h-4 w-4 text-indigo-400" />
        <span className="font-mono text-sm text-neutral-100">#{number}</span>
        {pr && <span className={`text-xs ${stateColor(pr.state)}`}>{pr.state}</span>}
        <button
          onClick={onClose}
          className="ml-auto rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-auto p-4">
        {error && (
          <div className="rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}
        {!pr && !error && <p className="text-sm text-neutral-500">Loading…</p>}

        {pr && (
          <>
            <h3 className="text-sm font-semibold text-neutral-100">{pr.title}</h3>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => onAnalyze(number, "summary")}
                title="Quick synthesis"
                className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
              >
                <Sparkles className="h-3.5 w-3.5" /> Summary
              </button>
              <button
                onClick={() => onAnalyze(number, "detailed")}
                title="In-depth PR review"
                className="inline-flex items-center gap-1.5 rounded-md border border-indigo-600 px-2.5 py-1.5 text-xs font-medium text-indigo-300 hover:bg-indigo-950/40"
              >
                <Sparkles className="h-3.5 w-3.5" /> Detailed
              </button>
              <button
                onClick={runReview}
                disabled={reviewing}
                title="Structured AI review (findings shown below)"
                className="inline-flex items-center gap-1.5 rounded-md border border-indigo-600 px-2.5 py-1.5 text-xs font-medium text-indigo-300 hover:bg-indigo-950/40 disabled:opacity-50"
              >
                {reviewing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="h-3.5 w-3.5" />
                )}{" "}
                AI Review
              </button>
              <button
                onClick={() => openUrl(pr.url)}
                className="inline-flex items-center gap-1.5 rounded-md border border-neutral-700 px-2.5 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Open
              </button>
            </div>

            {(reviewing || reviewError || review) && (
              <div>
                <h4 className="mb-1 flex items-center gap-1.5 text-xs uppercase tracking-wider text-neutral-500">
                  <ShieldCheck className="h-3.5 w-3.5" /> AI Review
                  {review && (
                    <span className="text-neutral-600">({review.findings.length})</span>
                  )}
                </h4>
                {reviewing && (
                  <div className="flex items-center gap-2 rounded-md border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-xs text-neutral-400">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reviewing… (~30 s)
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
                      <p className="text-xs text-neutral-500">No issues found ✓</p>
                    ) : (
                      <ul className="space-y-1">
                        {review.findings.map((f, i) => (
                          <li key={i}>
                            <button
                              onClick={() => setSelectedFile(f.file)}
                              title="Show this file's changes"
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
                  </div>
                )}
              </div>
            )}

            <div className="space-y-1 text-xs text-neutral-400">
              <div>
                <span className="font-mono text-neutral-300">{pr.headRef}</span> →{" "}
                <span className="font-mono text-neutral-300">{pr.baseRef}</span>
              </div>
              <div>
                by {pr.author} · <span className="text-emerald-400">+{pr.additions}</span>{" "}
                <span className="text-red-400">-{pr.deletions}</span>
                {pr.reviewDecision && <span> · {pr.reviewDecision}</span>}
                {pr.checks && <span className={ciColor(pr.checks)}> · CI {pr.checks}</span>}
              </div>
            </div>

            {pr.body.trim() && (
              <div>
                <h4 className="mb-1 text-xs uppercase tracking-wider text-neutral-500">
                  Description
                </h4>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-neutral-800 bg-neutral-950/60 p-2 font-sans text-xs text-neutral-300">
                  {pr.body}
                </pre>
              </div>
            )}

            <CommentList comments={pr.comments} reviews={pr.reviews} />

            {pr.commits.length > 0 && (
              <div>
                <h4 className="mb-1 text-xs uppercase tracking-wider text-neutral-500">
                  Commits ({pr.commits.length})
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

            <div>
              <h4 className="mb-1 text-xs uppercase tracking-wider text-neutral-500">
                Files ({pr.files.length})
              </h4>
              <ul className="space-y-0.5">
                {pr.files.map((f, i) => {
                  const active = selectedFile === f.path;
                  return (
                    <li key={`${f.path}-${i}`}>
                      <button
                        onClick={() => setSelectedFile(active ? null : f.path)}
                        title="Show only this file's changes"
                        className={`flex w-full items-center gap-2 rounded px-1.5 py-0.5 text-left text-xs ${
                          active ? "bg-neutral-800" : "hover:bg-neutral-800/60"
                        }`}
                      >
                        <span className="truncate font-mono text-neutral-300">{f.path}</span>
                        <span className="ml-auto shrink-0 font-mono text-[10px]">
                          <span className="text-emerald-400">+{f.additions}</span>{" "}
                          <span className="text-red-400">-{f.deletions}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            {shownDiff.trim().length > 0 && (
              <div>
                <div className="mb-1 flex items-center gap-2">
                  <h4 className="text-xs uppercase tracking-wider text-neutral-500">
                    {selectedFile ? "File changes" : "Diff"}
                  </h4>
                  {selectedFile && (
                    <button
                      onClick={() => setSelectedFile(null)}
                      className="rounded px-1.5 text-[10px] text-indigo-300 hover:bg-neutral-800"
                    >
                      show all
                    </button>
                  )}
                </div>
                <DiffView text={shownDiff} />
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
