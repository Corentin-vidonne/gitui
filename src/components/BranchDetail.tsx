import { useEffect, useState } from "react";
import type { ReactNode } from "react";
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
  ArrowUp,
  ArrowDown,
  Trash2,
  GitBranch,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Branch, BranchActionKind, CommitInfo, RepoView } from "../lib/types";
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
  commit,
  busy,
  onSubmit,
  onClose,
}: {
  commit: CommitInfo;
  busy: boolean;
  onSubmit: (message: string) => void;
  onClose: () => void;
}) {
  const [msg, setMsg] = useState(commit.subject);
  return (
    <Modal title="Reword commit" onClose={onClose}>
      <div className="space-y-3">
        <textarea
          autoFocus
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          rows={4}
          className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-indigo-600"
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-neutral-400 hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            onClick={() => onSubmit(msg.trim())}
            disabled={busy || !msg.trim()}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            Save
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
  const { isModern } = useTheme();
  const [commits, setCommits] = useState<CommitInfo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    { kind: "reword"; commit: CommitInfo } | { kind: "drop"; commit: CommitInfo } | null
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
            trunk
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
            label="Parent"
            value={branch.parent ?? (branch.isTrunk ? "—" : "untracked")}
            mono
          />
          {!branch.isTrunk && (
            <Row label="Status" value={`${branch.ahead} ahead · ${branch.behind} behind`} />
          )}
          {branch.baseSha && <Row label="Base" value={branch.baseSha.slice(0, 8)} mono />}
          <Row
            label="Working tree"
            value={branch.dirty ? "uncommitted changes" : "clean"}
          />
          <Row
            label="Remote"
            value={branch.needsPush ? "unpushed commits" : "up to date"}
          />
        </div>

        <div>
          <h4 className="mb-1 text-xs uppercase tracking-wider text-neutral-500">
            Pull request
          </h4>
          {branch.pr ? (
            <div className="flex items-center gap-2 rounded-md border border-neutral-700 px-3 py-2">
              <button
                onClick={() => branch.pr && onOpenPr?.(branch.pr.number)}
                title="View PR details"
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
                onClick={() => branch.pr && openUrl(branch.pr.url)}
                title="Open on GitHub"
                className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <p className="text-xs text-neutral-600">No PR yet.</p>
          )}
        </div>

        <div>
          <h4 className="mb-1 text-xs uppercase tracking-wider text-neutral-500">
            {branch.isTrunk ? "Recent commits" : "Commits on this branch"}
          </h4>
          {commits === null && <p className="text-xs text-neutral-600">Loading…</p>}
          {commits && commits.length === 0 && (
            <p className="text-xs text-neutral-600">No commits.</p>
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
                        title="Reword"
                        icon={<Pencil className="h-3.5 w-3.5" />}
                        onClick={() => setDialog({ kind: "reword", commit: c })}
                        disabled={busy}
                      />
                      <CommitActionBtn
                        title="Squash into older commit"
                        icon={<Combine className="h-3.5 w-3.5" />}
                        onClick={() => runEdit(api.squashCommit(repoPath, branch.name, c.sha))}
                        disabled={busy || isOldest}
                      />
                      <CommitActionBtn
                        title="Move newer"
                        icon={<ArrowUp className="h-3.5 w-3.5" />}
                        onClick={() => runEdit(api.moveCommit(repoPath, branch.name, c.sha, "up"))}
                        disabled={busy || isNewest}
                      />
                      <CommitActionBtn
                        title="Move older"
                        icon={<ArrowDown className="h-3.5 w-3.5" />}
                        onClick={() => runEdit(api.moveCommit(repoPath, branch.name, c.sha, "down"))}
                        disabled={busy || isOldest}
                      />
                      <CommitActionBtn
                        title="Drop"
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
              label="Checkout"
              onClick={() => onAction("checkout", branch)}
            />
          )}
          <ActionBtn
            icon={<Plus className="h-3.5 w-3.5" />}
            label="New branch"
            onClick={() => onAction("new-child", branch)}
          />
          {!branch.isTrunk && branch.needsPush && (
            <ActionBtn
              icon={<UploadCloud className="h-3.5 w-3.5" />}
              label="Publish"
              onClick={() => onAction("publish", branch)}
            />
          )}
          {!branch.isTrunk &&
            (branch.tracked ? (
              <>
                <ActionBtn
                  icon={<Layers className="h-3.5 w-3.5" />}
                  label="Restack"
                  onClick={() => onAction("restack", branch)}
                />
                <ActionBtn
                  icon={<GitFork className="h-3.5 w-3.5" />}
                  label="Set parent"
                  onClick={() => onAction("set-parent", branch)}
                />
                <ActionBtn
                  icon={<Unlink className="h-3.5 w-3.5" />}
                  label="Untrack"
                  onClick={() => onAction("untrack", branch)}
                />
              </>
            ) : (
              <ActionBtn
                icon={<LinkIcon className="h-3.5 w-3.5" />}
                label="Track"
                onClick={() => onAction("track", branch)}
              />
            ))}
        </div>
      </div>
    </aside>

      {dialog?.kind === "reword" && (
        <RewordDialog
          commit={dialog.commit}
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={(msg) =>
            runEdit(api.rewordCommit(repoPath, branch.name, dialog.commit.sha, msg))
          }
        />
      )}
      {dialog?.kind === "drop" && (
        <Modal title="Drop commit" onClose={() => setDialog(null)}>
          <div className="space-y-3">
            <p className="text-sm text-neutral-300">
              Drop <span className="font-mono text-amber-300">{dialog.commit.sha}</span> “
              {dialog.commit.subject}”? This rewrites the branch history.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDialog(null)}
                className="rounded-md px-3 py-1.5 text-sm text-neutral-400 hover:bg-neutral-800"
              >
                Cancel
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
