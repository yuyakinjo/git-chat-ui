use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_REPOSITORIES: usize = 300;
const MIN_SCAN_DEPTH: usize = 1;
const MAX_SCAN_DEPTH: usize = 8;
#[cfg(target_os = "macos")]
const KEYCHAIN_ACCOUNT: &str = "git-chat-ui";
#[cfg(target_os = "macos")]
const KEYCHAIN_SERVICE_OPENAI: &str = "git-chat-ui.openai-token";
#[cfg(target_os = "macos")]
const KEYCHAIN_SERVICE_CLAUDE: &str = "git-chat-ui.claudecode-token";

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CommitGraphMode {
    Simple,
    Detailed,
}

impl Default for CommitGraphMode {
    fn default() -> Self {
        Self::Detailed
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentRepository {
    pub path: String,
    pub used_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub open_ai_token: String,
    pub claude_code_token: String,
    pub commit_graph_mode: CommitGraphMode,
    pub repository_scan_depth: usize,
    pub recently_used: Vec<RecentRepository>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            open_ai_token: String::new(),
            claude_code_token: String::new(),
            commit_graph_mode: CommitGraphMode::Detailed,
            repository_scan_depth: 4,
            recently_used: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Repository {
    pub name: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recently_used_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    pub name: String,
    pub full_ref: String,
    #[serde(rename = "type")]
    pub branch_type: String,
    pub commit: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchResponse {
    pub current: String,
    pub local: Vec<Branch>,
    pub remote: Vec<Branch>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitListItem {
    pub sha: String,
    pub parent_shas: Vec<String>,
    pub author: String,
    pub date: String,
    pub subject: String,
    pub decoration: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitsResponse {
    pub commits: Vec<CommitListItem>,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitFileStat {
    pub file: String,
    pub additions: i64,
    pub deletions: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetail {
    pub sha: String,
    pub parent_shas: Vec<String>,
    pub author: String,
    pub email: String,
    pub date: String,
    pub body: String,
    pub files: Vec<CommitFileStat>,
    pub diff: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkingFile {
    pub file: String,
    pub x: String,
    pub y: String,
    pub status_label: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkingTreeStatus {
    pub staged: Vec<WorkingFile>,
    pub unstaged: Vec<WorkingFile>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StashEntry {
    pub id: String,
    pub relative_date: String,
    pub message: String,
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoriesResponse {
    pub repositories: Vec<Repository>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OkResponse {
    pub ok: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FingerprintResponse {
    pub fingerprint: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TitleResponse {
    pub title: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct StashesResponse {
    pub stashes: Vec<StashEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveConfigResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config: Option<AppConfig>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SaveConfigInput {
    pub open_ai_token: Option<String>,
    pub claude_code_token: Option<String>,
    pub commit_graph_mode: Option<CommitGraphMode>,
    pub repository_scan_depth: Option<usize>,
}

fn config_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME is not set".to_string())?;
    Ok(Path::new(&home).join(".git-chat-ui"))
}

fn config_path() -> Result<PathBuf, String> {
    Ok(config_dir()?.join("config.json"))
}

#[cfg(target_os = "macos")]
fn keychain_get(service: &str) -> Option<String> {
    let output = Command::new("security")
        .args([
            "find-generic-password",
            "-a",
            KEYCHAIN_ACCOUNT,
            "-s",
            service,
            "-w",
        ])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

#[cfg(target_os = "macos")]
fn keychain_set(service: &str, value: &str) -> Result<(), String> {
    let status = Command::new("security")
        .args([
            "add-generic-password",
            "-a",
            KEYCHAIN_ACCOUNT,
            "-s",
            service,
            "-w",
            value,
            "-U",
        ])
        .status()
        .map_err(|error| format!("Failed to execute security command: {error}"))?;

    if status.success() {
        Ok(())
    } else {
        Err("Failed to write token to macOS Keychain.".to_string())
    }
}

#[cfg(target_os = "macos")]
fn keychain_delete(service: &str) {
    let _ = Command::new("security")
        .args([
            "delete-generic-password",
            "-a",
            KEYCHAIN_ACCOUNT,
            "-s",
            service,
        ])
        .status();
}

fn normalize_repository_scan_depth(value: usize) -> usize {
    value.clamp(MIN_SCAN_DEPTH, MAX_SCAN_DEPTH)
}

fn normalize_recently_used(value: Option<&Value>) -> Vec<RecentRepository> {
    let Some(Value::Array(items)) = value else {
        return Vec::new();
    };

    items
        .iter()
        .filter_map(|item| {
            let Value::Object(map) = item else {
                return None;
            };

            let path = map.get("path").and_then(Value::as_str)?;
            let used_at = map.get("usedAt").and_then(Value::as_str)?;

            Some(RecentRepository {
                path: path.to_string(),
                used_at: used_at.to_string(),
            })
        })
        .collect()
}

fn normalize_config_value(value: Value) -> AppConfig {
    let default = AppConfig::default();

    let open_ai_token = value
        .get("openAiToken")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    let claude_code_token = value
        .get("claudeCodeToken")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    let commit_graph_mode = match value.get("commitGraphMode").and_then(Value::as_str) {
        Some("simple") => CommitGraphMode::Simple,
        Some("detailed") => CommitGraphMode::Detailed,
        _ => default.commit_graph_mode,
    };

    let repository_scan_depth = match value.get("repositoryScanDepth") {
        Some(Value::Number(number)) => {
            let parsed = number
                .as_u64()
                .and_then(|depth| usize::try_from(depth).ok())
                .unwrap_or(default.repository_scan_depth);
            normalize_repository_scan_depth(parsed)
        }
        _ => default.repository_scan_depth,
    };

    let recently_used = normalize_recently_used(value.get("recentlyUsed"));

    AppConfig {
        open_ai_token,
        claude_code_token,
        commit_graph_mode,
        repository_scan_depth,
        recently_used,
    }
}

fn read_config() -> Result<AppConfig, String> {
    let path = config_path()?;
    let mut config = match fs::read_to_string(path) {
        Ok(content) => {
            let parsed = serde_json::from_str::<Value>(&content).unwrap_or(Value::Null);
            normalize_config_value(parsed)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => AppConfig::default(),
        Err(error) => return Err(format!("Failed to read config: {error}")),
    };

    #[cfg(target_os = "macos")]
    {
        if let Some(token) = keychain_get(KEYCHAIN_SERVICE_OPENAI) {
            config.open_ai_token = token;
        }

        if let Some(token) = keychain_get(KEYCHAIN_SERVICE_CLAUDE) {
            config.claude_code_token = token;
        }
    }

    Ok(config)
}

fn write_config(config: &AppConfig) -> Result<(), String> {
    let path = config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create config dir: {error}"))?;
    }

    let normalized = AppConfig {
        open_ai_token: config.open_ai_token.clone(),
        claude_code_token: config.claude_code_token.clone(),
        commit_graph_mode: config.commit_graph_mode,
        repository_scan_depth: normalize_repository_scan_depth(config.repository_scan_depth),
        recently_used: config.recently_used.clone(),
    };

    let mut persisted = normalized.clone();

    #[cfg(target_os = "macos")]
    {
        if normalized.open_ai_token.is_empty() {
            keychain_delete(KEYCHAIN_SERVICE_OPENAI);
            persisted.open_ai_token.clear();
        } else if keychain_set(KEYCHAIN_SERVICE_OPENAI, &normalized.open_ai_token).is_ok() {
            persisted.open_ai_token.clear();
        }

        if normalized.claude_code_token.is_empty() {
            keychain_delete(KEYCHAIN_SERVICE_CLAUDE);
            persisted.claude_code_token.clear();
        } else if keychain_set(KEYCHAIN_SERVICE_CLAUDE, &normalized.claude_code_token).is_ok() {
            persisted.claude_code_token.clear();
        }
    }

    let body = serde_json::to_string_pretty(&persisted)
        .map_err(|error| format!("Failed to serialize config: {error}"))?;

    fs::write(path, body).map_err(|error| format!("Failed to write config: {error}"))
}

fn current_timestamp() -> String {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_secs().to_string(),
        Err(_) => "0".to_string(),
    }
}

fn set_recently_used_repository(repo_path: &str) -> Result<(), String> {
    let mut config = read_config()?;
    config.recently_used.retain(|item| item.path != repo_path);
    config.recently_used.insert(
        0,
        RecentRepository {
            path: repo_path.to_string(),
            used_at: current_timestamp(),
        },
    );
    config.recently_used.truncate(30);

    write_config(&config)
}

fn run_git(args: &[&str], repo_path: &str) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo_path)
        .output()
        .map_err(|error| format!("Failed to execute git: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

        if !stderr.is_empty() {
            return Err(stderr);
        }

        if !stdout.is_empty() {
            return Err(stdout);
        }

        return Err("Failed to execute git command".to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout)
        .trim_end_matches(['\r', '\n'])
        .to_string())
}

fn run_git_owned(args: &[String], repo_path: &str) -> Result<String, String> {
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_git(&refs, repo_path)
}

fn hash_text_with_git(repo_path: &str, text: &str) -> String {
    let mut child = match Command::new("git")
        .args(["hash-object", "--stdin"])
        .current_dir(repo_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(_) => {
            let mut hasher = std::collections::hash_map::DefaultHasher::new();
            text.hash(&mut hasher);
            return format!("{:016x}", hasher.finish());
        }
    };

    if let Some(stdin) = child.stdin.as_mut() {
        let _ = stdin.write_all(text.as_bytes());
    }

    if let Ok(output) = child.wait_with_output() {
        if output.status.success() {
            let hashed = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !hashed.is_empty() {
                return hashed;
            }
        }
    }

    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    text.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn ensure_repo_path(repo_path: &str) -> Result<(), String> {
    let path = Path::new(repo_path);

    if !path.is_absolute() {
        return Err("Repository path must be absolute.".to_string());
    }

    if !path.is_dir() {
        return Err("Repository path is not a directory.".to_string());
    }

    run_git(&["rev-parse", "--is-inside-work-tree"], repo_path)?;

    Ok(())
}

fn status_label(code: &str) -> String {
    match code {
        "M" => "Modified",
        "A" => "Added",
        "D" => "Deleted",
        "R" => "Renamed",
        "C" => "Copied",
        "U" => "Updated",
        "?" => "Untracked",
        _ => "Changed",
    }
    .to_string()
}

fn should_skip_dir(home: &Path, current: &Path, dir_name: &str) -> bool {
    if dir_name.starts_with('.') && dir_name != ".config" {
        return true;
    }

    let skip_name = matches!(
        dir_name,
        ".git" | ".Trash" | ".cache" | ".npm" | ".yarn" | "Library" | "node_modules"
    );
    if skip_name {
        return true;
    }

    if let Ok(relative) = current.strip_prefix(home) {
        let relative_str = relative.to_string_lossy();
        if relative_str.starts_with("Library") {
            return true;
        }
    }

    false
}

fn walk_repositories(
    home: &Path,
    current_path: &Path,
    depth: usize,
    max_depth: usize,
    query: &Option<String>,
    discovered: &mut Vec<Repository>,
    seen: &mut HashSet<String>,
) {
    if depth > max_depth || discovered.len() >= MAX_REPOSITORIES {
        return;
    }

    let entries = match fs::read_dir(current_path) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    let mut children: Vec<fs::DirEntry> = Vec::new();
    let mut has_git_directory = false;

    for entry in entries.flatten() {
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };

        if file_type.is_dir() && entry.file_name().to_string_lossy() == ".git" {
            has_git_directory = true;
        }

        children.push(entry);
    }

    if has_git_directory {
        let name = current_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("")
            .to_string();

        let path = current_path.to_string_lossy().to_string();

        let query_match = query
            .as_ref()
            .map(|query| name.to_lowercase().contains(query))
            .unwrap_or(true);

        if query_match && !seen.contains(&path) {
            discovered.push(Repository {
                name,
                path: path.clone(),
                recently_used_at: None,
            });
            seen.insert(path);
        }

        return;
    }

    for child in children {
        if discovered.len() >= MAX_REPOSITORIES {
            return;
        }

        let file_type = match child.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };

        if !file_type.is_dir() || file_type.is_symlink() {
            continue;
        }

        let dir_name = child.file_name().to_string_lossy().to_string();
        let next_path = child.path();

        if should_skip_dir(home, &next_path, &dir_name) {
            continue;
        }

        walk_repositories(
            home,
            &next_path,
            depth + 1,
            max_depth,
            query,
            discovered,
            seen,
        );
    }
}

fn discover_repositories(
    query: Option<String>,
    recent_map: HashMap<String, String>,
    max_depth: usize,
) -> Result<Vec<Repository>, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME is not set".to_string())?;
    let home_path = PathBuf::from(home);

    let normalized_query = query
        .map(|query| query.trim().to_lowercase())
        .filter(|query| !query.is_empty());

    let mut discovered = Vec::new();
    let mut seen = HashSet::new();

    walk_repositories(
        &home_path,
        &home_path,
        0,
        normalize_repository_scan_depth(max_depth),
        &normalized_query,
        &mut discovered,
        &mut seen,
    );

    discovered.iter_mut().for_each(|repo| {
        repo.recently_used_at = recent_map.get(&repo.path).cloned();
    });

    discovered.sort_by(
        |left, right| match (&left.recently_used_at, &right.recently_used_at) {
            (Some(left_recent), Some(right_recent)) => right_recent.cmp(left_recent),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => left.name.cmp(&right.name),
        },
    );

    Ok(discovered)
}

fn get_current_branch(repo_path: &str) -> Result<String, String> {
    ensure_repo_path(repo_path)?;
    run_git(&["rev-parse", "--abbrev-ref", "HEAD"], repo_path)
}

fn get_diff_snippet(repo_path: &str, files: &[String]) -> Result<String, String> {
    ensure_repo_path(repo_path)?;

    if files.is_empty() {
        return Ok(String::new());
    }

    let mut unstaged_args = vec!["diff".to_string(), "--".to_string()];
    unstaged_args.extend(files.iter().cloned());
    let unstaged = run_git_owned(&unstaged_args, repo_path).unwrap_or_default();

    let mut staged_args = vec!["diff".to_string(), "--cached".to_string(), "--".to_string()];
    staged_args.extend(files.iter().cloned());
    let staged = run_git_owned(&staged_args, repo_path).unwrap_or_default();

    let combined = format!("{unstaged}\n{staged}");

    Ok(combined.chars().take(4000).collect())
}

fn build_heuristic_title(changed_files: &[String]) -> String {
    if changed_files.is_empty() {
        return "Update repository state".to_string();
    }

    let unique_roots: HashSet<String> = changed_files
        .iter()
        .map(|file| file.split('/').next().unwrap_or(file).to_string())
        .collect();

    if unique_roots.len() == 1 {
        if let Some(root) = unique_roots.iter().next() {
            return format!("Update {root}");
        }
    }

    if changed_files.len() == 1 {
        return format!("Update {}", changed_files[0]);
    }

    format!("Refine {} files", changed_files.len())
}

fn normalize_title(raw_title: &str, fallback: &str) -> String {
    let trimmed = raw_title
        .replace(['\r', '\n'], " ")
        .trim_matches(|character| character == '"' || character == '\'' || character == '`')
        .trim()
        .to_string();

    let selected = if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed
    };

    selected.chars().take(72).collect()
}

fn run_curl_json(url: &str, headers: &[String], payload: Value) -> Option<Value> {
    let payload_text = serde_json::to_string(&payload).ok()?;
    let mut command = Command::new("curl");

    command.args(["-sS", "-f", "-m", "9", url]);

    for header in headers {
        command.arg("-H");
        command.arg(header);
    }

    command.arg("-d");
    command.arg(payload_text);

    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    serde_json::from_str::<Value>(&stdout).ok()
}

fn generate_with_openai(
    token: &str,
    changed_files: &[String],
    diff_snippet: &str,
) -> Option<String> {
    if token.trim().is_empty() {
        return None;
    }

    let prompt = format!(
        "Changed files:\n{}\n\nDiff snippet:\n{}",
        changed_files.join("\n"),
        diff_snippet
    );

    let json = run_curl_json(
        "https://api.openai.com/v1/responses",
        &[
            format!("Authorization: Bearer {token}"),
            "Content-Type: application/json".to_string(),
        ],
        json!({
            "model": "gpt-4.1-mini",
            "temperature": 0.2,
            "input": [
                {
                    "role": "system",
                    "content": "You are a Git assistant. Return only a concise commit title in imperative mood, max 72 chars."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ]
        }),
    )?;

    if let Some(text) = json.get("output_text").and_then(Value::as_str) {
        if !text.trim().is_empty() {
            return Some(text.to_string());
        }
    }

    json.get("output")
        .and_then(Value::as_array)
        .and_then(|output| output.first())
        .and_then(|first| first.get("content"))
        .and_then(Value::as_array)
        .and_then(|content| content.first())
        .and_then(|item| item.get("text"))
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn generate_with_claude(
    token: &str,
    changed_files: &[String],
    diff_snippet: &str,
) -> Option<String> {
    if token.trim().is_empty() {
        return None;
    }

    let prompt = format!(
        "Changed files:\n{}\n\nDiff snippet:\n{}",
        changed_files.join("\n"),
        diff_snippet
    );

    let json = run_curl_json(
        "https://api.anthropic.com/v1/messages",
        &[
            format!("x-api-key: {token}"),
            "anthropic-version: 2023-06-01".to_string(),
            "content-type: application/json".to_string(),
        ],
        json!({
            "model": "claude-3-5-haiku-latest",
            "max_tokens": 80,
            "system": "You are a Git assistant. Return only a concise commit title in imperative mood, max 72 chars.",
            "messages": [
                {
                    "role": "user",
                    "content": prompt
                }
            ]
        }),
    )?;

    json.get("content")
        .and_then(Value::as_array)
        .and_then(|content| {
            content.iter().find_map(|item| {
                let is_text = item
                    .get("type")
                    .and_then(Value::as_str)
                    .map(|kind| kind == "text")
                    .unwrap_or(false);

                if is_text {
                    item.get("text")
                        .and_then(Value::as_str)
                        .map(ToString::to_string)
                } else {
                    None
                }
            })
        })
}

fn generate_commit_title_internal(
    config: &AppConfig,
    changed_files: &[String],
    diff_snippet: &str,
) -> String {
    let fallback = build_heuristic_title(changed_files);
    let limited_diff: String = diff_snippet.chars().take(4000).collect();

    if let Some(open_ai_title) =
        generate_with_openai(&config.open_ai_token, changed_files, &limited_diff)
    {
        return normalize_title(&open_ai_title, &fallback);
    }

    if let Some(claude_title) =
        generate_with_claude(&config.claude_code_token, changed_files, &limited_diff)
    {
        return normalize_title(&claude_title, &fallback);
    }

    normalize_title(&fallback, "Update repository state")
}

#[tauri::command]
pub fn health() -> Result<OkResponse, String> {
    Ok(OkResponse { ok: true })
}

#[tauri::command]
pub fn get_repositories(query: Option<String>) -> Result<RepositoriesResponse, String> {
    let config = read_config()?;
    let recent_map: HashMap<String, String> = config
        .recently_used
        .iter()
        .map(|item| (item.path.clone(), item.used_at.clone()))
        .collect();

    let repositories = discover_repositories(query, recent_map, config.repository_scan_depth)?;

    Ok(RepositoriesResponse { repositories })
}

#[tauri::command]
pub fn mark_recent_repository(repo_path: String) -> Result<OkResponse, String> {
    if repo_path.trim().is_empty() {
        return Err("repoPath is required.".to_string());
    }

    set_recently_used_repository(&repo_path)?;

    Ok(OkResponse { ok: true })
}

#[tauri::command]
pub fn get_branches(repo_path: String) -> Result<BranchResponse, String> {
    ensure_repo_path(&repo_path)?;

    let refs = run_git(
        &[
            "for-each-ref",
            "--format=%(refname)|%(refname:short)|%(objectname)",
            "refs/heads",
            "refs/remotes",
        ],
        &repo_path,
    )?;

    let mut local = Vec::new();
    let mut remote = Vec::new();

    for line in refs.lines() {
        if line.trim().is_empty() {
            continue;
        }

        let parts: Vec<&str> = line.split('|').collect();
        if parts.len() != 3 {
            continue;
        }

        let full_ref = parts[0].to_string();
        let name = parts[1].to_string();
        let commit = parts[2].to_string();

        if full_ref.starts_with("refs/heads/") {
            local.push(Branch {
                name,
                full_ref,
                branch_type: "local".to_string(),
                commit,
            });
            continue;
        }

        if name.ends_with("/HEAD") {
            continue;
        }

        remote.push(Branch {
            name,
            full_ref,
            branch_type: "remote".to_string(),
            commit,
        });
    }

    let current = get_current_branch(&repo_path)?;

    Ok(BranchResponse {
        current,
        local,
        remote,
    })
}

#[tauri::command]
pub fn get_commits(
    repo_path: String,
    ref_name: Option<String>,
    compare_refs: Option<Vec<String>>,
    offset: usize,
    limit: usize,
) -> Result<CommitsResponse, String> {
    ensure_repo_path(&repo_path)?;

    let selected_ref = ref_name
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "HEAD".to_string());
    let mut compare_refs = compare_refs
        .unwrap_or_default()
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty() && value != &selected_ref)
        .collect::<Vec<String>>();
    {
        let mut seen = HashSet::new();
        compare_refs.retain(|value| seen.insert(value.clone()));
    }

    let bounded_limit = limit.clamp(1, 100);

    let mut args = vec![
        "log".to_string(),
        "--decorate=short".to_string(),
        "--topo-order".to_string(),
        "--date=iso-strict".to_string(),
        format!("--skip={offset}"),
        "-n".to_string(),
        bounded_limit.to_string(),
        "--pretty=format:%H%x1f%P%x1f%an%x1f%ad%x1f%s%x1f%d%x1e".to_string(),
        selected_ref,
    ];
    for compare_ref in compare_refs {
        args.push(compare_ref);
    }
    args.push("--".to_string());

    let output = run_git_owned(&args, &repo_path)?;

    let commits: Vec<CommitListItem> = output
        .split('\u{001e}')
        .filter(|record| !record.trim().is_empty())
        .filter_map(|record| {
            let parts: Vec<&str> = record.split('\u{001f}').collect();
            if parts.len() < 6 {
                return None;
            }

            let sha = parts[0].trim();
            if sha.is_empty() {
                return None;
            }

            let parent_shas = if parts[1].trim().is_empty() {
                Vec::new()
            } else {
                parts[1]
                    .split(' ')
                    .filter(|value| !value.is_empty())
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty())
                    .collect()
            };

            Some(CommitListItem {
                sha: sha.to_string(),
                parent_shas,
                author: parts[2].trim().to_string(),
                date: parts[3].trim().to_string(),
                subject: parts[4].trim().to_string(),
                decoration: parts[5].trim().to_string(),
            })
        })
        .collect();

    Ok(CommitsResponse {
        has_more: commits.len() == bounded_limit,
        commits,
    })
}

#[tauri::command]
pub fn get_commit_detail(repo_path: String, sha: String) -> Result<CommitDetail, String> {
    ensure_repo_path(&repo_path)?;

    if sha.trim().is_empty() {
        return Err("sha is required.".to_string());
    }

    let meta = run_git(
        &[
            "show",
            "-s",
            "--date=iso-strict",
            "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%ad%x1f%B",
            &sha,
        ],
        &repo_path,
    )?;

    let meta_parts: Vec<&str> = meta.split('\u{001f}').collect();
    if meta_parts.len() < 6 {
        return Err("Failed to parse commit metadata.".to_string());
    }

    let file_stats_raw = run_git(&["show", "--pretty=format:", "--numstat", &sha], &repo_path)?;

    let files: Vec<CommitFileStat> = file_stats_raw
        .lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() != 3 {
                return None;
            }

            let additions = parts[0].parse::<i64>().unwrap_or(0);
            let deletions = parts[1].parse::<i64>().unwrap_or(0);

            Some(CommitFileStat {
                file: parts[2].to_string(),
                additions,
                deletions,
            })
        })
        .collect();

    let diff = run_git(&["show", "--pretty=format:", &sha], &repo_path)?;

    let parent_shas = if meta_parts[1].trim().is_empty() {
        Vec::new()
    } else {
        meta_parts[1]
            .split(' ')
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
            .collect()
    };

    Ok(CommitDetail {
        sha: meta_parts[0].to_string(),
        parent_shas,
        author: meta_parts[2].to_string(),
        email: meta_parts[3].to_string(),
        date: meta_parts[4].to_string(),
        body: meta_parts[5].to_string(),
        files,
        diff: diff.chars().take(25_000).collect(),
    })
}

#[tauri::command]
pub fn get_working_tree_status(repo_path: String) -> Result<WorkingTreeStatus, String> {
    ensure_repo_path(&repo_path)?;

    let status = run_git(&["status", "--porcelain=v1", "-uall"], &repo_path)?;

    let mut staged = Vec::new();
    let mut unstaged = Vec::new();

    for line in status.lines() {
        if line.trim().is_empty() {
            continue;
        }

        let x = line.chars().nth(0).unwrap_or(' ');
        let y = line.chars().nth(1).unwrap_or(' ');

        let raw_path = line.chars().skip(3).collect::<String>().trim().to_string();
        let file = raw_path
            .split(" -> ")
            .last()
            .unwrap_or(raw_path.as_str())
            .to_string();

        let code = if x != ' ' && x != '?' { x } else { y };
        let label = status_label(&code.to_string());

        if x != ' ' && x != '?' {
            staged.push(WorkingFile {
                file: file.clone(),
                x: x.to_string(),
                y: y.to_string(),
                status_label: label.clone(),
            });
        }

        if y != ' ' || x == '?' {
            unstaged.push(WorkingFile {
                file,
                x: x.to_string(),
                y: y.to_string(),
                status_label: label,
            });
        }
    }

    Ok(WorkingTreeStatus { staged, unstaged })
}

#[tauri::command]
pub fn stage_file(repo_path: String, file: String) -> Result<OkResponse, String> {
    ensure_repo_path(&repo_path)?;

    if file.trim().is_empty() {
        return Err("file is required.".to_string());
    }

    run_git(&["add", "--", &file], &repo_path)?;
    Ok(OkResponse { ok: true })
}

#[tauri::command]
pub fn unstage_file(repo_path: String, file: String) -> Result<OkResponse, String> {
    ensure_repo_path(&repo_path)?;

    if file.trim().is_empty() {
        return Err("file is required.".to_string());
    }

    if run_git(&["restore", "--staged", "--", &file], &repo_path).is_err() {
        run_git(&["reset", "HEAD", "--", &file], &repo_path)?;
    }

    Ok(OkResponse { ok: true })
}

#[tauri::command]
pub fn stash_file(repo_path: String, file: String) -> Result<OkResponse, String> {
    ensure_repo_path(&repo_path)?;

    if file.trim().is_empty() {
        return Err("file is required.".to_string());
    }

    let message = format!("git-chat-ui: {file}");
    run_git(&["stash", "push", "-m", &message, "--", &file], &repo_path)?;

    Ok(OkResponse { ok: true })
}

#[tauri::command]
pub fn get_stashes(repo_path: String) -> Result<StashesResponse, String> {
    ensure_repo_path(&repo_path)?;

    let output = run_git(&["stash", "list", "--format=%gd%x1f%cr%x1f%s"], &repo_path)?;

    let mut stashes: Vec<StashEntry> = output
        .lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.split('\u{001f}').collect();
            if parts.len() != 3 {
                return None;
            }

            Some(StashEntry {
                id: parts[0].to_string(),
                relative_date: parts[1].to_string(),
                message: parts[2].to_string(),
                files: Vec::new(),
            })
        })
        .collect();

    for stash in &mut stashes {
        let files_output = run_git(
            &[
                "stash",
                "show",
                "--name-only",
                "--format=",
                stash.id.as_str(),
            ],
            &repo_path,
        )
        .unwrap_or_default();

        stash.files = files_output
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(ToString::to_string)
            .collect();
    }

    Ok(StashesResponse { stashes })
}

#[tauri::command]
pub fn checkout(repo_path: String, reference: String) -> Result<OkResponse, String> {
    ensure_repo_path(&repo_path)?;

    if reference.trim().is_empty() {
        return Err("ref is required.".to_string());
    }

    run_git(&["checkout", &reference], &repo_path)?;

    Ok(OkResponse { ok: true })
}

#[tauri::command]
pub fn commit(repo_path: String, title: String, description: String) -> Result<OkResponse, String> {
    ensure_repo_path(&repo_path)?;

    if title.trim().is_empty() {
        return Err("Commit title is required.".to_string());
    }

    if description.trim().is_empty() {
        run_git(&["commit", "-m", title.trim()], &repo_path)?;
    } else {
        run_git(
            &["commit", "-m", title.trim(), "-m", description.trim()],
            &repo_path,
        )?;
    }

    Ok(OkResponse { ok: true })
}

#[tauri::command]
pub fn push(repo_path: String) -> Result<OkResponse, String> {
    ensure_repo_path(&repo_path)?;

    run_git(&["push"], &repo_path)?;

    Ok(OkResponse { ok: true })
}

#[tauri::command]
pub fn get_fingerprint(repo_path: String) -> Result<FingerprintResponse, String> {
    ensure_repo_path(&repo_path)?;

    let head = run_git(&["rev-parse", "HEAD"], &repo_path)?;
    let status = run_git(&["status", "--porcelain=v1"], &repo_path)?;

    Ok(FingerprintResponse {
        fingerprint: hash_text_with_git(&repo_path, &format!("{head}\n{status}")),
    })
}

#[tauri::command]
pub fn get_config() -> Result<AppConfig, String> {
    read_config()
}

#[tauri::command]
pub fn save_config(input: SaveConfigInput) -> Result<SaveConfigResponse, String> {
    let current = read_config()?;

    let next_config = AppConfig {
        open_ai_token: input.open_ai_token.unwrap_or(current.open_ai_token),
        claude_code_token: input.claude_code_token.unwrap_or(current.claude_code_token),
        commit_graph_mode: input.commit_graph_mode.unwrap_or(current.commit_graph_mode),
        repository_scan_depth: normalize_repository_scan_depth(
            input
                .repository_scan_depth
                .unwrap_or(current.repository_scan_depth),
        ),
        recently_used: current.recently_used,
    };

    write_config(&next_config)?;

    Ok(SaveConfigResponse {
        ok: true,
        config: Some(read_config()?),
    })
}

#[tauri::command]
pub fn generate_title(
    repo_path: String,
    changed_files: Vec<String>,
) -> Result<TitleResponse, String> {
    ensure_repo_path(&repo_path)?;

    let config = read_config()?;
    let diff_snippet = get_diff_snippet(&repo_path, &changed_files)?;
    let title = generate_commit_title_internal(&config, &changed_files, &diff_snippet);

    Ok(TitleResponse { title })
}
