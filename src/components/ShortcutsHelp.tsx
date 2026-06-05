import { Modal } from "./Modal";

const SHORTCUTS: [string, string][] = [
  ["Ctrl / ⌘ + K", "Palette de commandes"],
  ["?", "Afficher cette aide"],
  ["1 – 6", "Vue : graphe · commits · tree · PRs · issues · docs"],
  ["s", "Sync"],
  ["r", "Restack all"],
  ["n", "Nouvelle branche"],
  ["p", "Submit"],
  ["u", "Undo"],
];

export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Raccourcis clavier" onClose={onClose}>
      <ul className="space-y-1.5">
        {SHORTCUTS.map(([k, label]) => (
          <li key={k} className="flex items-center justify-between gap-4 text-sm">
            <span className="text-neutral-300">{label}</span>
            <kbd className="shrink-0 rounded border border-neutral-700 bg-neutral-950 px-1.5 py-0.5 font-mono text-[11px] text-neutral-400">
              {k}
            </kbd>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-neutral-500">
        Les raccourcis à une touche sont ignorés pendant la saisie dans un champ.
      </p>
    </Modal>
  );
}
