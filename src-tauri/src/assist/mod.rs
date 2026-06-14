use crate::error::{AppError, Result};
use crate::git;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

/// Resolve the full path to the `claude` executable (so we spawn it directly,
/// bypassing any shell — Windows PowerShell 5.1 mangles quoted/multi-line args).
pub(crate) fn resolve_claude() -> String {
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

/// Shown when an AI feature is invoked but the `claude` CLI isn't installed. Includes the
/// install command + docs link. Claude is checked at point of use, never at startup.
pub(crate) const CLAUDE_MISSING_MSG: &str = "Claude Code introuvable. Installe la CLI `claude` \
     pour les aides IA : npm install -g @anthropic-ai/claude-code  ·  \
     https://docs.claude.com/en/docs/claude-code/setup";

/// Verify the `claude` CLI is runnable, returning a friendly install message if not. Called
/// at the entry of each AI funnel (headless / chat / terminal) so the dependency is only
/// checked when an AI feature is actually used. In Ollama mode `claude` is still the engine
/// (Ollama only supplies the model), so we also require that a model has been chosen.
pub(crate) fn ensure_claude_available() -> Result<()> {
    let claude = resolve_claude();
    let ok = crate::proc::run(&claude, ["--version"], None)
        .map(|r| r.success)
        .unwrap_or(false);
    if !ok {
        return Err(AppError::new(CLAUDE_MISSING_MSG));
    }
    let cfg = ai_config().lock().unwrap();
    if cfg.backend == AiBackend::Ollama && cfg.ollama_model.trim().is_empty() {
        return Err(AppError::new(
            "Mode Ollama actif mais aucun modèle choisi — sélectionnes-en un dans \
             Réglages → Backend IA.",
        ));
    }
    Ok(())
}

/// Which engine backs the `claude` CLI: Anthropic's cloud API (the user's own login) or a
/// local Ollama server exposing the Anthropic-compatible API.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum AiBackend {
    Anthropic,
    Ollama,
}

#[derive(Clone, Debug)]
pub(crate) struct AiConfig {
    pub backend: AiBackend,
    pub ollama_host: String,
    pub ollama_model: String,
    /// Model for Anthropic mode (alias like `sonnet`/`opus`/`haiku` or a full name);
    /// empty means "use Claude Code's own default".
    pub anthropic_model: String,
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            backend: AiBackend::Anthropic,
            ollama_host: "http://localhost:11434".to_string(),
            ollama_model: String::new(),
            anthropic_model: String::new(),
        }
    }
}

/// Process-global AI backend config (same pattern as `undo::global()`), so the spawn
/// funnels — which are plain functions, not command handlers with `State` — can read it
/// without threading it through every call site. Synced from the frontend settings.
pub(crate) fn ai_config() -> &'static Mutex<AiConfig> {
    static CFG: OnceLock<Mutex<AiConfig>> = OnceLock::new();
    CFG.get_or_init(|| Mutex::new(AiConfig::default()))
}

/// UI language, mirrored from the frontend so the `claude` prompts are written in the
/// user's language. Set via the `set_ui_language` command (commands.rs) at startup and
/// whenever the language is changed in Settings. The visible seed prompts (commit / PR
/// analysis, merge assists, repo chat) are fully translated; the headless JSON prompts
/// keep their French scaffolding and only steer the OUTPUT language via `output_name`.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum Lang {
    #[default]
    Fr,
    En,
    Es,
    De,
}

impl Lang {
    /// Parse a frontend language code ("fr"/"en"/"es"/"de"); unknown falls back to English.
    pub fn from_code(code: &str) -> Lang {
        match code.trim().to_ascii_lowercase().as_str() {
            "fr" => Lang::Fr,
            "es" => Lang::Es,
            "de" => Lang::De,
            _ => Lang::En,
        }
    }

    /// The language's French name — interpolated into the French-scaffolded headless
    /// prompts (whose text the user never sees) so only Claude's OUTPUT is localized.
    fn output_name(self) -> &'static str {
        match self {
            Lang::Fr => "français",
            Lang::En => "anglais",
            Lang::Es => "espagnol",
            Lang::De => "allemand",
        }
    }
}

/// Shared cell behind `ui_lang` / `set_ui_lang` (same OnceLock<Mutex<…>> pattern as the
/// AI config, so the spawn funnels can read it without threading it through every call).
fn ui_lang_cell() -> &'static Mutex<Lang> {
    static LANG: OnceLock<Mutex<Lang>> = OnceLock::new();
    LANG.get_or_init(|| Mutex::new(Lang::default()))
}

/// The current UI language (defaults to French until the frontend syncs it at startup).
pub(crate) fn ui_lang() -> Lang {
    *ui_lang_cell().lock().unwrap()
}

/// Update the global UI language from a frontend code ("fr"/"en"/"es"/"de").
pub(crate) fn set_ui_lang(code: &str) {
    *ui_lang_cell().lock().unwrap() = Lang::from_code(code);
}

/// Default Ollama endpoint (loopback), used when none or an invalid host is configured.
pub(crate) const DEFAULT_OLLAMA_HOST: &str = "http://localhost:11434";

/// Validate & normalize a user-supplied Ollama host before it is queried (`ollama_models`)
/// or injected as `ANTHROPIC_BASE_URL` into every spawned `claude`. Rejects non-http(s)
/// schemes and SSRF / cloud-metadata targets (link-local `169.254.0.0/16`, `0.0.0.0`,
/// broadcast). Loopback, LAN and public hosts are allowed — the user may legitimately run
/// Ollama elsewhere — so this denies the dangerous ranges rather than locking to loopback.
pub(crate) fn validate_ollama_host(raw: &str) -> Result<String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Ok(DEFAULT_OLLAMA_HOST.to_string());
    }
    let u = url::Url::parse(raw)
        .map_err(|_| AppError::new("Hôte Ollama invalide (URL malformée)."))?;
    if !matches!(u.scheme(), "http" | "https") {
        return Err(AppError::new("Hôte Ollama : seuls les schémas http/https sont autorisés."));
    }
    let host = u
        .host_str()
        .ok_or_else(|| AppError::new("Hôte Ollama : nom d'hôte manquant."))?;
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        let blocked = match ip {
            std::net::IpAddr::V4(v4) => {
                v4.is_link_local() || v4.is_unspecified() || v4.is_broadcast()
            }
            std::net::IpAddr::V6(v6) => v6.is_unspecified(),
        };
        if blocked {
            return Err(AppError::new(
                "Hôte Ollama : adresse non autorisée (lien-local / métadonnées cloud).",
            ));
        }
    }
    Ok(u.as_str().trim_end_matches('/').to_string())
}

/// Update the global config from the frontend (`anthropic` or `ollama`).
pub(crate) fn set_ai_config(
    backend: &str,
    ollama_host: String,
    ollama_model: String,
    anthropic_model: String,
) {
    let mut cfg = ai_config().lock().unwrap();
    cfg.backend = if backend.eq_ignore_ascii_case("ollama") {
        AiBackend::Ollama
    } else {
        AiBackend::Anthropic
    };
    // Never store a dangerous host: an invalid value falls back to loopback so it can't be
    // used as an SSRF target or a plaintext-exfiltration sink (see `validate_ollama_host`).
    cfg.ollama_host =
        validate_ollama_host(&ollama_host).unwrap_or_else(|_| DEFAULT_OLLAMA_HOST.to_string());
    cfg.ollama_model = ollama_model;
    cfg.anthropic_model = anthropic_model;
}

/// Environment variables to inject when launching `claude` (applied by all three funnels).
/// Always includes git-hardening vars: `claude` reads untrusted repos/PRs, and its pre-
/// allowed "read-only" git tools (`git show/log/diff`) can otherwise be steered — e.g. an
/// `ext::` URL in a hostile `.gitmodules` — into running a command. `GIT_CONFIG_*` has higher
/// precedence than the repo's own config, so a malicious cloned repo can't re-enable these.
/// On top of that, Ollama mode points `claude` at the (validated) local server and pins both
/// the main and the small/fast model — otherwise Claude Code's background calls would try
/// (and fail) to reach Anthropic. Anthropic mode adds only `ANTHROPIC_MODEL` when chosen.
pub(crate) fn ai_env() -> Vec<(String, String)> {
    let cfg = ai_config().lock().unwrap().clone();
    let mut env = vec![
        ("GIT_TERMINAL_PROMPT".to_string(), "0".to_string()),
        ("GIT_CONFIG_COUNT".to_string(), "2".to_string()),
        ("GIT_CONFIG_KEY_0".to_string(), "core.pager".to_string()),
        ("GIT_CONFIG_VALUE_0".to_string(), "cat".to_string()),
        ("GIT_CONFIG_KEY_1".to_string(), "protocol.ext.allow".to_string()),
        ("GIT_CONFIG_VALUE_1".to_string(), "never".to_string()),
    ];
    match cfg.backend {
        AiBackend::Anthropic => {
            // Override only the main model when chosen; leave the small/fast model as the
            // account default (no reason to pay big-model cost for background calls). Empty
            // means Claude Code's own default model.
            let model = cfg.anthropic_model.trim();
            if !model.is_empty() {
                env.push(("ANTHROPIC_MODEL".to_string(), model.to_string()));
            }
        }
        AiBackend::Ollama => {
            // Re-validate defensively (set_ai_config already stores only safe hosts).
            let host = validate_ollama_host(&cfg.ollama_host)
                .unwrap_or_else(|_| DEFAULT_OLLAMA_HOST.to_string());
            env.push(("ANTHROPIC_BASE_URL".to_string(), host));
            env.push(("ANTHROPIC_AUTH_TOKEN".to_string(), "ollama".to_string()));
            env.push(("ANTHROPIC_API_KEY".to_string(), String::new()));
            let model = cfg.ollama_model.trim();
            if !model.is_empty() {
                env.push(("ANTHROPIC_MODEL".to_string(), model.to_string()));
                env.push(("ANTHROPIC_SMALL_FAST_MODEL".to_string(), model.to_string()));
            }
        }
    }
    env
}

/// The prompt injected into `claude` to analyze a commit, in the UI language `lang`.
/// `mode` is "summary" (short synthesis) or "detailed" (in-depth review).
pub fn analysis_prompt(repo: &Path, sha: &str, mode: &str, lang: Lang) -> Result<String> {
    let detail = git::commit_detail(repo, sha)?;
    let subject = detail
        .message
        .lines()
        .next()
        .unwrap_or("")
        .replace('"', "'");
    let files: Vec<String> = detail.files.iter().map(|f| f.path.clone()).collect();
    let short: String = sha.chars().take(8).collect();
    let none = match lang {
        Lang::Fr => "(aucun)",
        Lang::En => "(none)",
        Lang::Es => "(ninguno)",
        Lang::De => "(keine)",
    };
    let files_line = if files.is_empty() {
        none.to_string()
    } else {
        files.join(", ")
    };
    let is_summary = mode == "summary";

    let body = match (lang, is_summary) {
        (Lang::Fr, true) => "Donne un RÉSUMÉ SYNTHÉTIQUE (5 à 8 lignes maximum) :\n- ce que fait ce commit, en une phrase ;\n- les changements clés, fichier par fichier ;\n- l'intention probable derrière le changement.\nVa à l'essentiel.",
        (Lang::Fr, false) => "Fournis une ANALYSE COMPLÈTE et structurée :\n1. Résumé : ce que fait ce commit.\n2. Détail par fichier / fonction : ce qui change et pourquoi.\n3. Intention et conception : le but, les choix de design.\n4. Impact : effets sur le reste du code, compatibilité, performances.\n5. Risques et bugs potentiels : points fragiles, cas limites non gérés.\n6. Suggestions : améliorations possibles et tests à ajouter.\nSois précis et cite le code concerné.",
        (Lang::En, true) => "Give a CONCISE SUMMARY (5 to 8 lines maximum):\n- what this commit does, in one sentence;\n- the key changes, file by file;\n- the probable intent behind the change.\nGet straight to the point.",
        (Lang::En, false) => "Provide a COMPLETE, structured ANALYSIS:\n1. Summary: what this commit does.\n2. File/function detail: what changes and why.\n3. Intent and design: the goal, the design choices.\n4. Impact: effects on the rest of the code, compatibility, performance.\n5. Potential risks and bugs: fragile points, unhandled edge cases.\n6. Suggestions: possible improvements and tests to add.\nBe precise and cite the relevant code.",
        (Lang::Es, true) => "Da un RESUMEN CONCISO (5 a 8 líneas máximo):\n- qué hace este commit, en una frase;\n- los cambios clave, archivo por archivo;\n- la intención probable detrás del cambio.\nVe a lo esencial.",
        (Lang::Es, false) => "Proporciona un ANÁLISIS COMPLETO y estructurado:\n1. Resumen: qué hace este commit.\n2. Detalle por archivo / función: qué cambia y por qué.\n3. Intención y diseño: el objetivo, las decisiones de diseño.\n4. Impacto: efectos en el resto del código, compatibilidad, rendimiento.\n5. Riesgos y posibles bugs: puntos frágiles, casos límite no gestionados.\n6. Sugerencias: posibles mejoras y tests que añadir.\nSé preciso y cita el código en cuestión.",
        (Lang::De, true) => "Gib eine KOMPAKTE ZUSAMMENFASSUNG (maximal 5 bis 8 Zeilen):\n- was dieser commit macht, in einem Satz;\n- die wichtigsten Änderungen, Datei für Datei;\n- die wahrscheinliche Absicht hinter der Änderung.\nKomm direkt auf den Punkt.",
        (Lang::De, false) => "Liefere eine VOLLSTÄNDIGE, strukturierte ANALYSE:\n1. Zusammenfassung: was dieser commit macht.\n2. Detail pro Datei / Funktion: was sich ändert und warum.\n3. Absicht und Design: das Ziel, die Design-Entscheidungen.\n4. Auswirkung: Effekte auf den restlichen Code, Kompatibilität, Performance.\n5. Risiken und mögliche Bugs: fragile Stellen, nicht behandelte Randfälle.\n6. Vorschläge: mögliche Verbesserungen und zu ergänzende Tests.\nSei präzise und zitiere den betroffenen Code.",
    };

    Ok(match lang {
        Lang::Fr => format!(
            "Tu es un relecteur de code expert. Analyse le commit `{short}` (sujet : {subject}) de ce dépôt git.\n\nCommence par exécuter `git show {sha}` pour lire le diff complet (explore les fichiers concernés si besoin).\n\n{body}\n\nFichiers modifiés : {files_line}.\n\nEnsuite, reste disponible : je vais te poser des questions sur ce code."
        ),
        Lang::En => format!(
            "You are an expert code reviewer. Analyze commit `{short}` (subject: {subject}) in this git repository.\n\nStart by running `git show {sha}` to read the full diff (explore the affected files if needed).\n\n{body}\n\nChanged files: {files_line}.\n\nThen stay available: I'm going to ask you questions about this code."
        ),
        Lang::Es => format!(
            "Eres un revisor de código experto. Analiza el commit `{short}` (asunto: {subject}) de este repositorio git.\n\nEmpieza ejecutando `git show {sha}` para leer el diff completo (explora los archivos afectados si hace falta).\n\n{body}\n\nArchivos modificados: {files_line}.\n\nLuego permanece disponible: voy a hacerte preguntas sobre este código."
        ),
        Lang::De => format!(
            "Du bist ein erfahrener Code-Reviewer. Analysiere den commit `{short}` (Betreff: {subject}) in diesem git-Repository.\n\nFühre zunächst `git show {sha}` aus, um den vollständigen diff zu lesen (sieh dir bei Bedarf die betroffenen Dateien an).\n\n{body}\n\nGeänderte Dateien: {files_line}.\n\nBleib anschließend verfügbar: Ich werde dir Fragen zu diesem Code stellen."
        ),
    })
}

/// The prompt injected into `claude` to analyze a whole Pull Request, in the UI
/// language `lang`. `mode` is "summary" or "detailed".
pub fn pr_analysis_prompt(
    number: u64,
    title: &str,
    head: &str,
    base: &str,
    mode: &str,
    lang: Lang,
) -> String {
    let title = title.replace('"', "'");
    let is_summary = mode == "summary";
    let body = match (lang, is_summary) {
        (Lang::Fr, true) => "Donne un RÉSUMÉ SYNTHÉTIQUE (5 à 8 lignes maximum) :\n- l'objectif de la PR, en une phrase ;\n- les changements clés, regroupés par thème ;\n- tout point qui mérite l'attention du relecteur.\nVa à l'essentiel.",
        (Lang::Fr, false) => "Fournis une RELECTURE DE PR COMPLÈTE et structurée :\n1. Objectif : le problème résolu et l'approche.\n2. Tour des changements : par fichier / module, ce qui change et pourquoi.\n3. Qualité & conception : lisibilité, choix d'architecture, cohérence.\n4. Risques & bugs potentiels : cas limites, régressions, sécurité.\n5. Tests : couverture, ce qu'il manque.\n6. Verdict : prêt à merger ? sinon, les points bloquants.\nSois précis et cite le code concerné.",
        (Lang::En, true) => "Give a CONCISE SUMMARY (5 to 8 lines maximum):\n- the PR's goal, in one sentence;\n- the key changes, grouped by theme;\n- anything that deserves the reviewer's attention.\nGet straight to the point.",
        (Lang::En, false) => "Provide a COMPLETE, structured PR REVIEW:\n1. Goal: the problem solved and the approach.\n2. Tour of the changes: by file / module, what changes and why.\n3. Quality & design: readability, architecture choices, consistency.\n4. Potential risks & bugs: edge cases, regressions, security.\n5. Tests: coverage, what's missing.\n6. Verdict: ready to merge? if not, the blocking points.\nBe precise and cite the relevant code.",
        (Lang::Es, true) => "Da un RESUMEN CONCISO (5 a 8 líneas máximo):\n- el objetivo de la PR, en una frase;\n- los cambios clave, agrupados por tema;\n- cualquier punto que merezca la atención del revisor.\nVe a lo esencial.",
        (Lang::Es, false) => "Proporciona una REVISIÓN DE PR COMPLETA y estructurada:\n1. Objetivo: el problema resuelto y el enfoque.\n2. Recorrido de los cambios: por archivo / módulo, qué cambia y por qué.\n3. Calidad y diseño: legibilidad, decisiones de arquitectura, coherencia.\n4. Riesgos y posibles bugs: casos límite, regresiones, seguridad.\n5. Tests: cobertura, lo que falta.\n6. Veredicto: ¿lista para merge? si no, los puntos bloqueantes.\nSé preciso y cita el código en cuestión.",
        (Lang::De, true) => "Gib eine KOMPAKTE ZUSAMMENFASSUNG (maximal 5 bis 8 Zeilen):\n- das Ziel der PR, in einem Satz;\n- die wichtigsten Änderungen, nach Thema gruppiert;\n- alles, was die Aufmerksamkeit des Reviewers verdient.\nKomm direkt auf den Punkt.",
        (Lang::De, false) => "Liefere ein VOLLSTÄNDIGES, strukturiertes PR-REVIEW:\n1. Ziel: das gelöste Problem und der Ansatz.\n2. Rundgang durch die Änderungen: pro Datei / Modul, was sich ändert und warum.\n3. Qualität & Design: Lesbarkeit, Architekturentscheidungen, Konsistenz.\n4. Risiken & mögliche Bugs: Randfälle, Regressionen, Sicherheit.\n5. Tests: Abdeckung, was fehlt.\n6. Fazit: bereit zum mergen? falls nicht, die blockierenden Punkte.\nSei präzise und zitiere den betroffenen Code.",
    };
    match lang {
        Lang::Fr => format!(
            "Tu es un relecteur de code expert. Analyse la Pull Request #{number} (titre : {title}) de ce dépôt.\n\nCommence par exécuter `gh pr view {number}` (description) puis `gh pr diff {number}` (diff complet) ; explore les fichiers concernés si besoin.\n\n{body}\n\nBranche : `{head}` → `{base}`.\n\nEnsuite, reste disponible : je vais te poser des questions sur cette PR."
        ),
        Lang::En => format!(
            "You are an expert code reviewer. Analyze Pull Request #{number} (title: {title}) in this repository.\n\nStart by running `gh pr view {number}` (description) then `gh pr diff {number}` (full diff); explore the affected files if needed.\n\n{body}\n\nBranch: `{head}` → `{base}`.\n\nThen stay available: I'm going to ask you questions about this PR."
        ),
        Lang::Es => format!(
            "Eres un revisor de código experto. Analiza la Pull Request #{number} (título: {title}) de este repositorio.\n\nEmpieza ejecutando `gh pr view {number}` (descripción) y luego `gh pr diff {number}` (diff completo); explora los archivos afectados si hace falta.\n\n{body}\n\nRama: `{head}` → `{base}`.\n\nLuego permanece disponible: voy a hacerte preguntas sobre esta PR."
        ),
        Lang::De => format!(
            "Du bist ein erfahrener Code-Reviewer. Analysiere den Pull Request #{number} (Titel: {title}) in diesem Repository.\n\nFühre zunächst `gh pr view {number}` (Beschreibung) und dann `gh pr diff {number}` (vollständiger diff) aus; sieh dir bei Bedarf die betroffenen Dateien an.\n\n{body}\n\nBranch: `{head}` → `{base}`.\n\nBleib anschließend verfügbar: Ich werde dir Fragen zu diesem PR stellen."
        ),
    }
}

/// The prompt injected into `claude` to ASSIST with merging a Pull Request, in the
/// context of this stacked-PR tool: check readiness, choose a strategy, run the merge
/// (only after the user confirms), then re-sync the stack. Unlike the analysis prompts
/// this one is meant to *act* — `gh pr merge` is NOT among the pre-allowed read-only
/// tools, so it will ask for confirmation in the terminal before anything lands.
pub fn merge_assist_prompt(
    number: u64,
    title: &str,
    head: &str,
    base: &str,
    trunk: &str,
    lang: Lang,
) -> String {
    let title = title.replace('"', "'");
    let at_trunk = base == trunk;
    let position = match (lang, at_trunk) {
        (Lang::Fr, true) => format!("Cette PR est à la BASE de la pile (sa base `{base}` est le tronc `{trunk}`) : elle peut être mergée maintenant."),
        (Lang::Fr, false) => format!("ATTENTION : la base de cette PR est `{base}`, et non le tronc `{trunk}`. Dans une pile on merge de bas en haut — la ou les PR parentes doivent être mergées d'abord. Signale-le clairement et n'effectue PAS le merge tant que cette PR n'est pas posée sur le tronc."),
        (Lang::En, true) => format!("This PR is at the BOTTOM of the stack (its base `{base}` is the trunk `{trunk}`): it can be merged now."),
        (Lang::En, false) => format!("WARNING: this PR's base is `{base}`, not the trunk `{trunk}`. In a stack you merge from the bottom up — the parent PR(s) must be merged first. Flag this clearly and do NOT perform the merge until this PR sits on the trunk."),
        (Lang::Es, true) => format!("Esta PR está en la BASE de la pila (su base `{base}` es el tronco `{trunk}`): se puede hacer merge ahora."),
        (Lang::Es, false) => format!("ATENCIÓN: la base de esta PR es `{base}`, y no el tronco `{trunk}`. En una pila se hace merge de abajo hacia arriba — la(s) PR padre deben mergearse primero. Indícalo claramente y NO hagas el merge mientras esta PR no esté apoyada sobre el tronco."),
        (Lang::De, true) => format!("Dieser PR liegt an der BASIS des Stacks (seine Basis `{base}` ist der Trunk `{trunk}`): er kann jetzt gemergt werden."),
        (Lang::De, false) => format!("ACHTUNG: Die Basis dieses PR ist `{base}` und nicht der Trunk `{trunk}`. In einem Stack wird von unten nach oben gemergt — der/die übergeordnete(n) PR müssen zuerst gemergt werden. Weise klar darauf hin und führe den merge NICHT aus, solange dieser PR nicht auf dem Trunk aufsetzt."),
    };
    match lang {
        Lang::Fr => format!(
            "Tu es un expert Git/GitHub qui m'aide à MERGER une Pull Request dans un dépôt géré en PILES de branches (stacked PRs). PR : #{number} (titre : {title}), branche `{head}` → `{base}`. Tronc : `{trunk}`.\n\n{position}\n\nAvance par étapes et DEMANDE-MOI confirmation avant toute action qui écrit (le merge) :\n1. Diagnostic de mergeabilité : exécute `gh pr view {number}` (état, reviewDecision, mergeable, conflits) et `gh pr checks {number}` (CI). Résume en quelques lignes et liste clairement les éventuels bloquants.\n2. Stratégie : si tout est au vert, recommande une méthode. Par défaut pour une pile, `--squash` (tronc linéaire ; les enfants seront re-parentés ensuite). Explique brièvement et laisse-moi trancher.\n3. Merge : après MON accord explicite, lance le merge, p. ex. `gh pr merge {number} --squash`. N'ajoute PAS `--delete-branch` si des PR enfants sont encore empilées sur `{head}`.\n4. Après le merge : rappelle-moi de cliquer sur **Sync** dans gitui — l'app fast-forward le tronc, re-parente automatiquement les enfants de la branche mergée sur son parent et cesse de la suivre (la branche locale n'est jamais supprimée).\n\nCommence par l'étape 1, puis attends mes réponses ; reste disponible pour la suite."
        ),
        Lang::En => format!(
            "You are a Git/GitHub expert helping me MERGE a Pull Request in a repository managed as STACKS of branches (stacked PRs). PR: #{number} (title: {title}), branch `{head}` → `{base}`. Trunk: `{trunk}`.\n\n{position}\n\nProceed step by step and ASK ME for confirmation before any writing action (the merge):\n1. Mergeability check: run `gh pr view {number}` (state, reviewDecision, mergeable, conflicts) and `gh pr checks {number}` (CI). Summarize in a few lines and clearly list any blockers.\n2. Strategy: if everything is green, recommend a method. By default for a stack, `--squash` (linear trunk; the children will be re-parented afterwards). Explain briefly and let me decide.\n3. Merge: after MY explicit approval, run the merge, e.g. `gh pr merge {number} --squash`. Do NOT add `--delete-branch` if child PRs are still stacked on `{head}`.\n4. After the merge: remind me to click **Sync** in gitui — the app fast-forwards the trunk, automatically re-parents the children of the merged branch onto its parent and stops tracking it (the local branch is never deleted).\n\nStart with step 1, then wait for my answers; stay available for the rest."
        ),
        Lang::Es => format!(
            "Eres un experto en Git/GitHub que me ayuda a hacer MERGE de una Pull Request en un repositorio gestionado como PILAS de ramas (stacked PRs). PR: #{number} (título: {title}), rama `{head}` → `{base}`. Tronco: `{trunk}`.\n\n{position}\n\nAvanza por etapas y PÍDEME confirmación antes de cualquier acción que escriba (el merge):\n1. Diagnóstico de mergeabilidad: ejecuta `gh pr view {number}` (estado, reviewDecision, mergeable, conflictos) y `gh pr checks {number}` (CI). Resume en unas líneas y enumera claramente los posibles bloqueantes.\n2. Estrategia: si todo está en verde, recomienda un método. Por defecto para una pila, `--squash` (tronco lineal; los hijos se re-emparentarán después). Explica brevemente y déjame decidir.\n3. Merge: tras MI acuerdo explícito, lanza el merge, p. ej. `gh pr merge {number} --squash`. NO añadas `--delete-branch` si todavía hay PR hijas apiladas sobre `{head}`.\n4. Tras el merge: recuérdame hacer clic en **Sync** en gitui — la app hace fast-forward del tronco, re-emparenta automáticamente los hijos de la rama mergeada sobre su padre y deja de seguirla (la rama local nunca se elimina).\n\nEmpieza por la etapa 1 y luego espera mis respuestas; permanece disponible para lo que sigue."
        ),
        Lang::De => format!(
            "Du bist ein Git/GitHub-Experte, der mir hilft, einen Pull Request in einem als STACKS von Branches (stacked PRs) verwalteten Repository zu MERGEN. PR: #{number} (Titel: {title}), Branch `{head}` → `{base}`. Trunk: `{trunk}`.\n\n{position}\n\nGeh schrittweise vor und BITTE MICH um Bestätigung vor jeder schreibenden Aktion (dem merge):\n1. Mergeability-Prüfung: führe `gh pr view {number}` (Status, reviewDecision, mergeable, Konflikte) und `gh pr checks {number}` (CI) aus. Fasse in wenigen Zeilen zusammen und liste etwaige Blocker klar auf.\n2. Strategie: wenn alles grün ist, empfiehl eine Methode. Standard für einen Stack ist `--squash` (linearer Trunk; die Kinder werden danach umgehängt). Erkläre kurz und lass mich entscheiden.\n3. Merge: nach MEINER ausdrücklichen Zustimmung führe den merge aus, z. B. `gh pr merge {number} --squash`. Füge `--delete-branch` NICHT hinzu, wenn noch Kind-PRs auf `{head}` gestapelt sind.\n4. Nach dem merge: erinnere mich daran, in gitui auf **Sync** zu klicken — die App spult den Trunk per fast-forward vor, hängt die Kinder des gemergten Branches automatisch auf dessen Eltern um und verfolgt ihn nicht mehr (der lokale Branch wird nie gelöscht).\n\nBeginne mit Schritt 1 und warte dann auf meine Antworten; bleib für den Rest verfügbar."
        ),
    }
}

/// The prompt injected into `claude` to ASSIST with merging one local branch into
/// another (a plain `git merge`, NOT a PR). `source` is merged into `target`. As with
/// the PR merge assist, the writing commands (`git switch`/`merge`/`commit`) are not
/// pre-allowed, so they prompt for confirmation in the terminal.
pub fn branch_merge_prompt(source: &str, target: &str, trunk: &str, lang: Lang) -> String {
    match lang {
        Lang::Fr => format!(
            "Tu es un expert Git qui m'aide à MERGER localement la branche `{source}` (source) dans la branche `{target}` (cible). Le dépôt est géré en piles de branches (stacked PRs), tronc `{trunk}` ; on y restacke (rebase) d'habitude, mais ici je veux EXPLICITEMENT un merge — respecte ce choix.\n\nAvance par étapes et DEMANDE-MOI confirmation avant toute commande qui écrit (checkout, merge, commit) :\n1. État des lieux : `git status` (l'arbre de travail est-il propre ?), puis compare les branches — `git log --oneline {target}..{source}` (ce que `{source}` apporte) et `git log --oneline {source}..{target}` (ce qui manque à `{source}`). Indique si un fast-forward est possible et signale les risques de conflit.\n2. Stratégie : recommande la méthode adaptée — fast-forward si possible, sinon un commit de merge (`git merge {source}`), ou `--squash` si je veux un seul commit. Explique brièvement et laisse-moi trancher.\n3. Exécution : après MON accord, place-toi sur la cible (`git switch {target}`) puis lance le merge (p. ex. `git merge {source}`). Montre le résultat.\n4. En cas de conflit : NE devine pas — liste les fichiers en conflit (`git status`), aide-moi à les résoudre un par un (tu peux proposer le contenu final de chaque fichier), puis finalise avec `git add` + `git commit`. Si je préfère annuler, utilise `git merge --abort`.\n\nCommence par l'étape 1 et attends mes réponses ; reste disponible pour la suite."
        ),
        Lang::En => format!(
            "You are a Git expert helping me locally MERGE branch `{source}` (source) into branch `{target}` (target). The repository is managed as stacks of branches (stacked PRs), trunk `{trunk}`; we usually restack (rebase), but here I EXPLICITLY want a merge — respect that choice.\n\nProceed step by step and ASK ME for confirmation before any writing command (checkout, merge, commit):\n1. Lay of the land: `git status` (is the working tree clean?), then compare the branches — `git log --oneline {target}..{source}` (what `{source}` brings) and `git log --oneline {source}..{target}` (what `{source}` is missing). Say whether a fast-forward is possible and flag any conflict risk.\n2. Strategy: recommend the right method — fast-forward if possible, otherwise a merge commit (`git merge {source}`), or `--squash` if I want a single commit. Explain briefly and let me decide.\n3. Execution: after MY approval, switch to the target (`git switch {target}`) then run the merge (e.g. `git merge {source}`). Show the result.\n4. On conflict: do NOT guess — list the conflicted files (`git status`), help me resolve them one by one (you can propose the final content of each file), then finalize with `git add` + `git commit`. If I'd rather abort, use `git merge --abort`.\n\nStart with step 1 and wait for my answers; stay available for the rest."
        ),
        Lang::Es => format!(
            "Eres un experto en Git que me ayuda a hacer MERGE localmente de la rama `{source}` (origen) en la rama `{target}` (destino). El repositorio se gestiona como pilas de ramas (stacked PRs), tronco `{trunk}`; normalmente hacemos restack (rebase), pero aquí quiero EXPLÍCITAMENTE un merge — respeta esa decisión.\n\nAvanza por etapas y PÍDEME confirmación antes de cualquier comando que escriba (checkout, merge, commit):\n1. Estado de la situación: `git status` (¿está limpio el árbol de trabajo?), luego compara las ramas — `git log --oneline {target}..{source}` (lo que aporta `{source}`) y `git log --oneline {source}..{target}` (lo que le falta a `{source}`). Indica si es posible un fast-forward y señala los riesgos de conflicto.\n2. Estrategia: recomienda el método adecuado — fast-forward si es posible, si no un commit de merge (`git merge {source}`), o `--squash` si quiero un solo commit. Explica brevemente y déjame decidir.\n3. Ejecución: tras MI acuerdo, sitúate en el destino (`git switch {target}`) y lanza el merge (p. ej. `git merge {source}`). Muestra el resultado.\n4. En caso de conflicto: NO adivines — enumera los archivos en conflicto (`git status`), ayúdame a resolverlos uno a uno (puedes proponer el contenido final de cada archivo), y finaliza con `git add` + `git commit`. Si prefiero cancelar, usa `git merge --abort`.\n\nEmpieza por la etapa 1 y espera mis respuestas; permanece disponible para lo que sigue."
        ),
        Lang::De => format!(
            "Du bist ein Git-Experte, der mir hilft, den Branch `{source}` (Quelle) lokal in den Branch `{target}` (Ziel) zu MERGEN. Das Repository wird als Stacks von Branches (stacked PRs) verwaltet, Trunk `{trunk}`; normalerweise machen wir restack (rebase), aber hier will ich AUSDRÜCKLICH einen merge — respektiere diese Wahl.\n\nGeh schrittweise vor und BITTE MICH um Bestätigung vor jedem schreibenden Befehl (checkout, merge, commit):\n1. Bestandsaufnahme: `git status` (ist der Arbeitsbaum sauber?), dann vergleiche die Branches — `git log --oneline {target}..{source}` (was `{source}` beiträgt) und `git log --oneline {source}..{target}` (was `{source}` fehlt). Gib an, ob ein fast-forward möglich ist, und weise auf Konfliktrisiken hin.\n2. Strategie: empfiehl die passende Methode — fast-forward wenn möglich, sonst ein merge-Commit (`git merge {source}`), oder `--squash`, wenn ich einen einzigen commit will. Erkläre kurz und lass mich entscheiden.\n3. Ausführung: nach MEINER Zustimmung wechsle auf das Ziel (`git switch {target}`) und führe den merge aus (z. B. `git merge {source}`). Zeig das Ergebnis.\n4. Bei einem Konflikt: rate NICHT — liste die Konfliktdateien auf (`git status`), hilf mir, sie eine nach der anderen zu lösen (du kannst den endgültigen Inhalt jeder Datei vorschlagen), und schließe mit `git add` + `git commit` ab. Wenn ich lieber abbrechen will, nutze `git merge --abort`.\n\nBeginne mit Schritt 1 und warte auf meine Antworten; bleib für den Rest verfügbar."
        ),
    }
}

/// Prompt asking `claude` to write a commit message for `sha`, returned as JSON.
/// `mode` is "simple" (≤5 words) or "complet" (subject + body). The message must start
/// with a conventional-commit type (`feat:`, `fix:`, `update:`, …).
pub fn commit_message_prompt(sha: &str, mode: &str, lang: Lang) -> String {
    let short: String = sha.chars().take(8).collect();
    let out_lang = lang.output_name();
    let spec = if mode == "simple" {
        "Génère un message TRÈS COURT : le préfixe conventionnel suivi de 5 MOTS MAXIMUM \
         (ex. `fix: corrige le crash au démarrage`). Une seule ligne, aucun corps."
    } else {
        "Génère un message COMPLET : une ligne de sujet (préfixe conventionnel, ~50 caractères) \
         qui résume le changement, puis une ligne vide, puis un corps en quelques puces \
         expliquant le quoi et le pourquoi."
    };
    format!(
        "Tu es un expert Git. Lis le commit `{short}` avec `git show {sha}` (diff complet), \
         puis rédige SON message de commit.\n\n\
         Le message DOIT commencer par un type conventionnel suivi de deux-points — l'un de : \
         `feat:`, `fix:`, `update:`, `refactor:`, `docs:`, `test:`, `chore:`, `style:`, `perf:`, \
         `build:`, `ci:` — choisis le plus adapté au diff.\n\
         {spec}\n\n\
         Rédige le message en {out_lang}. RÉPONDS UNIQUEMENT avec un objet JSON valide, sans Markdown, de la forme :\n\
         {{\"message\": \"<le message de commit, \\n autorisés pour le corps>\"}}"
    )
}

/// Prompt to REVIEW a single commit and return STRUCTURED JSON findings (same contract
/// as `pr_review_prompt`, but for one commit's diff).
pub fn commit_review_prompt(sha: &str, message: &str, diff: &str, lang: Lang) -> String {
    let short: String = sha.chars().take(8).collect();
    let subject = message.lines().next().unwrap_or("").replace('"', "'");
    let out_lang = lang.output_name();
    format!(
        "Tu es un relecteur de code expert et exigeant. Relis le commit `{short}` (sujet : {subject}).\n\
         Voici son DIFF UNIFIÉ COMPLET (il a pu être tronqué s'il est très volumineux) :\n\
         ```diff\n{diff}\n```\n\n\
         Analyse le diff et relève les problèmes concrets et actionnables : bugs, régressions, cas limites, \
         sécurité, fuites/performances, lisibilité, tests manquants.\n\n\
         RÉPONDS UNIQUEMENT avec un objet JSON valide — aucun texte avant ou après, pas de Markdown. \
         Les clés doivent être EXACTEMENT `summary` et `findings`. Forme :\n\
         {{\"summary\": \"<2 à 4 phrases : ce que fait le commit et le verdict global>\", \
         \"findings\": [{{\"file\": \"<chemin relatif>\", \"line\": <numéro ou null>, \
         \"severity\": \"info|warning|critical\", \"title\": \"<titre court>\", \"detail\": \"<explication + correctif>\"}}]}}\n\
         Limite-toi aux ~15 findings les plus importants ; si rien à signaler, renvoie une liste vide. \
         Rédige summary, title et detail en {out_lang}."
    )
}

/// Prompt to suggest a branch name (kebab-case, conventional prefix) from a context blurb.
pub fn branch_name_prompt(context: &str) -> String {
    format!(
        "Propose UN nom de branche git, court, basé sur ce contexte :\n{context}\n\n\
         Règles : préfixe de type (`feat/`, `fix/`, `chore/`, `refactor/`, `docs/`, `test/`…), \
         puis 2 à 4 mots en kebab-case (minuscules, séparés par des tirets), sans espaces ni accents.\n\
         RÉPONDS UNIQUEMENT avec un objet JSON : {{\"name\": \"feat/mon-changement\"}}"
    )
}

/// Prompt to draft a PR title + Markdown body from a branch's commits and diffstat.
pub fn pr_description_prompt(branch: &str, base: &str, commits: &str, stat: &str, lang: Lang) -> String {
    let out_lang = lang.output_name();
    format!(
        "Tu rédiges la description d'une Pull Request pour la branche `{branch}` (base `{base}`).\n\
         Commits de la branche :\n{commits}\n\n\
         Fichiers modifiés (git diff --stat) :\n{stat}\n\n\
         Produis un TITRE concis (préfixe conventionnel `feat:`/`fix:`/… si pertinent, ~60 caractères) \
         et un CORPS en Markdown : 1 à 2 phrases de contexte, puis une liste à puces des changements clés, \
         et au besoin une courte section « Notes ». Rédige le titre et le corps en {out_lang}.\n\
         RÉPONDS UNIQUEMENT avec un objet JSON : {{\"title\": \"<titre>\", \"body\": \"<corps Markdown, \\n autorisés>\"}}"
    )
}

/// Run `claude` non-interactively (print mode) and return its stdout. Unlike the
/// PTY path (which streams free text to a terminal), this is for one-shot calls
/// whose output we parse as JSON. The needed context is embedded in `prompt`.
pub fn run_claude_headless(repo: &Path, prompt: &str) -> Result<String> {
    ensure_claude_available()?;
    let claude = resolve_claude();
    let mut args: Vec<String> = Vec::new();
    push_allowed_tools(&mut |a| args.push(a.to_string()));
    args.push("-p".to_string()); // print / non-interactive mode
    // `--` ends option parsing so the variadic `--allowedTools` can't swallow the prompt.
    args.push("--".to_string());
    args.push(prompt.to_string());
    // Backend env (empty for Anthropic; Ollama points claude at the local model).
    let env = ai_env();
    let env_ref: Vec<(&str, &str)> = env.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
    let r = crate::proc::run_env(&claude, args.iter().map(String::as_str), Some(repo), &env_ref)
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
pub fn pr_review_prompt(detail: &crate::model::PrDetail, lang: Lang) -> String {
    let out_lang = lang.output_name();
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
         Rédige summary, title et detail en {out_lang}.",
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
    lang: Lang,
) -> String {
    let out_lang = lang.output_name();
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
         {{\"explanation\": \"<2 à 4 phrases en {out_lang} : ce que tu as gardé de chaque côté et pourquoi>\", \
         \"resolution\": \"<contenu COMPLET du fichier résolu, sans marqueurs>\"}}",
        file = file,
        marked = marked,
        base = section("BASE (ancêtre commun)", base),
        ours = section("OURS (HEAD courant)", ours),
        theirs = section("THEIRS (commit appliqué)", theirs),
    )
}

/// Seed for the global "Ask Claude about this repo" chat, in the UI language `lang`
/// (kept short so the first turn is fast — claude introduces itself and waits instead
/// of exploring immediately). Visible to the user, so fully translated.
pub fn repo_chat_seed(lang: Lang) -> String {
    match lang {
        Lang::Fr => "Tu es mon assistant pour ce dépôt git (un outil de \"stacked PRs\" en Tauri + React + Rust). Je vais te poser des questions sur le code, l'historique, les branches et les PRs. Présente-toi en UNE phrase courte, puis attends ma question — n'explore rien tant que je n'ai pas demandé.".to_string(),
        Lang::En => "You are my assistant for this git repository (a \"stacked PRs\" tool built with Tauri + React + Rust). I'm going to ask you questions about the code, the history, the branches and the PRs. Introduce yourself in ONE short sentence, then wait for my question — don't explore anything until I ask.".to_string(),
        Lang::Es => "Eres mi asistente para este repositorio git (una herramienta de \"stacked PRs\" hecha con Tauri + React + Rust). Voy a hacerte preguntas sobre el código, el historial, las ramas y las PRs. Preséntate en UNA frase corta y luego espera mi pregunta — no explores nada hasta que lo pida.".to_string(),
        Lang::De => "Du bist mein Assistent für dieses git-Repository (ein \"stacked PRs\"-Tool mit Tauri + React + Rust). Ich werde dir Fragen zum Code, zur Historie, zu den Branches und den PRs stellen. Stell dich in EINEM kurzen Satz vor und warte dann auf meine Frage — erkunde nichts, bevor ich darum bitte.".to_string(),
    }
}

/// Appended to merge prompts in chat mode: nudges claude to ATTEMPT the write command
/// (which is denied → surfaces in `permission_denials` → the frontend's approval modal)
/// instead of only asking for confirmation in prose. Visible, so fully translated.
pub fn chat_merge_note(lang: Lang) -> String {
    match lang {
        Lang::Fr => "\n\nNote : nous sommes dans une interface chat (pas un terminal). Quand tu veux exécuter une commande qui écrit (merge, switch, commit), LANCE-LA directement : elle sera bloquée et une demande d'autorisation s'affichera pour que je la valide avant exécution. N'attends pas que je confirme en texte — propose, puis tente la commande.".to_string(),
        Lang::En => "\n\nNote: we are in a chat interface (not a terminal). When you want to run a command that writes (merge, switch, commit), RUN IT directly: it will be blocked and an authorization request will appear so I can approve it before execution. Don't wait for me to confirm in text — propose, then attempt the command.".to_string(),
        Lang::Es => "\n\nNota: estamos en una interfaz de chat (no un terminal). Cuando quieras ejecutar un comando que escribe (merge, switch, commit), LÁNZALO directamente: será bloqueado y aparecerá una solicitud de autorización para que la valide antes de ejecutarse. No esperes a que confirme por texto — propón y luego intenta el comando.".to_string(),
        Lang::De => "\n\nHinweis: Wir sind in einer Chat-Oberfläche (kein Terminal). Wenn du einen schreibenden Befehl ausführen willst (merge, switch, commit), FÜHRE IHN direkt aus: Er wird blockiert und es erscheint eine Berechtigungsanfrage, damit ich ihn vor der Ausführung bestätige. Warte nicht auf eine Bestätigung per Text — schlage vor und versuche dann den Befehl.".to_string(),
    }
}

/// Prompt to summarize a repo's pending updates into a short digest (headless; the user
/// only sees the OUTPUT, so the French scaffolding stays and only the output language is
/// steered). `items` is the pre-formatted, newline-joined list of changes.
pub fn update_digest_prompt(items: &str, lang: Lang) -> String {
    let out_lang = lang.output_name();
    format!(
        "Voici les nouveautés d'un dépôt git depuis la dernière visite de l'utilisateur :\n{items}\n\n\
         Rédige un DIGEST en {out_lang}, 2 à 4 lignes MAXIMUM, factuel et utile. Regroupe par thème \
         si pertinent (PRs, issues, tronc) et mets en avant ce qui demande une action (CI en échec, \
         review demandée, PR mergée). Réponds DIRECTEMENT par le digest — pas d'introduction, pas de \
         titres Markdown, pas de bloc de code — et N'EXPLORE PAS le dépôt."
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

pub(crate) fn push_allowed_tools(push: &mut impl FnMut(&str)) {
    for t in READONLY_TOOLS {
        push("--allowedTools");
        push(t);
    }
}

/// A `CommandBuilder` that runs `claude` pre-seeded with `prompt`, for use inside a PTY.
/// Spawned directly (no shell) so the multi-line prompt arg is passed intact.
pub fn pty_command(repo: &Path, prompt: &str) -> Result<portable_pty::CommandBuilder> {
    ensure_claude_available()?;
    let mut cmd = portable_pty::CommandBuilder::new(resolve_claude());
    for (k, v) in ai_env() {
        cmd.env(k, v);
    }
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

    #[test]
    fn validate_ollama_host_allows_local_and_blocks_ssrf() {
        // Empty falls back to the loopback default.
        assert_eq!(validate_ollama_host("").unwrap(), DEFAULT_OLLAMA_HOST);
        // Loopback, LAN and public hosts are allowed (trailing slash trimmed).
        assert_eq!(
            validate_ollama_host("http://localhost:11434/").unwrap(),
            "http://localhost:11434"
        );
        assert!(validate_ollama_host("http://192.168.1.50:11434").is_ok());
        assert!(validate_ollama_host("https://ollama.example.com").is_ok());
        // SSRF / cloud-metadata targets and bogus inputs are rejected.
        assert!(validate_ollama_host("http://169.254.169.254/latest/meta-data").is_err());
        assert!(validate_ollama_host("http://0.0.0.0:11434").is_err());
        assert!(validate_ollama_host("file:///etc/passwd").is_err());
        assert!(validate_ollama_host("ftp://example.com").is_err());
        assert!(validate_ollama_host("not a url").is_err());
    }

    #[test]
    fn lang_from_code_maps_known_and_falls_back_to_english() {
        assert_eq!(Lang::from_code("fr"), Lang::Fr);
        assert_eq!(Lang::from_code("ES"), Lang::Es);
        assert_eq!(Lang::from_code(" de "), Lang::De);
        assert_eq!(Lang::from_code("en"), Lang::En);
        // Unknown / empty codes fall back to English.
        assert_eq!(Lang::from_code("xx"), Lang::En);
        assert_eq!(Lang::from_code(""), Lang::En);
    }

    #[test]
    fn merge_prompt_adapts_to_stack_position() {
        // Bottom of the stack (base == trunk): mergeable now, no bottom-up warning.
        let bottom = merge_assist_prompt(7, "Ma feature", "feat/x", "main", "main", Lang::Fr);
        assert!(bottom.contains("#7"));
        assert!(bottom.contains("gh pr merge 7"));
        assert!(bottom.contains("BASE de la pile"));
        assert!(!bottom.contains("de bas en haut"));

        // Mid-stack (base is another branch): warn to merge the parent PR(s) first.
        let mid = merge_assist_prompt(7, "Ma feature", "feat/x", "feat/parent", "main", Lang::Fr);
        assert!(mid.contains("ATTENTION"));
        assert!(mid.contains("de bas en haut"));

        // English UI: same structure, English copy (and the placeholders still resolve).
        let en = merge_assist_prompt(7, "My feature", "feat/x", "main", "main", Lang::En);
        assert!(en.contains("gh pr merge 7"));
        assert!(en.contains("BOTTOM of the stack"));
    }

    #[test]
    fn branch_merge_prompt_names_both_branches_and_direction() {
        let p = branch_merge_prompt("feat/x", "main", "main", Lang::Fr);
        assert!(p.contains("`feat/x`"));
        assert!(p.contains("`main`"));
        // Direction: source merged into target, on the target branch.
        assert!(p.contains("git merge feat/x"));
        assert!(p.contains("git switch main"));
    }

    #[test]
    fn commit_message_prompt_enforces_prefix_and_mode() {
        let simple = commit_message_prompt("abc1234567", "simple", Lang::Fr);
        assert!(simple.contains("git show abc1234567"));
        assert!(simple.contains("feat:") && simple.contains("fix:") && simple.contains("update:"));
        assert!(simple.contains("5 MOTS MAXIMUM"));
        assert!(simple.contains("\"message\""));

        let complet = commit_message_prompt("abc1234567", "complet", Lang::Fr);
        assert!(complet.contains("COMPLET") && complet.contains("corps"));
    }

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
