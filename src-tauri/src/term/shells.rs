//! Detection of the shell "profiles" the integrated terminal can launch — the gitui
//! equivalent of VS Code's terminal profiles. Each [`ShellProfile`] is a ready-to-spawn
//! executable + launch args, surfaced to the UI by the `list_shells` command so the user
//! can pick a default (Settings) or open a specific one from the new-tab menu.

use crate::proc;
use serde::Serialize;
#[cfg(not(windows))]
use std::path::Path;
#[allow(unused_imports)]
use std::path::PathBuf;

/// A launchable shell, presented to the frontend (serialized camelCase to match the API).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellProfile {
    /// Stable identifier persisted in settings (e.g. "powershell", "git-bash", "bash").
    pub id: String,
    /// Human-readable name shown in the picker (e.g. "Windows PowerShell").
    pub label: String,
    /// Absolute path to the shell executable.
    pub path: String,
    /// Extra launch arguments (e.g. `-NoLogo` for PowerShell, `--login -i` for Git Bash).
    pub args: Vec<String>,
}

impl ShellProfile {
    fn new(id: &str, label: &str, path: impl Into<String>, args: &[&str]) -> Self {
        ShellProfile {
            id: id.to_string(),
            label: label.to_string(),
            path: path.into(),
            args: args.iter().map(|s| s.to_string()).collect(),
        }
    }
}

/// Every shell available on this machine, best-first (the platform default leads the list).
pub fn available() -> Vec<ShellProfile> {
    let mut out = Vec::new();
    #[cfg(windows)]
    windows_shells(&mut out);
    #[cfg(not(windows))]
    unix_shells(&mut out);
    out
}

/// The profile to launch for `id`. `None`/`""` (or an unknown id) falls back to the
/// platform default — the first detected shell. `None` only if nothing was detected.
pub fn resolve(id: Option<&str>) -> Option<ShellProfile> {
    let list = available();
    match id {
        Some(want) if !want.is_empty() => list
            .iter()
            .find(|p| p.id == want)
            .cloned()
            .or_else(|| list.into_iter().next()),
        _ => list.into_iter().next(),
    }
}

#[cfg(windows)]
fn windows_shells(out: &mut Vec<ShellProfile>) {
    let sysroot = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());

    // PowerShell 7+ (pwsh), if installed — leads when present (the modern default).
    if let Some(p) = proc::which("pwsh") {
        out.push(ShellProfile::new(
            "pwsh",
            "PowerShell 7",
            p.to_string_lossy(),
            &["-NoLogo"],
        ));
    }
    // Windows PowerShell (ships with Windows).
    let ps = PathBuf::from(&sysroot).join("System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    if ps.is_file() {
        out.push(ShellProfile::new(
            "powershell",
            "Windows PowerShell",
            ps.to_string_lossy(),
            &["-NoLogo"],
        ));
    } else if let Some(p) = proc::which("powershell") {
        out.push(ShellProfile::new(
            "powershell",
            "Windows PowerShell",
            p.to_string_lossy(),
            &["-NoLogo"],
        ));
    }
    // Command Prompt.
    let cmd = std::env::var("ComSpec")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(&sysroot).join("System32\\cmd.exe"));
    if cmd.is_file() {
        out.push(ShellProfile::new(
            "cmd",
            "Command Prompt",
            cmd.to_string_lossy(),
            &[],
        ));
    }
    // Git Bash (bundled with Git for Windows).
    if let Some(bash) = git_bash_path() {
        out.push(ShellProfile::new(
            "git-bash",
            "Git Bash",
            bash.to_string_lossy(),
            &["--login", "-i"],
        ));
    }
    // WSL (default distribution).
    let wsl = PathBuf::from(&sysroot).join("System32\\wsl.exe");
    if wsl.is_file() {
        out.push(ShellProfile::new("wsl", "WSL", wsl.to_string_lossy(), &[]));
    }
}

/// Best-effort location of Git for Windows' `bash.exe`, via the standard install dirs
/// or by walking up from `git` on `PATH` (`<root>\cmd\git.exe` → `<root>\bin\bash.exe`).
#[cfg(windows)]
fn git_bash_path() -> Option<PathBuf> {
    for base in ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"] {
        if let Ok(dir) = std::env::var(base) {
            let p = PathBuf::from(dir).join("Git\\bin\\bash.exe");
            if p.is_file() {
                return Some(p);
            }
        }
    }
    if let Some(git) = proc::which("git") {
        if let Some(root) = git.parent().and_then(|p| p.parent()) {
            let p = root.join("bin\\bash.exe");
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

#[cfg(not(windows))]
fn unix_shells(out: &mut Vec<ShellProfile>) {
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    // The user's login shell leads the list (matches their everyday environment).
    if let Ok(sh) = std::env::var("SHELL") {
        if !sh.is_empty() && Path::new(&sh).is_file() {
            let (id, label) = shell_identity(&sh);
            seen.insert(id.clone());
            out.push(ShellProfile::new(&id, &label, sh, &[]));
        }
    }
    // Other common shells found on PATH, skipping any already added as the login shell.
    for (id, label) in [("zsh", "Zsh"), ("bash", "Bash"), ("fish", "fish"), ("sh", "sh")] {
        if seen.contains(id) {
            continue;
        }
        if let Some(p) = proc::which(id) {
            out.push(ShellProfile::new(id, label, p.to_string_lossy(), &[]));
        }
    }
}

/// Map a shell executable path to a stable (id, label) pair.
#[cfg(not(windows))]
fn shell_identity(path: &str) -> (String, String) {
    let base = Path::new(path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("shell");
    let label = match base {
        "zsh" => "Zsh",
        "bash" => "Bash",
        "fish" => "fish",
        "sh" => "sh",
        other => return (other.to_string(), other.to_string()),
    };
    (base.to_string(), label.to_string())
}
