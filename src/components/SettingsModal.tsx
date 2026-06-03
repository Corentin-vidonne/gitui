import { useState } from "react";
import { Check } from "lucide-react";
import { Modal } from "./Modal";
import type { Settings } from "../lib/settings";
import { useTheme, type ThemeName } from "../lib/theme";

// Live preview swatches per theme: [background, surface/border, accent]. These
// are intentionally literal hex values — they illustrate each theme's palette.
const THEME_OPTIONS: {
  value: ThemeName;
  label: string;
  hint: string;
  swatch: [string, string, string];
}[] = [
  {
    value: "classic",
    label: "Classique",
    hint: "Sombre neutre · indigo",
    swatch: ["#0a0a0a", "#262626", "#4f46e5"],
  },
  {
    value: "modern",
    label: "Modern",
    hint: "Bleu-encre · teal",
    swatch: ["#0b0d12", "#232a38", "#14b8a6"],
  },
];

export function SettingsModal({
  settings,
  onSave,
  onClose,
}: {
  settings: Settings;
  onSave: (s: Settings) => void;
  onClose: () => void;
}) {
  const { theme, setTheme } = useTheme();
  const [pollSec, setPollSec] = useState(Math.round(settings.pollIntervalMs / 1000));
  const [notifications, setNotifications] = useState(settings.notifications);

  function save() {
    const sec = Math.max(30, Number.isFinite(pollSec) ? pollSec : 180);
    onSave({ pollIntervalMs: sec * 1000, notifications });
  }

  return (
    <Modal title="Settings" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-neutral-300">
            Appearance
          </label>
          <div className="grid grid-cols-2 gap-2">
            {THEME_OPTIONS.map((opt) => {
              const active = theme === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setTheme(opt.value)}
                  className={`relative rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    active
                      ? "border-indigo-500 bg-indigo-950/40 ring-1 ring-indigo-500/40"
                      : "border-neutral-700 hover:border-neutral-600 hover:bg-neutral-800/40"
                  }`}
                >
                  {active && (
                    <Check className="absolute right-2 top-2 h-3.5 w-3.5 text-indigo-300" />
                  )}
                  <div className="mb-1.5 flex gap-1">
                    {opt.swatch.map((c) => (
                      <span
                        key={c}
                        className="h-3.5 w-3.5 rounded-full ring-1 ring-black/40"
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                  <div className="text-sm font-medium text-neutral-100">{opt.label}</div>
                  <div className="text-[10px] text-neutral-500">{opt.hint}</div>
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-[10px] text-neutral-500">
            Switches instantly. The classic look stays available at any time.
          </p>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-300">
            Update polling interval (seconds)
          </label>
          <input
            type="number"
            min={30}
            step={30}
            value={pollSec}
            onChange={(e) => setPollSec(parseInt(e.target.value, 10))}
            className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-indigo-600"
          />
          <p className="mt-1 text-[10px] text-neutral-500">
            How often gitui checks repos for new commits, PRs and issues. Minimum 30s.
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm text-neutral-300">
          <input
            type="checkbox"
            checked={notifications}
            onChange={(e) => setNotifications(e.target.checked)}
            className="accent-indigo-600"
          />
          Desktop notifications for new activity
        </label>

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-neutral-400 hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}
