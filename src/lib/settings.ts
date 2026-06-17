// User preferences, persisted in localStorage. Kept deliberately small for now.

/** Where the read-only AI aides (Summary / Detailed) are rendered. */
export type AssistantUi = "chat" | "terminal";

/** Engine behind the `claude` CLI: Anthropic's cloud API, or a local Ollama server. */
export type AiBackend = "anthropic" | "ollama";

export type Settings = {
  /** How often to poll repos for new activity, in milliseconds. */
  pollIntervalMs: number;
  /** Whether to fire desktop notifications for new activity. */
  notifications: boolean;
  /** Chat bubbles (default) vs the raw embedded terminal for the lecture-only aides. */
  assistantUi: AssistantUi;
  /** In chat mode: stream answers progressively (typewriter) vs show them once complete. */
  chatStreaming: boolean;
  /** Which engine backs `claude`: "anthropic" (cloud) or "ollama" (local models). */
  aiBackend: AiBackend;
  /** Base URL of the local Ollama server (used when aiBackend === "ollama"). */
  ollamaHost: string;
  /** The Ollama model name to use (e.g. "qwen3-coder:latest"). */
  ollamaModel: string;
  /** Model for Anthropic mode (alias "sonnet"/"opus"/"haiku" or full name); "" = default. */
  anthropicModel: string;
  /** Default shell profile id for new integrated-terminal tabs; "" = system default. */
  terminalShell: string;
};

export const DEFAULT_SETTINGS: Settings = {
  pollIntervalMs: 180_000,
  notifications: true,
  assistantUi: "chat",
  chatStreaming: true,
  aiBackend: "anthropic",
  ollamaHost: "http://localhost:11434",
  ollamaModel: "",
  anthropicModel: "",
  terminalShell: "",
};

/** Display name of the active AI engine: the Ollama model when on Ollama, else "Claude".
 * Used to label the live AI surfaces (chat / terminal / analyze) with the real model. */
export function aiLabel(
  s: Pick<Settings, "aiBackend" | "ollamaModel" | "anthropicModel">
): string {
  if (s.aiBackend === "ollama") return s.ollamaModel.trim() || "Ollama";
  return s.anthropicModel.trim() || "Claude";
}

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
      assistantUi:
        p.assistantUi === "chat" || p.assistantUi === "terminal"
          ? p.assistantUi
          : DEFAULT_SETTINGS.assistantUi,
      chatStreaming:
        typeof p.chatStreaming === "boolean"
          ? p.chatStreaming
          : DEFAULT_SETTINGS.chatStreaming,
      aiBackend:
        p.aiBackend === "anthropic" || p.aiBackend === "ollama"
          ? p.aiBackend
          : DEFAULT_SETTINGS.aiBackend,
      ollamaHost:
        typeof p.ollamaHost === "string" && p.ollamaHost.trim()
          ? p.ollamaHost
          : DEFAULT_SETTINGS.ollamaHost,
      ollamaModel:
        typeof p.ollamaModel === "string"
          ? p.ollamaModel
          : DEFAULT_SETTINGS.ollamaModel,
      anthropicModel:
        typeof p.anthropicModel === "string"
          ? p.anthropicModel
          : DEFAULT_SETTINGS.anthropicModel,
      terminalShell:
        typeof p.terminalShell === "string"
          ? p.terminalShell
          : DEFAULT_SETTINGS.terminalShell,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

const TOUR_KEY = "gitui.tourSeen";

/** Whether the first-run onboarding tour has already been shown. */
export function hasSeenTour(): boolean {
  try {
    return localStorage.getItem(TOUR_KEY) === "1";
  } catch {
    return true; // storage unavailable → don't nag
  }
}

export function markTourSeen() {
  try {
    localStorage.setItem(TOUR_KEY, "1");
  } catch {
    /* ignore */
  }
}

const WELCOME_KEY = "gitui.welcomeSeen";

/** Whether the first-run welcome screen (shown before the tour) has been seen. */
export function hasSeenWelcome(): boolean {
  try {
    return localStorage.getItem(WELCOME_KEY) === "1";
  } catch {
    return true; // storage unavailable → don't nag
  }
}

export function markWelcomeSeen() {
  try {
    localStorage.setItem(WELCOME_KEY, "1");
  } catch {
    /* ignore */
  }
}
