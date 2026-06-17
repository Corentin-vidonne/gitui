use std::ffi::OsStr;
use std::io;
use std::path::Path;
use std::process::Command;

/// On Windows, spawn child processes without flashing a console window.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Append `extra` dirs to a `sep`-separated PATH, skipping empties and duplicates while
/// preserving existing order. Pure + platform-agnostic so it stays unit-testable.
fn merge_path_dirs(current: &str, extra: &[String], sep: char) -> String {
    let mut parts: Vec<String> = current
        .split(sep)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect();
    for e in extra {
        if !e.is_empty() && !parts.iter().any(|p| p == e) {
            parts.push(e.clone());
        }
    }
    parts.join(&sep.to_string())
}

/// Make sure `git`, `gh` and `claude` are reachable on every platform.
///
/// On macOS/Linux a GUI app launched from Finder/Dock/a `.desktop` entry does **not**
/// inherit the user's interactive-shell `PATH`, so tools installed in `~/.local/bin`,
/// `/opt/homebrew/bin`, nvm/npm dirs, etc. are invisible and every subprocess fails with
/// "No such file or directory". We repair `PATH` once at startup: first by asking the
/// login shell for its own `PATH`, then by appending a few well-known install dirs. No-op
/// on Windows, where installers register tools in the system `PATH` that GUI apps inherit.
pub fn fix_path_env() {
    if cfg!(target_os = "windows") {
        return;
    }
    // 1) Inherit the login+interactive shell's PATH (covers nvm/asdf/homebrew/volta…).
    // `printenv PATH` is valid in every shell (bash/zsh/sh/fish) and always emits the
    // colon-separated exported value, unlike `echo "$PATH"` which fish would space-split.
    if let Ok(shell) = std::env::var("SHELL") {
        if let Ok(out) = Command::new(&shell).args(["-ilc", "printenv PATH"]).output() {
            if out.status.success() {
                let p = String::from_utf8_lossy(&out.stdout);
                let p = p.trim();
                if !p.is_empty() {
                    std::env::set_var("PATH", p);
                }
            }
        }
    }
    // 2) Ensure common install dirs are present regardless of the shell's config.
    let mut extra = vec![
        "/usr/local/bin".to_string(),
        "/opt/homebrew/bin".to_string(),
        "/usr/bin".to_string(),
        "/bin".to_string(),
    ];
    if let Ok(home) = std::env::var("HOME") {
        if !home.is_empty() {
            extra.push(format!("{home}/.local/bin"));
            extra.push(format!("{home}/.cargo/bin"));
            extra.push(format!("{home}/bin"));
        }
    }
    let current = std::env::var("PATH").unwrap_or_default();
    std::env::set_var("PATH", merge_path_dirs(&current, &extra, ':'));
}

/// Build a [`Command`] that won't pop up a console window on Windows.
pub fn command(program: &str) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Captured result of running an external command.
#[allow(dead_code)] // `code` is reserved for finer error handling
pub struct Run {
    pub success: bool,
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

/// Run `program` with `args` (optionally in `cwd`) and capture its output.
pub fn run<I, S>(program: &str, args: I, cwd: Option<&Path>) -> io::Result<Run>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    run_env(program, args, cwd, &[])
}

/// Like [`run`], but also sets environment variables (e.g. `GIT_EDITOR=true`).
pub fn run_env<I, S>(
    program: &str,
    args: I,
    cwd: Option<&Path>,
    envs: &[(&str, &str)],
) -> io::Result<Run>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let mut cmd = command(program);
    cmd.args(args);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    for (k, v) in envs {
        cmd.env(k, v);
    }

    // Mirror the command into the in-app command log. `cmd.args(args)` above consumed the
    // generic `args` iterator, so read the resolved argv back off the built `Command`. This
    // is a no-op unless the log is wired up (lib.rs `.setup`) and the command is a mutating
    // "action" — read-only polling is filtered out by `cmdlog::is_action`.
    let program_s = cmd.get_program().to_string_lossy().into_owned();
    let args_s: Vec<String> = cmd
        .get_args()
        .map(|a| a.to_string_lossy().into_owned())
        .collect();
    let cwd_s = cwd.map(|p| p.to_string_lossy().into_owned());
    let started_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let log_id = crate::cmdlog::started(&program_s, &args_s, cwd_s.as_deref(), started_ms);
    let t0 = std::time::Instant::now();

    let result = cmd.output();

    if let Some(id) = log_id {
        let duration_ms = t0.elapsed().as_millis() as u64;
        match &result {
            Ok(o) => crate::cmdlog::finished(
                id,
                &program_s,
                &args_s,
                cwd_s.as_deref(),
                started_ms,
                duration_ms,
                o.status.code(),
                o.status.success(),
                None,
            ),
            Err(e) => crate::cmdlog::finished(
                id,
                &program_s,
                &args_s,
                cwd_s.as_deref(),
                started_ms,
                duration_ms,
                None,
                false,
                Some(e.to_string()),
            ),
        }
    }

    let output = result?;
    Ok(Run {
        success: output.status.success(),
        code: output.status.code(),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}

/// Locate an executable named `program` by scanning `PATH`. On Windows the common
/// executable extensions are tried (`.exe`, `.cmd`, …). Returns the first match, or `None`.
/// Pure path lookup — no subprocess — so it's cheap to call repeatedly during detection.
pub fn which(program: &str) -> Option<std::path::PathBuf> {
    let path = std::env::var_os("PATH")?;
    let dirs: Vec<std::path::PathBuf> = std::env::split_paths(&path).collect();
    which_in(program, &dirs)
}

/// PATH-scan core, split out so it can be unit-tested without touching the real `PATH`.
fn which_in(program: &str, dirs: &[std::path::PathBuf]) -> Option<std::path::PathBuf> {
    // Windows executables always carry an extension (no bare-name match, which would pick up
    // an unrelated data file); on unix any name is allowed but the exec bit is required.
    #[cfg(windows)]
    let exts: &[&str] = &[".exe", ".cmd", ".bat", ".com"];
    #[cfg(not(windows))]
    let exts: &[&str] = &[""];
    for dir in dirs {
        for ext in exts {
            let cand = dir.join(format!("{program}{ext}"));
            if is_executable_file(&cand) {
                return Some(cand);
            }
        }
    }
    None
}

/// Whether `p` is a regular file that can actually be executed.
#[cfg(windows)]
fn is_executable_file(p: &std::path::Path) -> bool {
    // Extension already constrained to an executable type by the caller.
    p.is_file()
}

#[cfg(not(windows))]
fn is_executable_file(p: &std::path::Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(p)
        .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn which_in_finds_a_file_in_the_first_matching_dir() {
        let tmp = std::env::temp_dir();
        // A file that certainly exists somewhere on disk; reuse the OS temp dir itself by
        // probing for any regular file. To stay deterministic we create a marker file.
        let dir = tmp.join("gitui-which-test");
        let _ = std::fs::create_dir_all(&dir);
        let name = "gitui-which-marker";
        #[cfg(windows)]
        let file = dir.join(format!("{name}.exe"));
        #[cfg(not(windows))]
        let file = dir.join(name);
        std::fs::write(&file, b"x").unwrap();
        // `which_in` requires the exec bit on unix; make the marker executable so it matches.
        #[cfg(not(windows))]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755)).unwrap();
        }

        let found = which_in(name, &[std::path::PathBuf::from("/nonexistent-xyz"), dir.clone()]);
        assert_eq!(found.as_deref(), Some(file.as_path()));
        // A name with no matching file returns None.
        assert!(which_in("gitui-which-absent", &[dir]).is_none());
        let _ = std::fs::remove_file(&file);
    }

    #[test]
    fn merge_path_dirs_appends_missing_without_duplicates() {
        let cur = "/usr/bin:/usr/local/bin";
        let extra = vec!["/usr/local/bin".to_string(), "/opt/homebrew/bin".to_string()];
        // Existing entries keep their place; only genuinely new dirs are appended.
        assert_eq!(
            merge_path_dirs(cur, &extra, ':'),
            "/usr/bin:/usr/local/bin:/opt/homebrew/bin"
        );
    }

    #[test]
    fn merge_path_dirs_skips_empties_and_repeats() {
        // Empty current + a repeated extra collapses to a single clean entry.
        assert_eq!(
            merge_path_dirs("", &["/a".to_string(), "/a".to_string(), String::new()], ':'),
            "/a"
        );
    }
}
