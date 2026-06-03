// User preferences, persisted in localStorage. Kept deliberately small for now.

export type Settings = {
  /** How often to poll repos for new activity, in milliseconds. */
  pollIntervalMs: number;
  /** Whether to fire desktop notifications for new activity. */
  notifications: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  pollIntervalMs: 180_000,
  notifications: true,
};

const SETTINGS_KEY = "gitui.settings";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const p = JSON.parse(raw) as Partial<Settings>;
    return {
      pollIntervalMs:
        typeof p.pollIntervalMs === "number" && p.pollIntervalMs >= 30_000
          ? p.pollIntervalMs
          : DEFAULT_SETTINGS.pollIntervalMs,
      notifications:
        typeof p.notifications === "boolean"
          ? p.notifications
          : DEFAULT_SETTINGS.notifications,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}
