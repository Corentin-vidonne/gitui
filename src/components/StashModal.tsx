import { useCallback, useEffect, useState } from "react";
import { Archive, Trash2 } from "lucide-react";
import { Modal } from "./Modal";
import { api, errorText } from "../lib/api";
import type { StashEntry } from "../lib/types";

/** Color a `git stash show --name-status` status letter. */
function statusColor(s: string): string {
  if (s.startsWith("A")) return "text-emerald-400";
  if (s.startsWith("D")) return "text-red-400";
  if (s.startsWith("R")) return "text-indigo-400";
  return "text-amber-400"; // M and the rest
}

export function StashModal({
  repoPath,
  dirty,
  onClose,
  onChanged,
}: {
  repoPath: string;
  dirty: boolean;
  onClose: () => void;
  /** Called after any op so the parent can refresh the working-tree view. */
  onChanged: () => void;
}) {
  const [stashes, setStashes] = useState<StashEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [inclUntracked, setInclUntracked] = useState(true);
  const [pendingDrop, setPendingDrop] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api
      .listStashes(repoPath)
      .then(setStashes)
      .catch((e) => setError(errorText(e)));
  }, [repoPath]);

  useEffect(() => {
    load();
  }, [load]);

  async function op(p: Promise<StashEntry[]>) {
    setBusy(true);
    setError(null);
    setPendingDrop(null);
    try {
      setStashes(await p);
    } catch (e) {
      setError(errorText(e));
      load();
    } finally {
      setBusy(false);
      onChanged(); // the working tree may have changed → refresh the main view
    }
  }

  return (
    <Modal title="Stashes" onClose={onClose}>
      <div className="space-y-3">
        {/* Create a stash */}
        <div className="flex items-center gap-2">
          <input
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            placeholder="Message (optionnel)"
            className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-indigo-600"
          />
          <label
            className="flex shrink-0 items-center gap-1 text-xs text-neutral-400"
            title="Inclure les fichiers non suivis"
          >
            <input
              type="checkbox"
              checked={inclUntracked}
              onChange={(e) => setInclUntracked(e.target.checked)}
              className="accent-indigo-600"
            />
            non suivis
          </label>
          <button
            onClick={() => op(api.stashPush(repoPath, msg.trim() || null, inclUntracked))}
            disabled={!dirty || busy}
            title={dirty ? "Stasher les changements en cours" : "Aucun changement à stasher"}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            <Archive className="h-3.5 w-3.5" /> Stasher
          </button>
        </div>

        {error && (
          <div className="rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        {/* Stash list with the files each one holds */}
        {stashes === null ? (
          <p className="text-sm text-neutral-500">Chargement…</p>
        ) : stashes.length === 0 ? (
          <p className="py-6 text-center text-sm text-neutral-500">Aucun stash.</p>
        ) : (
          <ul className="max-h-[55vh] space-y-2 overflow-auto">
            {stashes.map((s) => (
              <li
                key={s.refName}
                className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-2.5"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-neutral-300">{s.refName}</span>
                  {s.branch && (
                    <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400">
                      {s.branch}
                    </span>
                  )}
                  <span className="text-[10px] text-neutral-600">{s.date}</span>
                  <span className="ml-auto flex items-center gap-1">
                    <button
                      onClick={() => op(api.stashApply(repoPath, s.refName))}
                      disabled={busy}
                      title="Appliquer (garde le stash)"
                      className="rounded border border-neutral-700 px-2 py-0.5 text-[11px] text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
                    >
                      Apply
                    </button>
                    <button
                      onClick={() => op(api.stashPop(repoPath, s.refName))}
                      disabled={busy}
                      title="Appliquer puis supprimer"
                      className="rounded border border-emerald-700 px-2 py-0.5 text-[11px] text-emerald-300 hover:bg-emerald-950/40 disabled:opacity-50"
                    >
                      Pop
                    </button>
                    {pendingDrop === s.refName ? (
                      <button
                        onClick={() => op(api.stashDrop(repoPath, s.refName))}
                        disabled={busy}
                        className="inline-flex items-center gap-1 rounded bg-rose-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-rose-500 disabled:opacity-50"
                      >
                        <Trash2 className="h-3 w-3" /> Confirmer
                      </button>
                    ) : (
                      <button
                        onClick={() => setPendingDrop(s.refName)}
                        disabled={busy}
                        title="Supprimer ce stash"
                        className="rounded border border-neutral-700 px-2 py-0.5 text-[11px] text-neutral-400 hover:bg-rose-950/40 hover:text-rose-300 disabled:opacity-50"
                      >
                        Drop
                      </button>
                    )}
                  </span>
                </div>
                {s.message && (
                  <div className="mt-1 truncate text-xs text-neutral-300">{s.message}</div>
                )}
                <ul className="mt-1.5 space-y-0.5">
                  {s.files.length === 0 ? (
                    <li className="text-[11px] text-neutral-600">(aucun fichier détecté)</li>
                  ) : (
                    s.files.map((f, i) => (
                      <li key={i} className="flex items-center gap-1.5 text-[11px]">
                        <span className={`w-4 shrink-0 text-center font-mono ${statusColor(f.status)}`}>
                          {f.status}
                        </span>
                        <span className="truncate font-mono text-neutral-400">{f.path}</span>
                      </li>
                    ))
                  )}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
