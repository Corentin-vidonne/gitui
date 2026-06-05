import { useEffect, useState } from "react";
import { Sparkles, X, Check, Loader2 } from "lucide-react";
import Markdown from "react-markdown";
import { api } from "../lib/api";
import type { UpdateItem } from "../lib/types";

/** A one-shot "since your last visit" digest, shown at the top of a repo when there's
 * been activity. The summary is written by Claude from the already-fetched update items;
 * if that fails it falls back to a plain list. "Vu" marks the updates seen. */
export function DigestBanner({
  repoPath,
  items,
  onSeen,
  onDismiss,
}: {
  repoPath: string;
  items: UpdateItem[];
  onSeen: () => void;
  onDismiss: () => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setText(null);
    setFailed(false);
    api
      .summarizeUpdates(repoPath, items)
      .then((t) => {
        if (alive) setText(t.trim());
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
    // Regenerate only when the repo changes (items are stable while it's shown).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoPath]);

  return (
    <div className="flex items-start gap-3 border-b border-indigo-900/50 bg-indigo-950/30 px-4 py-2.5">
      <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-indigo-400" />
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 text-[11px] font-medium uppercase tracking-wider text-indigo-300/80">
          Depuis ta dernière visite · {items.length} nouveauté{items.length > 1 ? "s" : ""}
        </div>
        {text === null && !failed ? (
          <div className="flex items-center gap-1.5 text-xs text-neutral-400">
            <Loader2 className="h-3 w-3 animate-spin" /> Résumé en cours…
          </div>
        ) : failed ? (
          <ul className="space-y-0.5 text-xs text-neutral-300">
            {items.slice(0, 6).map((it, i) => (
              <li key={i} className="truncate">
                • {it.title}
                {it.detail ? ` — ${it.detail}` : ""}
              </li>
            ))}
            {items.length > 6 && (
              <li className="text-neutral-500">… et {items.length - 6} de plus</li>
            )}
          </ul>
        ) : (
          <div className="text-sm leading-relaxed text-neutral-200 [&_a]:text-indigo-400 [&_code]:rounded [&_code]:bg-neutral-800 [&_code]:px-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-0.5 [&_strong]:text-neutral-100 [&_ul]:list-disc [&_ul]:pl-5">
            <Markdown>{text ?? ""}</Markdown>
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={onSeen}
          title="Marquer comme vu"
          className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-500"
        >
          <Check className="h-3.5 w-3.5" /> Vu
        </button>
        <button
          onClick={onDismiss}
          title="Masquer pour l'instant"
          className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
