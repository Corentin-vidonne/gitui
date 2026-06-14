import { useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
    <Modal title={t("branchDialogs.new.title")} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onSubmit(name.trim(), par);
        }}
        className="space-y-3"
      >
        <div>
          <label className="mb-1 block text-xs text-neutral-400">{t("branchDialogs.new.nameLabel")}</label>
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
              title={t("branchDialogs.new.suggestTitle")}
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
          <label className="mb-1 block text-xs text-neutral-400">{t("branchDialogs.new.parentLabel")}</label>
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
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={!name.trim()}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {t("common.create")}
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
  const { t } = useTranslation();
  const options = branches.filter((b) => b !== branch);
  const [par, setPar] = useState(
    current && options.includes(current) ? current : options[0] ?? ""
  );

  return (
    <Modal title={t("branchDialogs.setParent.title", { branch })} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (par) onSubmit(par);
        }}
        className="space-y-3"
      >
        <div>
          <label className="mb-1 block text-xs text-neutral-400">{t("branchDialogs.setParent.parentLabel")}</label>
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
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={!par}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {t("common.save")}
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
  const { t } = useTranslation();
  const [src, setSrc] = useState(source);
  const [tgt, setTgt] = useState(
    current && current !== source ? current : branches.find((b) => b !== source) ?? ""
  );
  const invalid = !src || !tgt || src === tgt;

  return (
    <Modal title={t("branchDialogs.merge.title")} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!invalid) onSubmit(src, tgt);
        }}
        className="space-y-3"
      >
        <div>
          <label className="mb-1 block text-xs text-neutral-400">{t("branchDialogs.merge.sourceLabel")}</label>
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
          <label className="mb-1 block text-xs text-neutral-400">{t("branchDialogs.merge.targetLabel")}</label>
          <select value={tgt} onChange={(e) => setTgt(e.target.value)} className={inputClass}>
            {branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>
        {src === tgt && (
          <p className="text-xs text-amber-400">{t("branchDialogs.merge.sameBranch")}</p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-neutral-400 hover:bg-neutral-800"
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={invalid}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {t("branchDialogs.merge.submit")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
