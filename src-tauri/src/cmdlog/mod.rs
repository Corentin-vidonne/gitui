//! In-app "command log": broadcasts every *mutating* git/gh/claude command the app runs to
//! the frontend `CommandLogDock`, so the user can see exactly what gets executed (e.g. the
//! `git rebase` behind a Restack). The read-only plumbing the app polls constantly to
//! refresh its view (`git status`, `for-each-ref`, `gh pr list`, …) is filtered out as noise
//! — the user asked for the action commands, not the housekeeping.
//!
//! A process-global singleton holding the `AppHandle` (mirrors `undo::global()`), so the
//! plain spawn fns in `proc::`/`git::`/`github::` can emit without threading a handle through
//! every call. Before [`init`] runs (unit tests, early startup) every emit is a silent no-op,
//! so the engine tests and `proc` tests keep passing unchanged.

use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};

static HANDLE: OnceLock<AppHandle> = OnceLock::new();
static SEQ: AtomicU64 = AtomicU64::new(1);

/// Wire the broadcaster to the running app. Called once from `lib.rs` `.setup()`.
pub fn init(app: AppHandle) {
    let _ = HANDLE.set(app);
}

/// One command, emitted twice under the `command-log` event: once when it starts
/// (`running = true`) and once when it finishes (`running = false`, with the exit code /
/// duration filled in). The frontend upserts rows by `id`.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandEvent {
    pub id: u64,
    pub running: bool,
    pub program: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub started_ms: u64,
    pub duration_ms: Option<u64>,
    pub exit_code: Option<i32>,
    pub success: Option<bool>,
    /// Set when the process failed to even spawn (e.g. the binary is missing).
    pub error: Option<String>,
}

fn emit(ev: CommandEvent) {
    if let Some(app) = HANDLE.get() {
        let _ = app.emit("command-log", ev);
    }
}

/// Announce a command that's about to run. Returns its log id, or `None` when nothing was
/// emitted — either the log isn't wired up (unit tests / pre-startup) or the command is
/// read-only noise we deliberately hide. A `Some(id)` must be paired with a later
/// [`finished`] call carrying the outcome.
pub fn started(program: &str, args: &[String], cwd: Option<&str>, started_ms: u64) -> Option<u64> {
    HANDLE.get()?; // not wired up (tests / pre-setup) → skip the work entirely
    if !is_action(program, args) {
        return None;
    }
    let id = SEQ.fetch_add(1, Ordering::Relaxed);
    emit(CommandEvent {
        id,
        running: true,
        program: program.to_string(),
        args: args.to_vec(),
        cwd: cwd.map(str::to_string),
        started_ms,
        duration_ms: None,
        exit_code: None,
        success: None,
        error: None,
    });
    Some(id)
}

/// Report the outcome of a command previously announced by [`started`].
#[allow(clippy::too_many_arguments)]
pub fn finished(
    id: u64,
    program: &str,
    args: &[String],
    cwd: Option<&str>,
    started_ms: u64,
    duration_ms: u64,
    exit_code: Option<i32>,
    success: bool,
    error: Option<String>,
) {
    emit(CommandEvent {
        id,
        running: false,
        program: program.to_string(),
        args: args.to_vec(),
        cwd: cwd.map(str::to_string),
        started_ms,
        duration_ms: Some(duration_ms),
        exit_code,
        success: Some(success),
        error,
    });
}

/// Whether a command mutates state (an "action" worth surfacing) rather than being a
/// read-only query the app runs to refresh its view. Conservative on the write side: when
/// in doubt we show the command, so a user's action is never silently hidden.
pub fn is_action(program: &str, args: &[String]) -> bool {
    match program {
        "git" => git_is_action(args),
        "gh" => gh_is_action(args),
        // `claude` (headless AI assists) and anything else: a deliberate action — show it.
        _ => true,
    }
}

/// Read-only git subcommands the app polls to build/refresh its view. Anything NOT here is
/// treated as a mutating action (`add`, `checkout`, `rebase`, `merge`, `fetch`, `push`,
/// `branch -f`, …). `config` and `stash` are handled separately (they go both ways).
const GIT_READ: &[&str] = &[
    "status",
    "log",
    "show",
    "diff",
    "for-each-ref",
    "rev-parse",
    "rev-list",
    "cat-file",
    "ls-files",
    "ls-tree",
    "ls-remote",
    "show-ref",
    "symbolic-ref",
    "name-rev",
    "merge-base",
    "describe",
    "var",
    "reflog",
    "blame",
    "shortlog",
    "cherry",
    "whatchanged",
    "grep",
    "count-objects",
    "verify-commit",
    "verify-tag",
];

/// Index of the git subcommand token, skipping leading global options the wrappers inject
/// (`git -c core.pager=cat rebase …` → the `rebase` index). `-c`/`-C`/etc. consume the
/// following token as their value.
fn git_sub_index(args: &[String]) -> Option<usize> {
    let mut i = 0;
    while i < args.len() {
        let a = args[i].as_str();
        match a {
            "-c" | "-C" | "--git-dir" | "--work-tree" | "--namespace" | "--exec-path" => i += 2,
            _ if a.starts_with('-') => i += 1, // other boolean global flag
            _ => return Some(i),               // first bare token = the subcommand
        }
    }
    None
}

fn git_is_action(args: &[String]) -> bool {
    let idx = match git_sub_index(args) {
        Some(i) => i,
        None => return true, // bare `git` (unusual) — surface it rather than swallow it
    };
    let sub = args[idx].as_str();
    // The first bare token after the subcommand (e.g. the `list` in `stash list`).
    let next = args[idx + 1..]
        .iter()
        .map(String::as_str)
        .find(|a| !a.starts_with('-'));
    match sub {
        // `config` reads when an explicit read flag is present; otherwise it writes.
        "config" => !args.iter().any(|a| {
            matches!(
                a.as_str(),
                "--get" | "--get-all" | "--get-regexp" | "--get-urlmatch" | "--list" | "-l"
            )
        }),
        // `stash list` / `stash show` are reads; bare `stash` and the rest mutate.
        "stash" => !matches!(next, Some("list") | Some("show")),
        s if GIT_READ.contains(&s) => false,
        _ => true,
    }
}

fn gh_is_action(args: &[String]) -> bool {
    // gh is invoked as `gh <command> <subcommand> …`; command & subcommand are the first two
    // bare tokens (no global flags are used in this app).
    let words: Vec<&str> = args
        .iter()
        .map(String::as_str)
        .filter(|a| !a.starts_with('-'))
        .collect();
    let cmd = words.first().copied();
    let sub = words.get(1).copied();
    match (cmd, sub) {
        (Some("pr"), Some("list" | "view" | "checks" | "diff" | "status")) => false,
        (Some("issue"), Some("list" | "view" | "status")) => false,
        (Some("repo"), Some("view")) => false,
        (Some("search"), _) | (Some("auth"), _) => false,
        // `gh api` defaults to GET; it only writes with an explicit method or a body field.
        (Some("api"), _) => gh_api_is_write(args),
        _ => true, // pr create/edit/merge/review, issue create/comment, …
    }
}

fn gh_api_is_write(args: &[String]) -> bool {
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--method" | "-X" => {
                if let Some(m) = args.get(i + 1) {
                    let m = m.to_ascii_uppercase();
                    if m != "GET" && m != "HEAD" {
                        return true;
                    }
                }
                i += 2;
            }
            // Any field/body flag implies a write request.
            "-f" | "--field" | "-F" | "--raw-field" | "--input" => return true,
            _ => i += 1,
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(args: &[&str]) -> Vec<String> {
        args.iter().map(|s| s.to_string()).collect()
    }

    fn action(program: &str, args: &[&str]) -> bool {
        is_action(program, &v(args))
    }

    #[test]
    fn git_reads_are_hidden() {
        // The wrappers prefix `-c protocol.ext.allow=never -c core.pager=cat`; the subcommand
        // must still be found past those global options.
        let pfx = ["-c", "protocol.ext.allow=never", "-c", "core.pager=cat"];
        for sub in ["status", "for-each-ref", "rev-parse", "rev-list", "log", "show", "diff", "merge-base", "show-ref", "symbolic-ref"] {
            let mut a = pfx.to_vec();
            a.push(sub);
            assert!(!action("git", &a), "`git {sub}` should be hidden as a read");
        }
    }

    #[test]
    fn git_writes_are_shown() {
        assert!(action("git", &["rebase", "--onto", "main", "old", "feat"]));
        assert!(action("git", &["-c", "core.pager=cat", "checkout", "-b", "feat", "main"]));
        assert!(action("git", &["add", "file.rs"]));
        assert!(action("git", &["push", "--force-with-lease", "-u", "origin", "feat"]));
        assert!(action("git", &["merge", "--ff-only", "origin/main"]));
        assert!(action("git", &["fetch", "--prune", "origin"]));
        assert!(action("git", &["branch", "-f", "feat", "abc123"]));
        assert!(action("git", &["reset", "--hard", "abc123"]));
        assert!(action("git", &["commit", "--allow-empty", "-m", "msg"]));
    }

    #[test]
    fn git_config_read_vs_write() {
        // meta::all() — the per-refresh read — must be hidden.
        assert!(!action("git", &["config", "--local", "--get-regexp", r"^branch\..*\.gitstack-"]));
        // meta::set() / unset() — writes — must be shown.
        assert!(action("git", &["-c", "core.pager=cat", "config", "branch.feat.gitstack-parent", "main"]));
        assert!(action("git", &["config", "--unset", "branch.feat.gitstack-parent"]));
    }

    #[test]
    fn git_stash_read_vs_write() {
        assert!(!action("git", &["stash", "list"]));
        assert!(!action("git", &["stash", "show", "-p"]));
        assert!(action("git", &["stash", "push", "-m", "wip"]));
        assert!(action("git", &["stash", "pop"]));
        assert!(action("git", &["stash"])); // bare `stash` defaults to push
    }

    #[test]
    fn gh_reads_are_hidden() {
        assert!(!action("gh", &["pr", "list", "--state", "open", "--json", "number"]));
        assert!(!action("gh", &["pr", "view", "feat", "--json", "number,url"]));
        assert!(!action("gh", &["pr", "checks", "7", "--json", "name"]));
        assert!(!action("gh", &["pr", "diff", "7"]));
        assert!(!action("gh", &["issue", "list", "--state", "open", "--json", "number"]));
        assert!(!action("gh", &["issue", "view", "3", "--json", "title"]));
    }

    #[test]
    fn gh_writes_are_shown() {
        assert!(action("gh", &["pr", "create", "--head", "feat", "--base", "main", "--title", "t", "--body", "b"]));
        assert!(action("gh", &["pr", "edit", "7", "--base", "main"]));
        assert!(action("gh", &["pr", "merge", "7", "--squash"]));
        assert!(action("gh", &["pr", "review", "7", "--approve"]));
    }

    #[test]
    fn gh_api_read_vs_write() {
        assert!(!action("gh", &["api", "repos/o/r/pulls/7/reviews"])); // GET by default
        assert!(action("gh", &["api", "repos/o/r/pulls/7/reviews", "--method", "POST", "--input", "f.json"]));
        assert!(action("gh", &["api", "some/endpoint", "-X", "DELETE"]));
        assert!(action("gh", &["api", "some/endpoint", "-f", "k=v"]));
    }

    #[test]
    fn claude_and_unknowns_are_shown() {
        assert!(action("claude", &["-p", "analyse"]));
        assert!(action("some-tool", &["whatever"]));
    }
}
