import { useTranslation } from "react-i18next";
import { Modal } from "./Modal";

const SHORTCUTS = (t: (key: string) => string): [string, string][] => [
  ["Ctrl / ⌘ + K", t("shortcutsHelp.commandPalette")],
  ["Ctrl / ⌘ + `", t("shortcutsHelp.terminal")],
  ["?", t("shortcutsHelp.showHelp")],
  ["1 – 6", t("shortcutsHelp.views")],
  ["s", "Sync"],
  ["r", "Restack all"],
  ["n", t("shortcutsHelp.newBranch")],
  ["p", "Submit"],
  ["u", "Undo"],
];

export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Modal title={t("shortcutsHelp.title")} onClose={onClose}>
      <ul className="space-y-1.5">
        {SHORTCUTS(t).map(([k, label]) => (
          <li key={k} className="flex items-center justify-between gap-4 text-sm">
            <span className="text-neutral-300">{label}</span>
            <kbd className="shrink-0 rounded border border-neutral-700 bg-neutral-950 px-1.5 py-0.5 font-mono text-[11px] text-neutral-400">
              {k}
            </kbd>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-neutral-500">
        {t("shortcutsHelp.singleKeyNote")}
      </p>
    </Modal>
  );
}
