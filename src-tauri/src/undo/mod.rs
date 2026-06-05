//! A small per-repo undo stack: before each history-rewriting command we snapshot every
//! branch tip; `undo` restores them. Keyed by repo root so multiple repos don't collide.
//!
//! v1 scope: restores branch SHAs + the checked-out branch (recreating branches deleted
//! since the snapshot). It does NOT restore stack metadata (git config `gitstack-*`) or
//! undo merges run by `claude` directly — only the in-app history-rewriting commands.

use crate::error::{AppError, Result};
use crate::git;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

const MAX: usize = 25;

/// The process-wide undo stack (single-window app; keyed by repo root inside). A global
/// singleton rather than Tauri-managed state so the plain command fns stay unit-testable.
pub fn global() -> &'static UndoStack {
    static GLOBAL: OnceLock<UndoStack> = OnceLock::new();
    GLOBAL.get_or_init(UndoStack::default)
}

#[derive(Clone)]
pub struct Snapshot {
    pub label: String,
    pub current: Option<String>,
    pub branches: Vec<(String, String)>,
}

#[derive(Default)]
pub struct UndoStack(Mutex<HashMap<String, Vec<Snapshot>>>);

fn key(repo: &Path) -> String {
    repo.to_string_lossy().to_string()
}

impl UndoStack {
    /// Snapshot the repo's branch tips before a mutation (best-effort; skipped on error).
    pub fn push(&self, repo: &Path, label: &str) {
        let branches: Vec<(String, String)> = match git::local_branches(repo) {
            Ok(bs) => bs.into_iter().map(|b| (b.name, b.sha)).collect(),
            Err(_) => return,
        };
        let snap = Snapshot {
            label: label.to_string(),
            current: git::current_branch(repo),
            branches,
        };
        let mut m = self.0.lock().unwrap();
        let v = m.entry(key(repo)).or_default();
        v.push(snap);
        let len = v.len();
        if len > MAX {
            v.drain(0..len - MAX);
        }
    }

    /// The label of what the next `undo` would restore (for the button tooltip).
    pub fn peek_label(&self, repo: &Path) -> Option<String> {
        self.0
            .lock()
            .unwrap()
            .get(&key(repo))
            .and_then(|v| v.last())
            .map(|s| s.label.clone())
    }

    pub fn pop(&self, repo: &Path) -> Option<Snapshot> {
        self.0
            .lock()
            .unwrap()
            .get_mut(&key(repo))
            .and_then(|v| v.pop())
    }
}

/// Restore every branch tip to the snapshot. Refuses if the working tree is dirty, since
/// the checked-out branch is restored with `reset --hard` (which would discard changes).
pub fn restore(repo: &Path, snap: &Snapshot) -> Result<()> {
    if git::is_dirty(repo) {
        return Err(AppError::new("Commit or stash your changes before undoing"));
    }
    // Switch back to the branch that was checked out at snapshot time, if it still exists.
    if let Some(want) = &snap.current {
        if git::branch_exists(repo, want)
            && git::current_branch(repo).as_deref() != Some(want.as_str())
        {
            git::checkout(repo, want)?;
        }
    }
    let cur = git::current_branch(repo);
    for (name, sha) in &snap.branches {
        if Some(name.as_str()) == cur.as_deref() {
            git::git(repo, &["reset", "--hard", sha])?;
        } else if git::branch_exists(repo, name) {
            git::git(repo, &["branch", "-f", name, sha])?;
        } else {
            // Branch was deleted since the snapshot — recreate it at its old tip.
            git::git(repo, &["branch", name, sha])?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn g(repo: &Path, args: &[&str]) -> String {
        git::git(repo, args).unwrap()
    }

    #[test]
    fn restore_resets_branch_to_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path();
        g(repo, &["init"]);
        g(repo, &["config", "user.email", "t@example.com"]);
        g(repo, &["config", "user.name", "Test"]);
        g(repo, &["commit", "--allow-empty", "-m", "c1"]);
        let c1 = g(repo, &["rev-parse", "HEAD"]).trim().to_string();

        let stack = UndoStack::default();
        stack.push(repo, "test op");
        assert_eq!(stack.peek_label(repo).as_deref(), Some("test op"));

        // Move the branch forward, then undo back to the snapshot.
        g(repo, &["commit", "--allow-empty", "-m", "c2"]);
        assert_ne!(g(repo, &["rev-parse", "HEAD"]).trim(), c1);

        let snap = stack.pop(repo).unwrap();
        restore(repo, &snap).unwrap();
        assert_eq!(
            g(repo, &["rev-parse", "HEAD"]).trim(),
            c1,
            "undo must restore the branch tip"
        );
        assert!(stack.pop(repo).is_none(), "stack should be empty after pop");
    }
}
