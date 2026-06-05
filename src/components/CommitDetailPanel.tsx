import { useEffect, useMemo, useState } from "react";
import { X, Sparkles, ShieldCheck, Loader2 } from "lucide-react";
import type { CommitDetail, CommitNode, PrReview } from "../lib/types";
import { api, errorText } from "../lib/api";

function statusColor(s: string): string {
  if (s.startsWith("A")) return "text-emerald-400";
  if (s.startsWith("D")) return "text-red-400";
  if (s.startsWith("R")) return "text-blue-400";
  return "text-amber-400";
}

/** Badge classes for an AI-review finding severity. */
function sevBadge(sev: string): string {
  if (sev === "critical") return "border-red-700 bg-red-950/50 text-red-300";
  if (sev === "warning") return "border-amber-700 bg-amber-950/50 text-amber-300";
  return "border-neutral-700 bg-neutral-800 text-neutral-300";
}

/** Split a unified diff into per-file chunks, keyed by the (b/) path. */
function splitDiffByFile(diff: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!diff) return out;
  let current: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (current) out[current] = buf.join("\n");
  };
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      flush();
      const m = line.match(/ b\/(.+)$/);
      current = m ? m[1] : line;
      buf = [];
    }
    buf.push(line);
  }
  flush();
  return out;
}

function DiffView({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <pre className="overflow-x-auto rounded-md border border-neutral-800 bg-neutral-950 p-2 font-mono text-[11px] leading-relaxed">
      {lines.map((l, i) => {
        let cls = "text-neutral-400";
        if (l.startsWith("@@")) cls = "text-cyan-300";
        else if (l.startsWith("+++") || l.startsWith("---")) cls = "text-neutral-500";
        else if (l.startsWith("diff ") || l.startsWith("index ")) cls = "text-neutral-600";
        else if (l.startsWith("+")) cls = "bg-emerald-950/30 text-emerald-300";
        else if (l.startsWith("-")) cls = "bg-red-950/30 text-red-300";
        return (
          <div key={i} className={`whitespace-pre ${cls}`}>
            {l || " "}
          </div>
        );
      })}
    </pre>
  );
}

export function CommitDetailPanel({
  repoPath,
  node,
  branches,
  aiName,
  onClose,
  onAnalyze,
  onCherryPick,
}: {
  repoPath: string;
  node: CommitNode;
  branches: string[];
  /** Display name of the active AI engine (Ollama model, or "Claude"). */
  aiName: string;
  onClose: () => void;
  onAnalyze: (sha: string, mode: string) => void;
  onCherryPick: (sha: string, target: string) => void;
}) {
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [review, setReview] = useState<PrReview | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [cpTarget, setCpTarget] = useState<string>("");

  async function runReview() {
    setReviewing(true);
    setReview(null);
    setReviewError(null);
    try {
      setReview(await api.reviewCommit(repoPath, node.sha));
    } catch (e) {
      setReviewError(errorText(e));
    } finally {
      setReviewing(false);
    }
  }

  useEffect(() => {
    let alive = true;
    setDetail(null);
    setSelectedFile(null);
    setReview(null);
    setReviewError(null);
    setReviewing(false);
    api
      .commitDetail(repoPath, node.sha)
      .then((d) => alive && setDetail(d))
      .catch(() => alive && setDetail({ message: node.subject, files: [], diff: "" }));
    return () => {
      alive = false;
    };
  }, [repoPath, node.sha]);

  const fileChunks = useMemo(() => splitDiffByFile(detail?.diff ?? ""), [detail]);
  const shownDiff = selectedFile
    ? fileChunks[selectedFile] ?? "(no diff for this file)"
    : detail?.diff ?? "";

  return (
    <aside className="flex h-full w-full flex-col border-l border-neutral-800 bg-neutral-900/40">
      <div className="flex h-14 items-center gap-2 border-b border-neutral-800 px-4">
        <span className="font-mono text-sm text-amber-300">{node.shortSha}</span>
        <span className="text-xs text-neutral-400">commit</span>
        <button
          onClick={onClose}
          className="ml-auto rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-auto p-4">
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-xs text-neutral-400">
            <Sparkles className="h-3.5 w-3.5 text-indigo-400" /> Analyser avec {aiName}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => onAnalyze(node.sha, "summary")}
              title="Quick synthesis (5-8 lines)"
              className="flex-1 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
            >
              Summary
            </button>
            <button
              onClick={() => onAnalyze(node.sha, "detailed")}
              title="In-depth review (per-file, intent, risks, suggestions)"
              className="flex-1 rounded-md border border-indigo-600 px-3 py-1.5 text-sm font-medium text-indigo-300 hover:bg-indigo-950/40"
            >
              Detailed
            </button>
          </div>
          <button
            onClick={runReview}
            disabled={reviewing}
            title="Relecture IA structurée (findings ci-dessous)"
            className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-indigo-600 px-3 py-1.5 text-sm font-medium text-indigo-300 hover:bg-indigo-950/40 disabled:opacity-50"
          >
            {reviewing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5" />
            )}
            AI Review
          </button>
        </div>

        {(reviewing || reviewError || review) && (
          <div>
            <h4 className="mb-1 flex items-center gap-1.5 text-xs uppercase tracking-wider text-neutral-500">
              <ShieldCheck className="h-3.5 w-3.5" /> AI Review
              {review && <span className="text-neutral-600">({review.findings.length})</span>}
            </h4>
            {reviewing && (
              <div className="flex items-center gap-2 rounded-md border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-xs text-neutral-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Relecture… (~30 s)
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
                  <p className="text-xs text-neutral-500">Aucun problème détecté ✓</p>
                ) : (
                  <ul className="space-y-1">
                    {review.findings.map((f, i) => (
                      <li key={i}>
                        <button
                          onClick={() => setSelectedFile(f.file)}
                          title="Voir les changements de ce fichier"
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

        {branches.length > 0 && (
          <div>
            <div className="mb-1.5 text-xs text-neutral-400">Cherry-pick sur une branche</div>
            <div className="flex gap-2">
              <select
                value={cpTarget || branches[0]}
                onChange={(e) => setCpTarget(e.target.value)}
                className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-100 outline-none focus:border-indigo-600"
              >
                {branches.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
              <button
                onClick={() => onCherryPick(node.sha, cpTarget || branches[0])}
                title="Appliquer ce commit sur la branche choisie"
                className="shrink-0 rounded-md border border-emerald-700 px-2.5 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-950/40"
              >
                Cherry-pick
              </button>
            </div>
          </div>
        )}

        {node.refs.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {node.refs.map((r) => (
              <span
                key={r}
                className="rounded-full bg-indigo-900/60 px-2 py-0.5 text-[10px] text-indigo-200"
              >
                {r}
              </span>
            ))}
          </div>
        )}

        <pre className="whitespace-pre-wrap break-words font-sans text-sm text-neutral-200">
          {detail ? detail.message : node.subject}
        </pre>

        <div className="space-y-1 text-xs text-neutral-500">
          <div>
            {node.author} · {node.date}
          </div>
          <div>
            parent{node.parents.length > 1 ? "s" : ""}:{" "}
            <span className="font-mono">
              {node.parents.map((p) => p.slice(0, 7)).join(", ") || "—"}
            </span>
          </div>
        </div>

        <div>
          <h4 className="mb-1 text-xs uppercase tracking-wider text-neutral-500">
            Files{detail ? ` (${detail.files.length})` : ""}
          </h4>
          {detail === null && <p className="text-xs text-neutral-600">Loading…</p>}
          {detail && detail.files.length === 0 && (
            <p className="text-xs text-neutral-600">No file changes.</p>
          )}
          <ul className="space-y-0.5">
            {detail?.files.map((f, i) => {
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
                    <span className={`w-6 shrink-0 font-mono ${statusColor(f.status)}`}>
                      {f.status}
                    </span>
                    <span className="truncate font-mono text-neutral-300">{f.path}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {detail && shownDiff.trim().length > 0 && (
          <div>
            <div className="mb-1 flex items-center gap-2">
              <h4 className="text-xs uppercase tracking-wider text-neutral-500">
                {selectedFile ? "File changes" : "Changes"}
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
      </div>
    </aside>
  );
}
