use crate::error::{AppError, Result};
use crate::git;
use std::path::Path;

/// Resolve the full path to the `claude` executable (so we spawn it directly,
/// bypassing any shell — Windows PowerShell 5.1 mangles quoted/multi-line args).
fn resolve_claude() -> String {
    #[cfg(windows)]
    {
        if let Ok(r) = crate::proc::run("where", ["claude"], None) {
            if r.success {
                // Prefer a real .exe over a .cmd/.ps1 shim.
                if let Some(exe) = r.stdout.lines().find(|l| l.trim().ends_with(".exe")) {
                    return exe.trim().to_string();
                }
                if let Some(first) = r.stdout.lines().next() {
                    let f = first.trim();
                    if !f.is_empty() {
                        return f.to_string();
                    }
                }
            }
        }
    }
    "claude".to_string()
}

/// The prompt injected into `claude` to analyze a commit.
/// `mode` is "summary" (short synthesis) or "detailed" (in-depth review).
pub fn analysis_prompt(repo: &Path, sha: &str, mode: &str) -> Result<String> {
    let detail = git::commit_detail(repo, sha)?;
    let subject = detail
        .message
        .lines()
        .next()
        .unwrap_or("")
        .replace('"', "'");
    let files: Vec<String> = detail.files.iter().map(|f| f.path.clone()).collect();
    let short: String = sha.chars().take(8).collect();
    let files_line = if files.is_empty() {
        "(aucun)".to_string()
    } else {
        files.join(", ")
    };

    let body = if mode == "summary" {
        format!(
            "Donne un RÉSUMÉ SYNTHÉTIQUE (5 à 8 lignes maximum) :\n\
             - ce que fait ce commit, en une phrase ;\n\
             - les changements clés, fichier par fichier ;\n\
             - l'intention probable derrière le changement.\n\
             Va à l'essentiel."
        )
    } else {
        format!(
            "Fournis une ANALYSE COMPLÈTE et structurée :\n\
             1. Résumé : ce que fait ce commit.\n\
             2. Détail par fichier / fonction : ce qui change et pourquoi.\n\
             3. Intention et conception : le but, les choix de design.\n\
             4. Impact : effets sur le reste du code, compatibilité, performances.\n\
             5. Risques et bugs potentiels : points fragiles, cas limites non gérés.\n\
             6. Suggestions : améliorations possibles et tests à ajouter.\n\
             Sois précis et cite le code concerné."
        )
    };

    Ok(format!(
        "Tu es un relecteur de code expert. Analyse le commit `{short}` (sujet : {subject}) de ce dépôt git.\n\n\
         Commence par exécuter `git show {sha}` pour lire le diff complet (explore les fichiers concernés si besoin).\n\n\
         {body}\n\n\
         Fichiers modifiés : {files_line}.\n\n\
         Ensuite, reste disponible : je vais te poser des questions sur ce code.",
    ))
}

/// The prompt injected into `claude` to analyze a whole Pull Request.
/// `mode` is "summary" or "detailed".
pub fn pr_analysis_prompt(
    number: u64,
    title: &str,
    head: &str,
    base: &str,
    mode: &str,
) -> String {
    let title = title.replace('"', "'");
    let body = if mode == "summary" {
        "Donne un RÉSUMÉ SYNTHÉTIQUE (5 à 8 lignes maximum) :\n\
         - l'objectif de la PR, en une phrase ;\n\
         - les changements clés, regroupés par thème ;\n\
         - tout point qui mérite l'attention du relecteur.\n\
         Va à l'essentiel."
    } else {
        "Fournis une RELECTURE DE PR COMPLÈTE et structurée :\n\
         1. Objectif : le problème résolu et l'approche.\n\
         2. Tour des changements : par fichier / module, ce qui change et pourquoi.\n\
         3. Qualité & conception : lisibilité, choix d'architecture, cohérence.\n\
         4. Risques & bugs potentiels : cas limites, régressions, sécurité.\n\
         5. Tests : couverture, ce qu'il manque.\n\
         6. Verdict : prêt à merger ? sinon, les points bloquants.\n\
         Sois précis et cite le code concerné."
    };
    format!(
        "Tu es un relecteur de code expert. Analyse la Pull Request #{number} (titre : {title}) de ce dépôt.\n\n\
         Commence par exécuter `gh pr view {number}` (description) puis `gh pr diff {number}` (diff complet) ; explore les fichiers concernés si besoin.\n\n\
         {body}\n\n\
         Branche : `{head}` → `{base}`.\n\n\
         Ensuite, reste disponible : je vais te poser des questions sur cette PR.",
    )
}

/// Run `claude` non-interactively (print mode) and return its stdout. Unlike the
/// PTY path (which streams free text to a terminal), this is for one-shot calls
/// whose output we parse as JSON. The needed context is embedded in `prompt`.
pub fn run_claude_headless(repo: &Path, prompt: &str) -> Result<String> {
    let claude = resolve_claude();
    let mut args: Vec<String> = Vec::new();
    push_allowed_tools(&mut |a| args.push(a.to_string()));
    args.push("-p".to_string()); // print / non-interactive mode
    // `--` ends option parsing so the variadic `--allowedTools` can't swallow the prompt.
    args.push("--".to_string());
    args.push(prompt.to_string());
    let r = crate::proc::run(&claude, args.iter().map(String::as_str), Some(repo))
        .map_err(|e| AppError::new(format!("Could not run claude: {e}")))?;
    if !r.success {
        return Err(AppError::new(format!(
            "claude failed: {}",
            r.stderr.trim()
        )));
    }
    Ok(r.stdout)
}

/// Pull the first `{ ... }` object out of model output, tolerating any prose or
/// Markdown fences the model may wrap around it.
pub fn extract_json(s: &str) -> Result<&str> {
    let start = s
        .find('{')
        .ok_or_else(|| AppError::new("claude returned no JSON"))?;
    let end = s
        .rfind('}')
        .ok_or_else(|| AppError::new("claude returned no JSON"))?;
    if end > start {
        Ok(&s[start..=end])
    } else {
        Err(AppError::new("claude returned no JSON"))
    }
}

/// Prompt asking `claude` to review a whole PR and return STRUCTURED JSON findings.
pub fn pr_review_prompt(detail: &crate::model::PrDetail) -> String {
    let files: Vec<String> = detail.files.iter().map(|f| f.path.clone()).collect();
    let files_line = if files.is_empty() {
        "(aucun)".to_string()
    } else {
        files.join(", ")
    };
    let commits = if detail.commits.is_empty() {
        "(aucun)".to_string()
    } else {
        detail.commits.join("\n- ")
    };
    format!(
        "Tu es un relecteur de code expert et exigeant. Relis la Pull Request #{number} (titre : {title}).\n\
         Branche : `{head}` → `{base}`. Fichiers : {files_line}.\n\
         Commits :\n- {commits}\n\n\
         Voici le DIFF UNIFIÉ COMPLET de la PR (il a pu être tronqué s'il est très volumineux) :\n\
         ```diff\n{diff}\n```\n\n\
         Analyse le diff et relève les problèmes concrets et actionnables : bugs, régressions, cas limites, \
         sécurité, fuites/performances, lisibilité, tests manquants.\n\n\
         RÉPONDS UNIQUEMENT avec un objet JSON valide — aucun texte avant ou après, pas de balises Markdown. \
         Les clés JSON doivent être EXACTEMENT `summary` et `findings` (en anglais, pas `issues`). Forme :\n\
         {{\"summary\": \"<2 à 4 phrases : objectif de la PR et verdict global>\", \
         \"findings\": [{{\"file\": \"<chemin relatif>\", \"line\": <numéro de ligne ou null>, \
         \"severity\": \"info|warning|critical\", \"title\": \"<titre court>\", \"detail\": \"<explication + correctif suggéré>\"}}]}}\n\
         Limite-toi aux ~20 findings les plus importants ; si rien à signaler, renvoie une liste \"findings\" vide. \
         Rédige summary, title et detail en français.",
        number = detail.number,
        title = detail.title.replace('"', "'"),
        head = detail.head_ref,
        base = detail.base_ref,
        files_line = files_line,
        commits = commits,
        diff = detail.diff,
    )
}

/// Prompt asking `claude` to resolve a single conflicted file and return STRUCTURED JSON.
pub fn conflict_resolution_prompt(
    file: &str,
    marked: &str,
    base: Option<&str>,
    ours: Option<&str>,
    theirs: Option<&str>,
) -> String {
    let section = |label: &str, content: Option<&str>| -> String {
        match content {
            Some(c) => format!("\n--- {label} ---\n```\n{c}\n```\n"),
            None => String::new(),
        }
    };
    format!(
        "Tu es un expert Git. Le fichier `{file}` est en conflit de merge/rebase. \
         Voici son contenu actuel AVEC les marqueurs de conflit (<<<<<<<, =======, >>>>>>>) :\n\
         ```\n{marked}\n```\n{base}{ours}{theirs}\n\
         Résous le conflit en produisant le contenu FINAL et COMPLET du fichier, cohérent et compilable, \
         en combinant correctement les deux côtés et SANS aucun marqueur de conflit.\n\n\
         RÉPONDS UNIQUEMENT avec un objet JSON valide — aucun texte avant ou après, pas de Markdown — de la forme :\n\
         {{\"explanation\": \"<2 à 4 phrases en français : ce que tu as gardé de chaque côté et pourquoi>\", \
         \"resolution\": \"<contenu COMPLET du fichier résolu, sans marqueurs>\"}}",
        file = file,
        marked = marked,
        base = section("BASE (ancêtre commun)", base),
        ours = section("OURS (HEAD courant)", ours),
        theirs = section("THEIRS (commit appliqué)", theirs),
    )
}

/// Read-only tools pre-allowed so Claude can inspect a commit without prompting,
/// while STILL asking before anything that writes or runs arbitrary commands.
/// `--allowedTools` is VARIADIC (`<tools...>`): it greedily consumes every
/// following argument until the next flag. The positional prompt is therefore
/// passed after a `--` separator (see `pty_command`) so it isn't swallowed as a
/// tool value — otherwise `claude` launches with no prompt and nothing is sent.
const READONLY_TOOLS: [&str; 11] = [
    "Bash(git show:*)",
    "Bash(git log:*)",
    "Bash(git diff:*)",
    "Bash(git status:*)",
    "Bash(gh pr view:*)",
    "Bash(gh pr diff:*)",
    "Bash(gh pr checks:*)",
    "Bash(gh pr list:*)",
    "Read",
    "Grep",
    "Glob",
];

fn push_allowed_tools(push: &mut impl FnMut(&str)) {
    for t in READONLY_TOOLS {
        push("--allowedTools");
        push(t);
    }
}

/// A `CommandBuilder` that runs `claude` pre-seeded with `prompt`, for use inside a PTY.
/// Spawned directly (no shell) so the multi-line prompt arg is passed intact.
pub fn pty_command(repo: &Path, prompt: &str) -> Result<portable_pty::CommandBuilder> {
    let mut cmd = portable_pty::CommandBuilder::new(resolve_claude());
    push_allowed_tools(&mut |a| {
        cmd.arg(a);
    });
    // `--` ends option parsing so the variadic `--allowedTools` above cannot
    // swallow the prompt; it is then taken as the positional `[prompt]` arg.
    cmd.arg("--");
    cmd.arg(prompt);
    cmd.cwd(repo);
    Ok(cmd)
}

/// Launch `claude` in a separate external terminal window (non-embedded fallback).
#[allow(dead_code)]
pub fn launch_claude(repo: &Path, prompt: &str) -> Result<()> {
    #[allow(unused_mut)]
    let mut cmd = std::process::Command::new(resolve_claude());
    push_allowed_tools(&mut |a| {
        cmd.arg(a);
    });
    // `--` so the variadic `--allowedTools` doesn't swallow the prompt.
    cmd.arg("--").arg(prompt).current_dir(repo);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
        cmd.creation_flags(CREATE_NEW_CONSOLE);
    }
    cmd.spawn()
        .map_err(|e| AppError::new(format!("Could not launch claude: {}", e)))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Regression: `--allowedTools` is variadic, so the prompt MUST be passed
    // after a `--` separator. Without it the prompt is consumed as a tool value
    // and `claude` starts with no input — "nothing is sent".
    #[test]
    fn prompt_passed_as_positional_after_double_dash() {
        let prompt = "Tu es un relecteur de code.\nAnalyse le commit `abc12345`.";
        let cmd = pty_command(Path::new("."), prompt).unwrap();
        let argv: Vec<&str> = cmd
            .get_argv()
            .iter()
            .map(|a| a.to_str().unwrap())
            .collect();

        // The prompt is the final argument...
        assert_eq!(*argv.last().unwrap(), prompt);
        // ...immediately preceded by a `--` separator...
        assert_eq!(argv[argv.len() - 2], "--");
        // ...that sits after every `--allowedTools` flag.
        let dd = argv.iter().rposition(|a| *a == "--").unwrap();
        let last_tools = argv.iter().rposition(|a| *a == "--allowedTools").unwrap();
        assert!(last_tools < dd, "-- must come after all --allowedTools flags");
    }

    // Ground-truth smoke test: spawns REAL `claude` interactively through a PTY
    // (exactly like the app) and checks the seeded prompt is auto-submitted.
    // Hits the API (one trivial turn). Run explicitly:
    //   cargo test --lib interactive_pty_autosubmits -- --ignored --nocapture
    #[test]
    #[ignore]
    fn interactive_pty_autosubmits() {
        use portable_pty::{native_pty_system, PtySize};
        use std::io::Read;
        use std::sync::{Arc, Mutex};
        use std::time::{Duration, Instant};

        let repo = std::env::current_dir().unwrap();
        let prompt = "Ignore tout contexte. Réponds par un seul mot, exactement: PONGXYZ";
        let cmd = pty_command(&repo, prompt).unwrap();

        let pair = native_pty_system()
            .openpty(PtySize { rows: 40, cols: 120, pixel_width: 0, pixel_height: 0 })
            .unwrap();
        let mut child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().unwrap();

        let buf = Arc::new(Mutex::new(Vec::<u8>::new()));
        let buf2 = buf.clone();
        let t = std::thread::spawn(move || {
            let mut tmp = [0u8; 8192];
            while let Ok(n) = reader.read(&mut tmp) {
                if n == 0 {
                    break;
                }
                buf2.lock().unwrap().extend_from_slice(&tmp[..n]);
            }
        });

        let deadline = Instant::now() + Duration::from_secs(40);
        let mut seen = false;
        while Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(500));
            let s = String::from_utf8_lossy(&buf.lock().unwrap()).to_string();
            // "PONGXYZ" echoed in the assistant turn => the prompt was submitted.
            if s.matches("PONGXYZ").count() >= 2 {
                seen = true;
                break;
            }
        }
        let _ = child.kill();
        let _ = t.join();

        let out = String::from_utf8_lossy(&buf.lock().unwrap()).to_string();
        eprintln!(
            "----- PTY OUTPUT ({} bytes) -----\n{}\n----- END OUTPUT -----",
            out.len(),
            out
        );
        eprintln!("auto-submitted (PONGXYZ seen in a reply): {}", seen);
    }
}
