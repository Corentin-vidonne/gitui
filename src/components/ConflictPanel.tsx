import { useState } from "react";
import { AlertTriangle, Check, X, Sparkles, Loader2 } from "lucide-react";
import type { ConflictState, ConflictSuggestion, RepoView } from "../lib/types";
import { api, errorText } from "../lib/api";

/** A genuine resolution should carry no leftover conflict markers. */
function hasConflictMarkers(text: string): boolean {
  return /^(<<<<<<<|>>>>>>>)/m.test(text);
}

export function ConflictPanel({
  conflict,
  repoPath,
  busy,
  onContinue,
  onAbort,
  onResolved,
}: {
  conflict: ConflictState;
  repoPath: string;
  busy: boolean;
  onContinue: () => void;
  onAbort: () => void;
  onResolved: (view: RepoView) => void;
}) {
  const [suggestions, setSuggestions] = useState<Record<string, ConflictSuggestion>>({});
  const [loadingFile, setLoadingFile] = useState<string | null>(null);
  const [applyingFile, setApplyingFile] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [resolvingAll, setResolvingAll] = useState(false);

  function clearError(file: string) {
    setErrors((e) => {
      const { [file]: _drop, ...rest } = e;
      return rest;
    });
  }

  async function suggest(file: string) {
    setLoadingFile(file);
    clearError(file);
    try {
      const s = await api.suggestConflictResolution(repoPath, file);
      setSuggestions((m) => ({ ...m, [file]: s }));
    } catch (e) {
      setErrors((m) => ({ ...m, [file]: errorText(e) }));
    } finally {
      setLoadingFile(null);
    }
  }

  function dismiss(file: string) {
    setSuggestions((m) => {
      const { [file]: _drop, ...rest } = m;
      return rest;
    });
    clearError(file);
  }

  async function apply(file: string) {
    const s = suggestions[file];
    if (!s) return;
    setApplyingFile(file);
    clearError(file);
    try {
      const view = await api.applyConflictResolution(repoPath, file, s.resolution);
      dismiss(file);
      onResolved(view); // file drops out of conflict.files once staged
    } catch (e) {
      setErrors((m) => ({ ...m, [file]: errorText(e) }));
    } finally {
      setApplyingFile(null);
    }
  }

  // Suggest + apply every conflicted file in turn. Files whose proposal still
  // carries conflict markers are flagged and left for manual resolution.
  async function resolveAll() {
    setResolvingAll(true);
    try {
      for (const file of [...conflict.files]) {
        setLoadingFile(file);
        clearError(file);
        try {
          const s = await api.suggestConflictResolution(repoPath, file);
          setSuggestions((m) => ({ ...m, [file]: s }));
          setLoadingFile(null);
          if (hasConflictMarkers(s.resolution)) {
            setErrors((m) => ({
              ...m,
              [file]: "AI left conflict markers — resolve this one manually.",
            }));
            continue;
          }
          setApplyingFile(file);
          const view = await api.applyConflictResolution(repoPath, file, s.resolution);
          setSuggestions((m) => {
            const { [file]: _drop, ...rest } = m;
            return rest;
          });
          onResolved(view);
        } catch (e) {
          setErrors((m) => ({ ...m, [file]: errorText(e) }));
        } finally {
          setApplyingFile(null);
          setLoadingFile(null);
        }
      }
    } finally {
      setResolvingAll(false);
    }
  }

  return (
    <div className="mb-4 rounded-lg border border-amber-800 bg-amber-950/30 p-4">
      <div className="flex items-center gap-2 text-amber-300">
        <AlertTriangle className="h-5 w-5 shrink-0" />
        <h3 className="text-sm font-semibold">
          Restack paused — resolve conflicts
          {conflict.branch ? (
            <>
              {" "}
              on <span className="font-mono">{conflict.branch}</span>
            </>
          ) : null}
        </h3>
      </div>
      <p className="mt-2 text-xs text-neutral-400">
        Fix the conflicts in your editor and stage them (
        <code className="rounded bg-neutral-800 px-1">git add</code>), then continue — or let
        the AI propose a resolution per file.
      </p>

      {conflict.files.length > 1 && (
        <button
          onClick={resolveAll}
          disabled={resolvingAll || busy}
          title="Suggest and apply a resolution for every conflicted file"
          className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {resolvingAll ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {resolvingAll ? "Resolving…" : `AI resolve all (${conflict.files.length})`}
        </button>
      )}

      {conflict.files.length > 0 && (
        <ul className="mt-3 space-y-2">
          {conflict.files.map((f) => {
            const s = suggestions[f];
            const markers = s ? hasConflictMarkers(s.resolution) : false;
            return (
              <li
                key={f}
                className="rounded-md border border-amber-900/60 bg-neutral-950/40 p-2"
              >
                <div className="flex items-center gap-2">
                  <span className="truncate font-mono text-xs text-amber-200">{f}</span>
                  <button
                    onClick={() => suggest(f)}
                    disabled={loadingFile === f || resolvingAll}
                    title="Ask the AI to resolve this file"
                    className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-md border border-indigo-600 px-2 py-1 text-[11px] font-medium text-indigo-300 hover:bg-indigo-950/40 disabled:opacity-50"
                  >
                    {loadingFile === f ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Sparkles className="h-3 w-3" />
                    )}
                    {s ? "Retry" : "AI suggest"}
                  </button>
                </div>

                {errors[f] && (
                  <div className="mt-2 rounded border border-red-900 bg-red-950/40 px-2 py-1 text-[11px] text-red-300">
                    {errors[f]}
                  </div>
                )}

                {s && (
                  <div className="mt-2 space-y-2">
                    <p className="whitespace-pre-wrap text-xs text-neutral-300">
                      {s.explanation}
                    </p>
                    <details className="rounded border border-neutral-800 bg-neutral-950/60">
                      <summary className="cursor-pointer px-2 py-1 text-[11px] text-neutral-400">
                        Preview resolved file
                      </summary>
                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words border-t border-neutral-800 p-2 font-mono text-[11px] text-neutral-300">
                        {s.resolution}
                      </pre>
                    </details>
                    {markers && (
                      <div className="flex items-center gap-1.5 text-[11px] text-amber-300">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        The proposal still contains conflict markers — review manually before
                        applying.
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={() => apply(f)}
                        disabled={applyingFile === f || markers}
                        title={
                          markers
                            ? "Resolution still has conflict markers"
                            : "Write this resolution and stage the file"
                        }
                        className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                      >
                        {applyingFile === f ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Check className="h-3 w-3" />
                        )}
                        Apply
                      </button>
                      <button
                        onClick={() => dismiss(f)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-neutral-700 px-2.5 py-1 text-[11px] text-neutral-300 hover:bg-neutral-800"
                      >
                        <X className="h-3 w-3" /> Dismiss
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 flex gap-2">
        <button
          onClick={onContinue}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          <Check className="h-3.5 w-3.5" /> Continue restack
        </button>
        <button
          onClick={onAbort}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" /> Abort
        </button>
      </div>
    </div>
  );
}
