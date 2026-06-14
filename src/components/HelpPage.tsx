import { X, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

type Item = { id?: string; name: string; desc: string };

function Section({
  title,
  items,
  onTest,
}: {
  title: string;
  items: Item[];
  onTest: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mb-4">
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-indigo-300/80">
        {title}
      </h3>
      <ul className="space-y-1.5">
        {items.map((it) => (
          <li key={it.name} className="flex items-start gap-2 text-sm">
            <div className="min-w-0 flex-1">
              <span className="font-medium text-neutral-200">{it.name}</span>
              <span className="text-neutral-400"> — {it.desc}</span>
            </div>
            {it.id && (
              <button
                onClick={() => onTest(it.id as string)}
                title={t("helpPage.testTitle")}
                className="shrink-0 rounded border border-indigo-700 px-2 py-0.5 text-[11px] font-medium text-indigo-300 hover:bg-indigo-950/40"
              >
                {t("helpPage.test")}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Reference page describing everything the app does. Each feature has a "Tester" button
 * that launches a focused, live guide for it; the header launches the full tour. */
export function HelpPage({
  onClose,
  onStartTour,
  onTest,
}: {
  onClose: () => void;
  onStartTour: () => void;
  onTest: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[6vh]"
      onClick={onClose}
    >
      <div
        className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-b border-neutral-800 px-5 py-3">
          <h2 className="text-sm font-semibold text-neutral-100">{t("helpPage.headerTitle")}</h2>
          <button
            onClick={onStartTour}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
          >
            <Sparkles className="h-3.5 w-3.5" /> {t("helpPage.replayGuide")}
          </button>
          <button
            onClick={onClose}
            className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="overflow-auto px-5 py-4">
          <p className="mb-4 text-sm text-neutral-400">
            {t("helpPage.intro.before")}{" "}
            <strong className="text-neutral-200">{t("helpPage.intro.stacks")}</strong>{" "}
            {t("helpPage.intro.middle1")}{" "}
            <strong className="text-indigo-300">{t("helpPage.test")}</strong>{" "}
            {t("helpPage.intro.middle2")}{" "}
            <strong className="text-indigo-300">{t("helpPage.replayGuide")}</strong>{" "}
            {t("helpPage.intro.after")}
          </p>

          <Section
            title={t("helpPage.sections.views.title")}
            onTest={onTest}
            items={[
              { id: "view-graph", name: t("helpPage.sections.views.branchGraph.name"), desc: t("helpPage.sections.views.branchGraph.desc") },
              { id: "view-commits", name: t("helpPage.sections.views.commitGraph.name"), desc: t("helpPage.sections.views.commitGraph.desc") },
              { id: "tree", name: t("helpPage.sections.views.tree.name"), desc: t("helpPage.sections.views.tree.desc") },
              { id: "prs", name: t("helpPage.sections.views.prs.name"), desc: t("helpPage.sections.views.prs.desc") },
              { id: "issues", name: t("helpPage.sections.views.issues.name"), desc: t("helpPage.sections.views.issues.desc") },
              { id: "docs", name: t("helpPage.sections.views.docs.name"), desc: t("helpPage.sections.views.docs.desc") },
            ]}
          />
          <Section
            title={t("helpPage.sections.branches.title")}
            onTest={onTest}
            items={[
              { id: "new-branch", name: t("helpPage.sections.branches.newBranch.name"), desc: t("helpPage.sections.branches.newBranch.desc") },
              { id: "branch-ops", name: t("helpPage.sections.branches.branchOps.name"), desc: t("helpPage.sections.branches.branchOps.desc") },
              { id: "branch-ops", name: t("helpPage.sections.branches.restack.name"), desc: t("helpPage.sections.branches.restack.desc") },
              { id: "branch-ops", name: t("helpPage.sections.branches.merge.name"), desc: t("helpPage.sections.branches.merge.desc") },
            ]}
          />
          <Section
            title={t("helpPage.sections.commits.title")}
            onTest={onTest}
            items={[
              { id: "commit-ops", name: t("helpPage.sections.commits.reword.name"), desc: t("helpPage.sections.commits.reword.desc") },
              { id: "commit-ops", name: t("helpPage.sections.commits.split.name"), desc: t("helpPage.sections.commits.split.desc") },
              { id: "commit-ops", name: t("helpPage.sections.commits.dropSquashMove.name"), desc: t("helpPage.sections.commits.dropSquashMove.desc") },
              { id: "commit-ops", name: t("helpPage.sections.commits.cherryPick.name"), desc: t("helpPage.sections.commits.cherryPick.desc") },
              { id: "commit-ops", name: t("helpPage.sections.commits.aiReview.name"), desc: t("helpPage.sections.commits.aiReview.desc") },
            ]}
          />
          <Section
            title={t("helpPage.sections.stack.title")}
            onTest={onTest}
            items={[
              { id: "sync", name: t("helpPage.sections.stack.sync.name"), desc: t("helpPage.sections.stack.sync.desc") },
              { id: "sync", name: t("helpPage.sections.stack.restackAll.name"), desc: t("helpPage.sections.stack.restackAll.desc") },
              { id: "submit", name: t("helpPage.sections.stack.submit.name"), desc: t("helpPage.sections.stack.submit.desc") },
              { id: "sync", name: t("helpPage.sections.stack.undo.name"), desc: t("helpPage.sections.stack.undo.desc") },
            ]}
          />
          <Section
            title={t("helpPage.sections.stashes.title")}
            onTest={onTest}
            items={[
              { id: "stash", name: t("helpPage.sections.stashes.viewContent.name"), desc: t("helpPage.sections.stashes.viewContent.desc") },
              { id: "stash", name: t("helpPage.sections.stashes.applyPopDrop.name"), desc: t("helpPage.sections.stashes.applyPopDrop.desc") },
              { id: "stash", name: t("helpPage.sections.stashes.stasher.name"), desc: t("helpPage.sections.stashes.stasher.desc") },
            ]}
          />
          <Section
            title={t("helpPage.sections.ai.title")}
            onTest={onTest}
            items={[
              { id: "commit-ops", name: t("helpPage.sections.ai.summaryDetailed.name"), desc: t("helpPage.sections.ai.summaryDetailed.desc") },
              { id: "claude", name: t("helpPage.sections.ai.askClaude.name"), desc: t("helpPage.sections.ai.askClaude.desc") },
              { id: "branch-ops", name: t("helpPage.sections.ai.mergeHelp.name"), desc: t("helpPage.sections.ai.mergeHelp.desc") },
              { name: t("helpPage.sections.ai.resolveConflicts.name"), desc: t("helpPage.sections.ai.resolveConflicts.desc") },
              { name: t("helpPage.sections.ai.digest.name"), desc: t("helpPage.sections.ai.digest.desc") },
            ]}
          />
          <Section
            title={t("helpPage.sections.pullRequests.title")}
            onTest={onTest}
            items={[
              { id: "prs", name: t("helpPage.sections.pullRequests.review.name"), desc: t("helpPage.sections.pullRequests.review.desc") },
              { id: "prs", name: t("helpPage.sections.pullRequests.ciChecks.name"), desc: t("helpPage.sections.pullRequests.ciChecks.desc") },
              { id: "view-graph", name: t("helpPage.sections.pullRequests.badges.name"), desc: t("helpPage.sections.pullRequests.badges.desc") },
            ]}
          />
          <Section
            title={t("helpPage.sections.productivity.title")}
            onTest={onTest}
            items={[
              { id: "palette", name: t("helpPage.sections.productivity.commandPalette.name"), desc: t("helpPage.sections.productivity.commandPalette.desc") },
              { id: "shortcuts", name: t("helpPage.sections.productivity.shortcuts.name"), desc: t("helpPage.sections.productivity.shortcuts.desc") },
              { id: "commit-search", name: t("helpPage.sections.productivity.commitSearch.name"), desc: t("helpPage.sections.productivity.commitSearch.desc") },
            ]}
          />
          <Section
            title={t("helpPage.sections.settings.title")}
            onTest={onTest}
            items={[
              { name: t("helpPage.sections.settings.theme.name"), desc: t("helpPage.sections.settings.theme.desc") },
              { name: t("helpPage.sections.settings.assistantUi.name"), desc: t("helpPage.sections.settings.assistantUi.desc") },
              { name: t("helpPage.sections.settings.aiBackend.name"), desc: t("helpPage.sections.settings.aiBackend.desc") },
              { name: t("helpPage.sections.settings.notifications.name"), desc: t("helpPage.sections.settings.notifications.desc") },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
