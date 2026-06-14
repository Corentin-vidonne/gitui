//! Headless chat sessions: run `claude -p --output-format stream-json` and stream the
//! JSON events to the frontend, which renders them as a chat (no terminal). Each turn is
//! its own short-lived process; conversation continuity is handled by the FRONTEND, which
//! reads `session_id` from the events and passes it back on the next `chat_send` (`--resume`).
//!
//! Only the read-only `assist::READONLY_TOOLS` are pre-allowed, so this path is for the
//! lecture-only aides (Summary / Detailed). Actions that write still go through the
//! interactive terminal, whose y/n confirmation we rely on.

use crate::assist;
use crate::error::{AppError, Result};
use crate::git;
use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

/// The currently-running `claude` turn per frontend chat id (so it can be reaped/killed).
#[derive(Default)]
pub struct ChatSessions(Mutex<HashMap<String, Child>>);

#[derive(Clone, Serialize)]
struct ChatLine {
    id: String,
    /// One raw newline-delimited JSON event from `claude --output-format stream-json`.
    line: String,
}

#[derive(Clone, Serialize)]
struct ChatTurnEnd {
    id: String,
    ok: bool,
    stderr: String,
}

/// Spawn one headless `claude` turn in `repo` (optionally resuming `resume`), streaming
/// each stdout line to the frontend as `chat-event`, then emitting `chat-turn-end`.
fn spawn_turn(
    app: &AppHandle,
    state: &State<'_, ChatSessions>,
    id: String,
    repo: &Path,
    resume: Option<&str>,
    prompt: &str,
    partial: bool,
    extra_allowed: &[String],
) -> Result<()> {
    // Claude is verified only here, at point of use (not at app startup).
    assist::ensure_claude_available()?;
    // Reap any previous (already-finished) turn for this id before starting a new one.
    if let Some(mut old) = state.0.lock().unwrap().remove(&id) {
        let _ = old.kill();
        let _ = old.wait();
    }

    let mut cmd = Command::new(assist::resolve_claude());
    assist::push_allowed_tools(&mut |a| {
        cmd.arg(a);
    });
    // Per-action approvals granted from the chat (e.g. an OK'd `gh pr merge`).
    for tool in extra_allowed {
        cmd.arg("--allowedTools").arg(tool);
    }
    cmd.arg("-p")
        .arg("--output-format")
        .arg("stream-json")
        .arg("--verbose");
    // When on, claude streams text in `content_block_delta` chunks (typewriter effect)
    // in addition to the final complete message.
    if partial {
        cmd.arg("--include-partial-messages");
    }
    if let Some(sid) = resume {
        cmd.arg("--resume").arg(sid);
    }
    // `--` ends option parsing so the variadic `--allowedTools` cannot swallow the prompt.
    cmd.arg("--").arg(prompt);
    cmd.current_dir(repo)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // Backend env (Anthropic adds none; Ollama points claude at the local model).
    for (k, v) in assist::ai_env() {
        cmd.env(k, v);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::new(format!("Could not run claude: {e}")))?;
    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");

    // Drain stderr on its own thread so a full stderr pipe can't deadlock stdout.
    let err_buf = Arc::new(Mutex::new(String::new()));
    {
        let err_buf = err_buf.clone();
        std::thread::spawn(move || {
            let mut s = String::new();
            let _ = BufReader::new(stderr).read_to_string(&mut s);
            *err_buf.lock().unwrap() = s;
        });
    }

    let app_handle = app.clone();
    let session = id.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(l) if !l.trim().is_empty() => {
                    let _ = app_handle.emit(
                        "chat-event",
                        ChatLine {
                            id: session.clone(),
                            line: l,
                        },
                    );
                }
                Ok(_) => {}
                Err(_) => break,
            }
        }
        // stdout closed => the turn is done.
        let stderr = err_buf.lock().unwrap().clone();
        let _ = app_handle.emit(
            "chat-turn-end",
            ChatTurnEnd {
                id: session,
                ok: stderr.trim().is_empty(),
                stderr,
            },
        );
    });

    state.0.lock().unwrap().insert(id, child);
    Ok(())
}

/// Open a chat seeded to analyze a commit (same prompt as the terminal "Summary/Detailed").
#[tauri::command]
pub fn chat_open_analyze(
    app: AppHandle,
    state: State<'_, ChatSessions>,
    id: String,
    path: String,
    sha: String,
    mode: String,
    partial: bool,
) -> Result<()> {
    let root = git::repo_root(Path::new(&path))?;
    let repo = Path::new(&root);
    let prompt = assist::analysis_prompt(repo, &sha, &mode, assist::ui_lang())?;
    spawn_turn(&app, &state, id, repo, None, &prompt, partial, &[])
}

/// Open a chat seeded to analyze a whole Pull Request.
#[tauri::command]
pub fn chat_open_analyze_pr(
    app: AppHandle,
    state: State<'_, ChatSessions>,
    id: String,
    path: String,
    number: u64,
    mode: String,
    partial: bool,
) -> Result<()> {
    let root = git::repo_root(Path::new(&path))?;
    let repo = Path::new(&root);
    let detail = crate::github::pr_detail(repo, number)?;
    let prompt = assist::pr_analysis_prompt(
        number,
        &detail.title,
        &detail.head_ref,
        &detail.base_ref,
        &mode,
        assist::ui_lang(),
    );
    spawn_turn(&app, &state, id, repo, None, &prompt, partial, &[])
}

/// Open a general-purpose chat about the whole repository (read-only tools).
#[tauri::command]
pub fn chat_open_repo(
    app: AppHandle,
    state: State<'_, ChatSessions>,
    id: String,
    path: String,
    partial: bool,
    extra_allowed: Vec<String>,
) -> Result<()> {
    let root = git::repo_root(Path::new(&path))?;
    let repo = Path::new(&root);
    let seed = assist::repo_chat_seed(assist::ui_lang());
    spawn_turn(&app, &state, id, repo, None, &seed, partial, &extra_allowed)
}

/// Send a follow-up message, resuming the existing `claude` session.
#[tauri::command]
pub fn chat_send(
    app: AppHandle,
    state: State<'_, ChatSessions>,
    id: String,
    path: String,
    session_id: String,
    text: String,
    partial: bool,
    extra_allowed: Vec<String>,
) -> Result<()> {
    if session_id.trim().is_empty() {
        return Err(AppError::new("missing claude session id"));
    }
    let root = git::repo_root(Path::new(&path))?;
    let repo = Path::new(&root);
    spawn_turn(&app, &state, id, repo, Some(&session_id), &text, partial, &extra_allowed)
}

/// Open a chat seeded to help MERGE a PR. Runs with read-only tools only, so the actual
/// `gh pr merge` is denied and surfaces in `permission_denials` for the frontend's
/// approval modal; once approved, the command comes back via `chat_send`'s `extra_allowed`.
#[tauri::command]
pub fn chat_open_merge_pr(
    app: AppHandle,
    state: State<'_, ChatSessions>,
    id: String,
    path: String,
    number: u64,
    partial: bool,
    extra_allowed: Vec<String>,
) -> Result<()> {
    let root = git::repo_root(Path::new(&path))?;
    let repo = Path::new(&root);
    let detail = crate::github::pr_detail(repo, number)?;
    let raw = git::local_branches(repo)?;
    let trunk = git::trunk(repo, &raw);
    let lang = assist::ui_lang();
    let base = assist::merge_assist_prompt(
        number,
        &detail.title,
        &detail.head_ref,
        &detail.base_ref,
        &trunk,
        lang,
    );
    let prompt = format!("{base}{}", assist::chat_merge_note(lang));
    spawn_turn(&app, &state, id, repo, None, &prompt, partial, &extra_allowed)
}

/// Open a chat seeded to help MERGE one local branch into another (`git merge`).
#[tauri::command]
pub fn chat_open_merge_branches(
    app: AppHandle,
    state: State<'_, ChatSessions>,
    id: String,
    path: String,
    source: String,
    target: String,
    partial: bool,
    extra_allowed: Vec<String>,
) -> Result<()> {
    if source == target {
        return Err(AppError::new("Source and target branches must differ"));
    }
    let root = git::repo_root(Path::new(&path))?;
    let repo = Path::new(&root);
    let raw = git::local_branches(repo)?;
    let trunk = git::trunk(repo, &raw);
    let lang = assist::ui_lang();
    let base = assist::branch_merge_prompt(&source, &target, &trunk, lang);
    let prompt = format!("{base}{}", assist::chat_merge_note(lang));
    spawn_turn(&app, &state, id, repo, None, &prompt, partial, &extra_allowed)
}

/// Close a chat: kill any running turn and forget it.
#[tauri::command]
pub fn chat_close(state: State<'_, ChatSessions>, id: String) -> Result<()> {
    if let Some(mut child) = state.0.lock().unwrap().remove(&id) {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}
