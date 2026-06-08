import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import Markdown from "react-markdown";
import { Sparkles, X } from "lucide-react";

const LAST_SEEN_KEY = "gitui.lastSeenVersion";
const REPO = "Corentin-vidonne/gitui";

// "What's new" dialog shown once after the app updates: on launch, if the running version
// differs from the last one we recorded, fetch that version's GitHub release notes and show
// them. First run ever just records the version silently (a fresh install isn't an update),
// and a version with no published notes shows nothing. Fetch hits the public GitHub API
// (allowed in the CSP connect-src); failures are non-fatal.
export function WhatsNewDialog() {
  const [version, setVersion] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      let v: string;
      try {
        v = await getVersion();
      } catch {
        return;
      }
      const last = localStorage.getItem(LAST_SEEN_KEY);
      if (last === v) return; // already on this version (or already shown)
      if (!last) {
        localStorage.setItem(LAST_SEEN_KEY, v); // first run → baseline, not an update
        return;
      }
      let body = "";
      try {
        const res = await fetch(
          `https://api.github.com/repos/${REPO}/releases/tags/v${v}`,
          { headers: { Accept: "application/vnd.github+json" } }
        );
        if (res.ok) body = (((await res.json()) as { body?: string }).body ?? "").trim();
      } catch {
        // offline / API error — non-fatal
      }
      if (!alive) return;
      if (body) {
        setVersion(v);
        setNotes(body);
      } else {
        localStorage.setItem(LAST_SEEN_KEY, v); // nothing to show — just record it
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!version || notes == null) return null;

  function close() {
    if (version) localStorage.setItem(LAST_SEEN_KEY, version);
    setVersion(null);
    setNotes(null);
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
      onClick={close}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-neutral-800 px-4 py-3">
          <Sparkles className="h-4 w-4 text-indigo-400" />
          <h2 className="text-sm font-semibold text-neutral-100">
            Quoi de neuf — gitui {version}
          </h2>
          <button
            onClick={close}
            title="Fermer"
            className="ml-auto rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-auto px-4 py-3 text-sm leading-relaxed text-neutral-200 [&_a]:text-indigo-400 [&_code]:rounded [&_code]:bg-neutral-800 [&_code]:px-1 [&_h1]:mb-1 [&_h1]:mt-3 [&_h1]:text-base [&_h1]:font-semibold [&_h1]:text-neutral-100 [&_h2]:mb-1 [&_h2]:mt-3 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-neutral-100 [&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:font-semibold [&_h3]:text-neutral-100 [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_strong]:text-neutral-100 [&_ul]:list-disc [&_ul]:pl-5">
          <Markdown>{notes}</Markdown>
        </div>
        <div className="flex justify-end border-t border-neutral-800 px-4 py-3">
          <button
            onClick={close}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
          >
            Compris
          </button>
        </div>
      </div>
    </div>
  );
}
