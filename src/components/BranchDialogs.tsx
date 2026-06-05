import { useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { Modal } from "./Modal";
import { api, errorText } from "../lib/api";

const inputClass =
  "w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-indigo-600";

export function NewBranchDialog({
  repoPath,
  parent,
  branches,
  onSubmit,
  onClose,
}: {
  repoPath: string;
  parent: string;
  branches: string[];
  onSubmit: (name: string, parent: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [par, setPar] = useState(parent);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  async function suggest() {
    setSuggesting(true);
    setSuggestError(null);
    try {
      setName((await api.suggestBranchName(repoPath)).trim());
    } catch (e) {
      setSuggestError(errorText(e));
    } finally {
      setSuggesting(false);
    }
  }

  return (
    <Modal title="New branch" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onSubmit(name.trim(), par);
        }}
        className="space-y-3"
      >
        <div>
          <label className="mb-1 block text-xs text-neutral-400">Branch name</label>
          <div className="flex gap-2">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="feat/my-change"
              className={inputClass}
            />
            <button
              type="button"
              onClick={suggest}
              disabled={suggesting}
              title="Suggérer un nom (IA, depuis tes changements en cours)"
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-indigo-700 px-2.5 text-xs text-indigo-300 hover:bg-indigo-950/40 disabled:opacity-50"
            >
              {suggesting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
          {suggestError && (
            <p className="mt-1 text-[11px] text-amber-400">{suggestError}</p>
          )}
        </div>
        <div>
          <label className="mb-1 block text-xs text-neutral-400">Parent (base)</label>
          <select value={par} onChange={(e) => setPar(e.target.value)} className={inputClass}>
            {branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-neutral-400 hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim()}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function SetParentDialog({
  branch,
  current,
  branches,
  onSubmit,
  onClose,
}: {
  branch: string;
  current: string | null;
  branches: string[];
  onSubmit: (parent: string) => void;
  onClose: () => void;
}) {
  const options = branches.filter((b) => b !== branch);
  const [par, setPar] = useState(
    current && options.includes(current) ? current : options[0] ?? ""
  );

  return (
    <Modal title={`Set parent of ${branch}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (par) onSubmit(par);
        }}
        className="space-y-3"
      >
        <div>
          <label className="mb-1 block text-xs text-neutral-400">Parent branch</label>
          <select
            autoFocus
            value={par}
            onChange={(e) => setPar(e.target.value)}
            className={inputClass}
          >
            {options.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-neutral-400 hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!par}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Pick a source and target branch, then launch the Claude merge assistant. */
export function MergeBranchDialog({
  source,
  current,
  branches,
  onSubmit,
  onClose,
}: {
  source: string;
  current: string | null;
  branches: string[];
  onSubmit: (source: string, target: string) => void;
  onClose: () => void;
}) {
  const [src, setSrc] = useState(source);
  const [tgt, setTgt] = useState(
    current && current !== source ? current : branches.find((b) => b !== source) ?? ""
  );
  const invalid = !src || !tgt || src === tgt;

  return (
    <Modal title="Merge branches" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!invalid) onSubmit(src, tgt);
        }}
        className="space-y-3"
      >
        <div>
          <label className="mb-1 block text-xs text-neutral-400">Source (branche à merger)</label>
          <select
            autoFocus
            value={src}
            onChange={(e) => setSrc(e.target.value)}
            className={inputClass}
          >
            {branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-neutral-400">Cible (reçoit le merge)</label>
          <select value={tgt} onChange={(e) => setTgt(e.target.value)} className={inputClass}>
            {branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>
        {src === tgt && (
          <p className="text-xs text-amber-400">Choisis deux branches différentes.</p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-neutral-400 hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={invalid}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            Aide au merge
          </button>
        </div>
      </form>
    </Modal>
  );
}
