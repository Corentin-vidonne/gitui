import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  X,
  ExternalLink,
  Plus,
  Layers,
  GitFork,
  Unlink,
  Link as LinkIcon,
  ArrowRightToLine,
  UploadCloud,
  Pencil,
  Combine,
  Scissors,
  ArrowUp,
  ArrowDown,
  Trash2,
  GitBranch,
  GitMerge,
  Sparkles,
  Loader2,
} from "lucide-react";
import { safeOpen } from "../lib/safeOpen";
import type {
  Branch,
  BranchActionKind,
  CommitInfo,
  RepoView,
  SplitDiffFile,
  SplitHunk,
} from "../lib/types";
import { api, errorText } from "../lib/api";
import { useTheme } from "../lib/theme";
import { Modal } from "./Modal";

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-neutral-500">{label}</span>
      <span className={`text-xs text-neutral-300 ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

function ActionBtn({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
    >
      {icon}
      {label}
    </button>
  );
}

function CommitActionBtn({
  icon,
  title,
  onClick,
  disabled,
  danger,
}: {
  icon: ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`rounded p-0.5 disabled:opacity-30 ${
        danger ? "text-neutral-500 hover:text-rose-400" : "text-neutral-500 hover:text-neutral-200"
      }`}
    >
      {icon}
    </button>
  );
}

function RewordDialog({
  repoPath,
  commit,
  busy,
  onSubmit,
  onClose,
}: {
  repoPath: string;
  commit: CommitInfo;
  busy: boolean;
  onSubmit: (message: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [msg, setMsg] = useState(commit.subject);
  const [genning, setGenning] = useState<"simple" | "complet" | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  async function generate(mode: "simple" | "complet") {
    setGenning(mode);
    setGenError(null);
    try {
      setMsg((await api.generateCommitMessage(repoPath, commit.sha, mode)).trim());
    } catch (e) {
      setGenError(errorText(e));
    } finally {
      setGenning(null);
    }
  }

  return (
    <Modal title={t("branchDetail.reword.title")} onClose={onClose}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-neutral-500">{t("branchDetail.reword.generate")}&nbsp;:</span>
          {(["simple", "complet"] as const).map((m) => (
            <button
              key={m}
              onClick={() => generate(m)}
              disabled={!!genning || busy}
              title={
                m === "simple"
                  ? t("branchDetail.reword.simpleHint")
                  : t("branchDetail.reword.completHint")
              }
              className="inline-flex items-center gap-1 rounded-md border border-indigo-700 px-2 py-1 text-xs capitalize text-indigo-300 hover:bg-indigo-950/40 disabled:opacity-50"
            >
              {genning === m ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}{" "}
              {m === "simple" ? t("branchDetail.reword.simple") : t("branchDetail.reword.complet")}
            </button>
          ))}
        </div>
        {genError && (
          <div className="rounded-md border border-red-900 bg-red-950/40 px-2 py-1 text-[11px] text-red-300">
            {genError}
          </div>
        )}
        <textarea
          autoFocus
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          rows={5}
          className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-indigo-600"
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-neutral-400 hover:bg-neutral-800"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={() => onSubmit(msg.trim())}
            disabled={busy || !msg.trim()}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {t("common.save")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Tailwind classes for a split-diff line by kind. */
function splitLineClasses(kind: string): string {
  if (kind === "add") return "bg-emerald-950/30 text-emerald-300";
  if (kind === "del") return "bg-red-950/30 text-red-300";
  if (kind === "meta") return "text-neutral-600";
  return "text-neutral-400";
}
/** Leading marker shown (dimmed) before a split-diff line. */
function splitLineSign(kind: string): string {
  if (kind === "add") return "+";
  if (kind === "del") return "-";
  return " ";
}

/** Split one commit into two by picking which diff lines (or whole hunks / files) go into
 *  the first (lower) commit; the rest go into the second. A `git add -p`-style selector. */
function SplitDialog({
  repoPath,
  commit,
  busy,
  onSubmit,
  onClose,
}: {
  repoPath: string;
  commit: CommitInfo;
  busy: boolean;
  onSubmit: (lines: number[], msg1: string, msg2: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [files, setFiles] = useState<SplitDiffFile[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [msg1, setMsg1] = useState(commit.subject);
  const [msg2, setMsg2] = useState(commit.subject);

  useEffect(() => {
    let alive = true;
    setFiles(null);
    setLoadError(null);
    api
      .splitDiff(repoPath, commit.sha)
      .then((f) => alive && setFiles(f))
      .catch((e) => alive && setLoadError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [repoPath, commit.sha]);

  const allIds = useMemo(() => {
    const out: number[] = [];
    files?.forEach((f) =>
      f.hunks.forEach((h) =>
        h.lines.forEach((l) => {
          if (l.id != null) out.push(l.id);
        })
      )
    );
    return out;
  }, [files]);
  const total = allIds.length;
  const nSel = selected.size;
  const hasUnselectable = !!files?.some((f) => !f.selectable);
  const valid =
    files != null &&
    total > 0 &&
    nSel >= 1 &&
    (nSel < total || hasUnselectable) &&
    msg1.trim().length > 0 &&
    msg2.trim().length > 0;

  function setMany(ids: number[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });
  }
  const hunkIds = (h: SplitHunk): number[] =>
    h.lines.filter((l) => l.id != null).map((l) => l.id as number);
  const allOn = (ids: number[]) => ids.length > 0 && ids.every((id) => selected.has(id));

  return (
    <Modal title={t("branchDetail.split.title")} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs text-neutral-400">
          {t("branchDetail.split.introBefore")}{" "}
          <strong className="text-neutral-200">{t("branchDetail.split.introFirst")}</strong>{" "}
          {t("branchDetail.split.introAfter")} <code>git add -p</code>.
        </p>
        {loadError && (
          <div className="rounded-md border border-red-900 bg-red-950/40 px-2 py-1 text-[11px] text-red-300">
            {loadError}
          </div>
        )}
        {files === null && !loadError && (
          <p className="text-xs text-neutral-500">{t("branchDetail.split.analyzing")}</p>
        )}
        {files && total === 0 && !loadError && (
          <div className="rounded-md border border-amber-900 bg-amber-950/40 px-2 py-1 text-[11px] text-amber-300">
            {t("branchDetail.split.noSplittable")}
          </div>
        )}
        {files && total > 0 && (
          <>
            <div className="flex items-center gap-2 text-[11px] text-neutral-500">
              <button
                onClick={() => setMany(allIds, true)}
                className="rounded border border-neutral-700 px-1.5 py-0.5 hover:bg-neutral-800"
              >
                {t("branchDetail.split.checkAll")}
              </button>
              <button
                onClick={() => setMany(allIds, false)}
                className="rounded border border-neutral-700 px-1.5 py-0.5 hover:bg-neutral-800"
              >
                {t("branchDetail.split.uncheckAll")}
              </button>
              <span className="ml-auto">
                {nSel} → 1<sup>{t("branchDetail.split.ordFirst")}</sup> · {total - nSel} → 2
                <sup>{t("branchDetail.split.ordSecond")}</sup>
              </span>
            </div>
            <div className="max-h-72 overflow-auto rounded-md border border-neutral-800 font-mono text-[11px] leading-relaxed">
              {files.map((f) => {
                const fids = f.hunks.flatMap(hunkIds);
                return (
                  <div key={f.path} className="border-b border-neutral-800 last:border-0">
                    <div className="flex items-center gap-2 bg-neutral-900/70 px-2 py-1">
                      {f.selectable ? (
                        <input
                          type="checkbox"
                          checked={allOn(fids)}
                          onChange={(e) => setMany(fids, e.target.checked)}
                          className="accent-indigo-500"
                          title={t("branchDetail.split.wholeFile")}
                        />
                      ) : (
                        <span className="w-3.5 shrink-0" />
                      )}
                      <span className="truncate text-neutral-300">{f.path}</span>
                      {!f.selectable && (
                        <span className="ml-auto shrink-0 text-[10px] text-neutral-500">
                          → 2<sup>{t("branchDetail.split.ordSecond")}</sup>{" "}
                          {t("branchDetail.split.commitWord")}
                        </span>
                      )}
                    </div>
                    {f.selectable &&
                      f.hunks.map((h, hi) => {
                        const hids = hunkIds(h);
                        return (
                          <div key={hi}>
                            <div className="flex items-center gap-2 px-2 py-0.5 text-cyan-300/70">
                              <input
                                type="checkbox"
                                checked={allOn(hids)}
                                onChange={(e) => setMany(hids, e.target.checked)}
                                className="accent-indigo-500"
                                title={t("branchDetail.split.wholeHunk")}
                              />
                              <span className="truncate">{h.header}</span>
                            </div>
                            {h.lines.map((l, li) => (
                              <div
                                key={li}
                                className={`flex items-start gap-2 px-2 ${splitLineClasses(
                                  l.kind
                                )}`}
                              >
                                {l.id != null ? (
                                  <input
                                    type="checkbox"
                                    checked={selected.has(l.id)}
                                    onChange={() =>
                                      setMany([l.id as number], !selected.has(l.id as number))
                                    }
                                    className="mt-0.5 shrink-0 accent-indigo-500"
                                  />
                                ) : (
                                  <span className="w-3.5 shrink-0" />
                                )}
                                <span className="whitespace-pre-wrap break-all">
                                  <span className="select-none opacity-50">
                                    {splitLineSign(l.kind)}
                                  </span>
                                  {l.text || " "}
                                </span>
                              </div>
                            ))}
                          </div>
                        );
                      })}
                  </div>
                );
              })}
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-neutral-500">
                {t("branchDetail.split.msg1Before")}1<sup>{t("branchDetail.split.ordFirst")}</sup>{" "}
                {t("branchDetail.split.msg1After")}
              </label>
              <textarea
                value={msg1}
                onChange={(e) => setMsg1(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-indigo-600"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-neutral-500">
                {t("branchDetail.split.msg2Before")}2<sup>{t("branchDetail.split.ordSecond")}</sup>{" "}
                {t("branchDetail.split.msg2After")}
              </label>
              <textarea
                value={msg2}
                onChange={(e) => setMsg2(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-indigo-600"
              />
            </div>
          </>
        )}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-neutral-400 hover:bg-neutral-800"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={() => onSubmit([...selected], msg1.trim(), msg2.trim())}
            disabled={busy || !valid}
            title={valid ? "" : t("branchDetail.split.invalidHint")}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            <Scissors className="h-3.5 w-3.5" /> Split
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function BranchDetail({
  repoPath,
  branch,
  onAction,
  onClose,
  onOpenPr,
  onEdited,
}: {
  repoPath: string;
  branch: Branch;
  onAction: (kind: BranchActionKind, branch: Branch) => void;
  onClose: () => void;
  onOpenPr?: (number: number) => void;
  /** Called with the refreshed view after a commit edit. */
  onEdited?: (view: RepoView) => void;
}) {
  const { t } = useTranslation();
  const { isModern } = useTheme();
  const [commits, setCommits] = useState<CommitInfo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    | { kind: "reword"; commit: CommitInfo }
    | { kind: "drop"; commit: CommitInfo }
    | { kind: "split"; commit: CommitInfo }
    | null
  >(null);

  useEffect(() => {
    let alive = true;
    setCommits(null);
    setEditError(null);
    api
      .branchCommits(repoPath, branch.name)
      .then((c) => alive && setCommits(c))
      .catch(() => alive && setCommits([]));
    return () => {
      alive = false;
    };
  }, [repoPath, branch.name]);

  // Run a commit-edit mutation, then refresh the branch's commit list and the
  // parent view. Conflicts come back inside the returned view (handled in App).
  async function runEdit(p: Promise<RepoView>) {
    setBusy(true);
    setEditError(null);
    try {
      const view = await p;
      onEdited?.(view);
      setCommits(await api.branchCommits(repoPath, branch.name));
    } catch (e) {
      setEditError(errorText(e));
    } finally {
      setBusy(false);
      setDialog(null);
    }
  }

  return (
    <>
    <aside className="flex h-full w-full flex-col border-l border-neutral-800 bg-neutral-900/40">
      <div
        className={`flex items-center gap-2 border-b border-neutral-800 px-4 ${
          isModern ? "h-16" : "h-14"
        }`}
      >
        {isModern && <GitBranch className="h-4 w-4 shrink-0 text-indigo-400" />}
        <span className="truncate font-mono text-sm text-neutral-100">{branch.name}</span>
        {branch.isTrunk && (
          <span className="rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] text-amber-300">
            {t("branchDetail.trunkBadge")}
          </span>
        )}
        {branch.isCurrent && (
          <span className="rounded bg-indigo-900/60 px-1.5 py-0.5 text-[10px] text-indigo-300">
            HEAD
          </span>
        )}
        <button
          onClick={onClose}
          className="ml-auto rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-auto p-4">
        <div className="space-y-1.5">
          <Row
            label={t("branchDetail.rows.parent")}
            value={branch.parent ?? (branch.isTrunk ? "—" : t("branchDetail.rows.untracked"))}
            mono
          />
          {!branch.isTrunk && (
            <Row
              label={t("branchDetail.rows.status")}
              value={t("branchDetail.rows.aheadBehind", {
                ahead: branch.ahead,
                behind: branch.behind,
              })}
            />
          )}
          {branch.baseSha && (
            <Row label={t("branchDetail.rows.base")} value={branch.baseSha.slice(0, 8)} mono />
          )}
          <Row
            label={t("branchDetail.rows.workingTree")}
            value={branch.dirty ? t("branchDetail.rows.uncommitted") : t("branchDetail.rows.clean")}
          />
          <Row
            label={t("branchDetail.rows.remote")}
            value={branch.needsPush ? t("branchDetail.rows.unpushed") : t("branchDetail.rows.upToDate")}
          />
        </div>

        <div>
          <h4 className="mb-1 text-xs uppercase tracking-wider text-neutral-500">
            {t("branchDetail.pr.heading")}
          </h4>
          {branch.pr ? (
            <div className="flex items-center gap-2 rounded-md border border-neutral-700 px-3 py-2">
              <button
                onClick={() => branch.pr && onOpenPr?.(branch.pr.number)}
                title={t("branchDetail.pr.viewDetails")}
                className="flex flex-1 items-center gap-2 text-left"
              >
                <span className="font-mono text-xs text-neutral-200">#{branch.pr.number}</span>
                <span className="text-xs text-neutral-400">{branch.pr.state}</span>
                {branch.pr.reviewDecision && (
                  <span className="text-xs text-neutral-500">{branch.pr.reviewDecision}</span>
                )}
                {branch.pr.checks && (
                  <span
                    className={`text-xs ${
                      branch.pr.checks === "SUCCESS"
                        ? "text-emerald-400"
                        : branch.pr.checks === "FAILURE"
                        ? "text-red-400"
                        : "text-amber-400"
                    }`}
                  >
                    CI {branch.pr.checks}
                  </span>
                )}
              </button>
              <button
                onClick={() => branch.pr && safeOpen(branch.pr.url)}
                title={t("branchDetail.pr.openOnGithub")}
                className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <p className="text-xs text-neutral-600">{t("branchDetail.pr.none")}</p>
          )}
        </div>

        <div>
          <h4 className="mb-1 text-xs uppercase tracking-wider text-neutral-500">
            {branch.isTrunk
              ? t("branchDetail.commits.recent")
              : t("branchDetail.commits.onThisBranch")}
          </h4>
          {commits === null && <p className="text-xs text-neutral-600">{t("common.loading")}</p>}
          {commits && commits.length === 0 && (
            <p className="text-xs text-neutral-600">{t("branchDetail.commits.none")}</p>
          )}
          {editError && (
            <div className="mb-2 rounded-md border border-red-900 bg-red-950/40 px-2 py-1 text-[11px] text-red-300">
              {editError}
            </div>
          )}
          <ul className="space-y-0.5">
            {commits?.map((c, i) => {
              const isNewest = i === 0;
              const isOldest = i === commits.length - 1;
              return (
                <li
                  key={c.sha}
                  className="group flex items-start gap-2 rounded-md px-1 py-1 hover:bg-neutral-900"
                >
                  <span className="mt-0.5 font-mono text-[11px] text-amber-300/80">{c.sha}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-neutral-200">{c.subject}</p>
                    <p className="text-[10px] text-neutral-600">
                      {c.author} · {c.date}
                    </p>
                  </div>
                  {!branch.isTrunk && (
                    <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                      <CommitActionBtn
                        title={t("branchDetail.commitActions.reword")}
                        icon={<Pencil className="h-3.5 w-3.5" />}
                        onClick={() => setDialog({ kind: "reword", commit: c })}
                        disabled={busy}
                      />
                      <CommitActionBtn
                        title={t("branchDetail.commitActions.split")}
                        icon={<Scissors className="h-3.5 w-3.5" />}
                        onClick={() => setDialog({ kind: "split", commit: c })}
                        disabled={busy}
                      />
                      <CommitActionBtn
                        title={t("branchDetail.commitActions.squash")}
                        icon={<Combine className="h-3.5 w-3.5" />}
                        onClick={() => runEdit(api.squashCommit(repoPath, branch.name, c.sha))}
                        disabled={busy || isOldest}
                      />
                      <CommitActionBtn
                        title={t("branchDetail.commitActions.moveNewer")}
                        icon={<ArrowUp className="h-3.5 w-3.5" />}
                        onClick={() => runEdit(api.moveCommit(repoPath, branch.name, c.sha, "up"))}
                        disabled={busy || isNewest}
                      />
                      <CommitActionBtn
                        title={t("branchDetail.commitActions.moveOlder")}
                        icon={<ArrowDown className="h-3.5 w-3.5" />}
                        onClick={() => runEdit(api.moveCommit(repoPath, branch.name, c.sha, "down"))}
                        disabled={busy || isOldest}
                      />
                      <CommitActionBtn
                        title={t("branchDetail.commitActions.drop")}
                        icon={<Trash2 className="h-3.5 w-3.5" />}
                        onClick={() => setDialog({ kind: "drop", commit: c })}
                        disabled={busy}
                        danger
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <div className="border-t border-neutral-800 p-3">
        <div className="flex flex-wrap gap-1.5">
          {!branch.isCurrent && (
            <ActionBtn
              icon={<ArrowRightToLine className="h-3.5 w-3.5" />}
              label={t("branchDetail.actions.checkout")}
              onClick={() => onAction("checkout", branch)}
            />
          )}
          <ActionBtn
            icon={<Plus className="h-3.5 w-3.5" />}
            label={t("branchDetail.actions.newBranch")}
            onClick={() => onAction("new-child", branch)}
          />
          <ActionBtn
            icon={<GitMerge className="h-3.5 w-3.5" />}
            label={t("branchDetail.actions.merge")}
            onClick={() => onAction("merge", branch)}
          />
          {!branch.isTrunk && branch.needsPush && (
            <ActionBtn
              icon={<UploadCloud className="h-3.5 w-3.5" />}
              label={t("branchDetail.actions.publish")}
              onClick={() => onAction("publish", branch)}
            />
          )}
          {!branch.isTrunk &&
            (branch.tracked ? (
              <>
                <ActionBtn
                  icon={<Layers className="h-3.5 w-3.5" />}
                  label={t("branchDetail.actions.restack")}
                  onClick={() => onAction("restack", branch)}
                />
                <ActionBtn
                  icon={<GitFork className="h-3.5 w-3.5" />}
                  label={t("branchDetail.actions.setParent")}
                  onClick={() => onAction("set-parent", branch)}
                />
                <ActionBtn
                  icon={<Unlink className="h-3.5 w-3.5" />}
                  label={t("branchDetail.actions.untrack")}
                  onClick={() => onAction("untrack", branch)}
                />
              </>
            ) : (
              <ActionBtn
                icon={<LinkIcon className="h-3.5 w-3.5" />}
                label={t("branchDetail.actions.track")}
                onClick={() => onAction("track", branch)}
              />
            ))}
        </div>
      </div>
    </aside>

      {dialog?.kind === "reword" && (
        <RewordDialog
          repoPath={repoPath}
          commit={dialog.commit}
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={(msg) =>
            runEdit(api.rewordCommit(repoPath, branch.name, dialog.commit.sha, msg))
          }
        />
      )}
      {dialog?.kind === "split" && (
        <SplitDialog
          repoPath={repoPath}
          commit={dialog.commit}
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={(lines, msg1, msg2) =>
            runEdit(
              api.splitCommit(repoPath, branch.name, dialog.commit.sha, lines, msg1, msg2)
            )
          }
        />
      )}
      {dialog?.kind === "drop" && (
        <Modal title={t("branchDetail.drop.title")} onClose={() => setDialog(null)}>
          <div className="space-y-3">
            <p className="text-sm text-neutral-300">
              {t("branchDetail.drop.confirmBefore")}{" "}
              <span className="font-mono text-amber-300">{dialog.commit.sha}</span> “
              {dialog.commit.subject}” {t("branchDetail.drop.confirmAfter")}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDialog(null)}
                className="rounded-md px-3 py-1.5 text-sm text-neutral-400 hover:bg-neutral-800"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={() =>
                  runEdit(api.dropCommit(repoPath, branch.name, dialog.commit.sha))
                }
                disabled={busy}
                className="rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-500 disabled:opacity-50"
              >
                Drop
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
