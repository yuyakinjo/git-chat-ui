use git2::{
    build::CheckoutBuilder, Commit as GitCommit, Repository as GitRepository, Status, StatusOptions,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::hash::{Hash, Hasher};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const MAX_REPOSITORIES: usize = 300;
const MIN_SCAN_DEPTH: usize = 1;
const MAX_SCAN_DEPTH: usize = 8;
const MAIN_WINDOW_LABEL: &str = "main";
const MIN_WINDOW_WIDTH: u32 = 1200;
const MIN_WINDOW_HEIGHT: u32 = 760;
const WINDOW_STATE_PERSIST_DEBOUNCE: Duration = Duration::from_millis(300);
const ANTHROPIC_API_VERSION: &str = "2023-06-01";
const DEFAULT_OPENAI_MODEL: &str = "gpt-4.1-mini";
const DEFAULT_COMMIT_TITLE_PROMPT: &str = concat!(
    "You are a Git assistant. Write a Git commit message from the provided staged changes.\n",
    "Requirements:\n",
    "- The first line must be an Angular-style conventional commit title such as feat:, fix:, docs:, style:, refactor:, perf:, test:, build:, ci:, chore:, or revert:. Use an optional scope when it adds clarity.\n",
    "- Keep the title in imperative mood. The title line must be 72 characters or fewer including prefix, scope, spaces, and punctuation.\n",
    "- If the title would exceed 72 characters, rewrite it shorter. Do not continue the overflow on the next line or in the description.\n",
    "- After the title, insert a blank line and always include a short description of the key changes.\n",
    "- Prefer 1-3 concise bullet points for the description. The first line becomes the title and the rest becomes the description.\n",
    "- Do not add labels like Title: or Description:, and do not wrap the response in quotes or code fences.\n",
    "- Do not omit the description, even for small changes."
);
#[cfg(target_os = "macos")]
const KEYCHAIN_ACCOUNT: &str = "git-chat-ui";
#[cfg(target_os = "macos")]
const KEYCHAIN_SERVICE_OPENAI: &str = "git-chat-ui.openai-token";
#[cfg(target_os = "macos")]
const KEYCHAIN_SERVICE_CLAUDE: &str = "git-chat-ui.claudecode-token";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AiProvider {
    OpenAi,
    ClaudeCode,
}

impl Default for AiProvider {
    fn default() -> Self {
        Self::OpenAi
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
    pub open_ai_model: String,
    pub claude_code_token: String,
    pub selected_ai_provider: AiProvider,
    pub commit_title_prompt: String,
    pub commit_graph_mode: CommitGraphMode,
    pub repository_scan_depth: usize,
    pub recently_used: Vec<RecentRepository>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window_state: Option<WindowState>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WindowState {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub is_maximized: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            open_ai_token: String::new(),
            open_ai_model: DEFAULT_OPENAI_MODEL.to_string(),
            claude_code_token: String::new(),
            selected_ai_provider: AiProvider::OpenAi,
            commit_title_prompt: String::new(),
            commit_graph_mode: CommitGraphMode::Detailed,
            repository_scan_depth: 4,
            recently_used: Vec::new(),
            window_state: None,
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
pub struct BranchDiffDetail {
    pub base_ref: String,
    pub target_ref: String,
    pub merge_base_sha: String,
    pub files: Vec<CommitFileStat>,
    pub diff: String,
    pub is_diff_truncated: bool,
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
pub struct WorkingTreeDiffDetail {
    pub file: String,
    pub area: String,
    pub files: Vec<CommitFileStat>,
    pub diff: String,
    pub is_diff_truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StashEntry {
    pub id: String,
    pub relative_date: String,
    pub message: String,
    pub files: Vec<String>,
}

#[derive(Debug, Clone)]
struct StashReflogEntryRecord {
    new_oid: String,
    committer_name: String,
    committer_email: String,
    timestamp: String,
    timezone: String,
    message: String,
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
#[serde(rename_all = "camelCase")]
pub struct RepositoryGithubUrlResponse {
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryMutationSafetyResponse {
    pub is_self_repository: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TitleResponse {
    pub title: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct StashesResponse {
    pub stashes: Vec<StashEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestPreparationResponse {
    pub push_required: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct PullRequestResponse {
    pub url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveConfigResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config: Option<AppConfig>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TokenValidationResult {
    pub valid: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct OpenAiModelsResponse {
    pub models: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SaveConfigInput {
    pub open_ai_token: Option<String>,
    pub open_ai_model: Option<String>,
    pub claude_code_token: Option<String>,
    pub selected_ai_provider: Option<AiProvider>,
    pub commit_title_prompt: Option<String>,
    pub commit_graph_mode: Option<CommitGraphMode>,
    pub repository_scan_depth: Option<usize>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NativeWindowTheme {
    Light,
    Dark,
}

fn map_native_window_theme(theme: NativeWindowTheme) -> tauri::Theme {
    match theme {
        NativeWindowTheme::Light => tauri::Theme::Light,
        NativeWindowTheme::Dark => tauri::Theme::Dark,
    }
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

fn normalize_selected_ai_provider(value: Option<&Value>) -> AiProvider {
    match value.and_then(Value::as_str) {
        Some("claudeCode") => AiProvider::ClaudeCode,
        Some("openAi") => AiProvider::OpenAi,
        _ => AiProvider::default(),
    }
}

fn normalize_open_ai_model(value: Option<&Value>) -> String {
    let normalized = value
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();

    if normalized.is_empty() {
        DEFAULT_OPENAI_MODEL.to_string()
    } else {
        normalized.to_string()
    }
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

fn normalize_window_state(value: Option<&Value>) -> Option<WindowState> {
    let Some(Value::Object(map)) = value else {
        return None;
    };

    let x = map
        .get("x")
        .and_then(Value::as_i64)
        .and_then(|value| i32::try_from(value).ok())?;
    let y = map
        .get("y")
        .and_then(Value::as_i64)
        .and_then(|value| i32::try_from(value).ok())?;
    let width = map
        .get("width")
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())?;
    let height = map
        .get("height")
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())?;
    let is_maximized = map
        .get("isMaximized")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    Some(WindowState {
        x,
        y,
        width: width.max(MIN_WINDOW_WIDTH),
        height: height.max(MIN_WINDOW_HEIGHT),
        is_maximized,
    })
}

fn normalize_config_value(value: Value) -> AppConfig {
    let default = AppConfig::default();

    let open_ai_token = value
        .get("openAiToken")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let open_ai_model = normalize_open_ai_model(value.get("openAiModel"));

    let claude_code_token = value
        .get("claudeCodeToken")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    let selected_ai_provider = normalize_selected_ai_provider(value.get("selectedAiProvider"));
    let commit_title_prompt = value
        .get("commitTitlePrompt")
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
    let window_state = normalize_window_state(value.get("windowState"));

    AppConfig {
        open_ai_token,
        open_ai_model,
        claude_code_token,
        selected_ai_provider,
        commit_title_prompt,
        commit_graph_mode,
        repository_scan_depth,
        recently_used,
        window_state,
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
        open_ai_model: normalize_open_ai_model(Some(&Value::String(config.open_ai_model.clone()))),
        claude_code_token: config.claude_code_token.clone(),
        selected_ai_provider: config.selected_ai_provider,
        commit_title_prompt: config.commit_title_prompt.clone(),
        commit_graph_mode: config.commit_graph_mode,
        repository_scan_depth: normalize_repository_scan_depth(config.repository_scan_depth),
        recently_used: config.recently_used.clone(),
        window_state: config.window_state.clone(),
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

fn capture_window_state(window: &tauri::WebviewWindow) -> Result<WindowState, String> {
    let position = window
        .outer_position()
        .map_err(|error| format!("Failed to read window position: {error}"))?;
    let size = window
        .inner_size()
        .map_err(|error| format!("Failed to read window size: {error}"))?;
    let is_maximized = window
        .is_maximized()
        .map_err(|error| format!("Failed to read window maximize state: {error}"))?;

    Ok(WindowState {
        x: position.x,
        y: position.y,
        width: size.width.max(MIN_WINDOW_WIDTH),
        height: size.height.max(MIN_WINDOW_HEIGHT),
        is_maximized,
    })
}

fn clamp_window_state_to_area(
    window_state: &WindowState,
    area: &tauri::PhysicalRect<i32, u32>,
) -> WindowState {
    let width = window_state
        .width
        .max(MIN_WINDOW_WIDTH)
        .min(area.size.width.max(MIN_WINDOW_WIDTH));
    let height = window_state
        .height
        .max(MIN_WINDOW_HEIGHT)
        .min(area.size.height.max(MIN_WINDOW_HEIGHT));
    let max_x = area
        .position
        .x
        .saturating_add(i32::try_from(area.size.width.saturating_sub(width)).unwrap_or(i32::MAX));
    let max_y = area
        .position
        .y
        .saturating_add(i32::try_from(area.size.height.saturating_sub(height)).unwrap_or(i32::MAX));

    WindowState {
        x: window_state
            .x
            .clamp(area.position.x, max_x.max(area.position.x)),
        y: window_state
            .y
            .clamp(area.position.y, max_y.max(area.position.y)),
        width,
        height,
        is_maximized: window_state.is_maximized,
    }
}

fn restore_window_state(
    window: &tauri::WebviewWindow,
    window_state: &WindowState,
) -> Result<(), String> {
    let center_x = f64::from(window_state.x) + (f64::from(window_state.width) / 2.0);
    let center_y = f64::from(window_state.y) + (f64::from(window_state.height) / 2.0);
    let restored = window
        .monitor_from_point(center_x, center_y)
        .ok()
        .flatten()
        .or_else(|| window.current_monitor().ok().flatten())
        .or_else(|| window.primary_monitor().ok().flatten())
        .map(|monitor| clamp_window_state_to_area(window_state, monitor.work_area()))
        .unwrap_or_else(|| WindowState {
            x: window_state.x,
            y: window_state.y,
            width: window_state.width.max(MIN_WINDOW_WIDTH),
            height: window_state.height.max(MIN_WINDOW_HEIGHT),
            is_maximized: window_state.is_maximized,
        });

    window
        .set_size(tauri::PhysicalSize::new(restored.width, restored.height))
        .map_err(|error| format!("Failed to restore window size: {error}"))?;
    window
        .set_position(tauri::PhysicalPosition::new(restored.x, restored.y))
        .map_err(|error| format!("Failed to restore window position: {error}"))?;

    if restored.is_maximized {
        window
            .maximize()
            .map_err(|error| format!("Failed to restore maximized state: {error}"))?;
    }

    Ok(())
}

fn persist_window_state_if_changed(
    window: &tauri::WebviewWindow,
    last_window_state: &Arc<Mutex<Option<WindowState>>>,
) -> Result<(), String> {
    let next_window_state = capture_window_state(window)?;
    let mut guard = last_window_state
        .lock()
        .map_err(|_| "Failed to lock window state cache.".to_string())?;

    if guard.as_ref() == Some(&next_window_state) {
        return Ok(());
    }

    let mut config = read_config()?;
    config.window_state = Some(next_window_state.clone());
    write_config(&config)?;
    *guard = Some(next_window_state);

    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DebouncedWindowStateCommand {
    Persist,
    Shutdown,
}

fn schedule_window_state_persist_on_main_thread(
    window: &tauri::WebviewWindow,
    last_window_state: &Arc<Mutex<Option<WindowState>>>,
) -> Result<(), String> {
    let persisted_window = window.clone();
    let cached_window_state = Arc::clone(last_window_state);

    window
        .run_on_main_thread(move || {
            if let Err(error) =
                persist_window_state_if_changed(&persisted_window, &cached_window_state)
            {
                eprintln!("failed to persist main window state: {error}");
            }
        })
        .map_err(|error| format!("Failed to schedule main window state persistence: {error}"))
}

fn spawn_window_state_persist_worker(
    window: tauri::WebviewWindow,
    last_window_state: Arc<Mutex<Option<WindowState>>>,
) -> mpsc::Sender<DebouncedWindowStateCommand> {
    let (sender, receiver) = mpsc::channel::<DebouncedWindowStateCommand>();

    thread::spawn(move || {
        while let Ok(command) = receiver.recv() {
            match command {
                DebouncedWindowStateCommand::Persist => loop {
                    match receiver.recv_timeout(WINDOW_STATE_PERSIST_DEBOUNCE) {
                        Ok(DebouncedWindowStateCommand::Persist) => continue,
                        Ok(DebouncedWindowStateCommand::Shutdown) => return,
                        Err(mpsc::RecvTimeoutError::Timeout) => {
                            if let Err(error) = schedule_window_state_persist_on_main_thread(
                                &window,
                                &last_window_state,
                            ) {
                                eprintln!(
                                    "failed to queue debounced main window state persistence: {error}"
                                );
                            }
                            break;
                        }
                        Err(mpsc::RecvTimeoutError::Disconnected) => return,
                    }
                },
                DebouncedWindowStateCommand::Shutdown => return,
            }
        }
    });

    sender
}

fn should_debounce_window_persist_event(event: &tauri::WindowEvent) -> bool {
    matches!(
        event,
        tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)
    )
}

fn should_immediately_persist_window_event(event: &tauri::WindowEvent) -> bool {
    matches!(
        event,
        tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
    )
}

pub fn setup_main_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != MAIN_WINDOW_LABEL {
        return Ok(());
    }

    let initial_window_state = read_config()?.window_state;

    if let Some(window_state) = initial_window_state.as_ref() {
        restore_window_state(window, window_state)?;
    }

    let persisted_window = window.clone();
    let last_window_state = Arc::new(Mutex::new(initial_window_state));
    let debounced_persist_sender =
        spawn_window_state_persist_worker(persisted_window.clone(), Arc::clone(&last_window_state));
    window.on_window_event(move |event| {
        if should_debounce_window_persist_event(event) {
            if let Err(error) = debounced_persist_sender.send(DebouncedWindowStateCommand::Persist)
            {
                eprintln!("failed to queue main window state persistence: {error}");
            }
            return;
        }

        if should_immediately_persist_window_event(event) {
            if let Err(error) =
                persist_window_state_if_changed(&persisted_window, &last_window_state)
            {
                eprintln!("failed to persist main window state: {error}");
            }

            if matches!(event, tauri::WindowEvent::Destroyed) {
                let _ = debounced_persist_sender.send(DebouncedWindowStateCommand::Shutdown);
            }
        }
    });

    Ok(())
}

fn map_git2_error(error: git2::Error) -> String {
    let message = error.message().trim();
    if message.is_empty() {
        "Git operation failed.".to_string()
    } else {
        message.to_string()
    }
}

fn open_repository(repo_path: &str) -> Result<GitRepository, String> {
    let path = Path::new(repo_path);

    if !path.is_absolute() {
        return Err("Repository path must be absolute.".to_string());
    }

    if !path.is_dir() {
        return Err("Repository path is not a directory.".to_string());
    }

    GitRepository::open(path).map_err(map_git2_error)
}

fn run_command(command: &str, args: &[&str], repo_path: &str) -> Result<String, String> {
    let output = Command::new(command)
        .args(args)
        .current_dir(repo_path)
        .output()
        .map_err(|error| format!("Failed to execute {command}: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

        if !stderr.is_empty() {
            return Err(stderr);
        }

        if !stdout.is_empty() {
            return Err(stdout);
        }

        return Err(format!("Failed to execute {command} command"));
    }

    Ok(String::from_utf8_lossy(&output.stdout)
        .trim_end_matches(['\r', '\n'])
        .to_string())
}

fn run_command_owned(command: &str, args: &[String], repo_path: &str) -> Result<String, String> {
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_command(command, &refs, repo_path)
}

fn run_command_owned_with_env(
    command: &str,
    args: &[String],
    repo_path: &str,
    envs: &[(&str, String)],
) -> Result<String, String> {
    let mut process = Command::new(command);
    process.args(args).current_dir(repo_path);

    for (key, value) in envs {
        process.env(key, value);
    }

    let output = process
        .output()
        .map_err(|error| format!("Failed to execute {command}: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

        if !stderr.is_empty() {
            return Err(stderr);
        }

        if !stdout.is_empty() {
            return Err(stdout);
        }

        return Err(format!("Failed to execute {command} command"));
    }

    Ok(String::from_utf8_lossy(&output.stdout)
        .trim_end_matches(['\r', '\n'])
        .to_string())
}

fn run_git(args: &[&str], repo_path: &str) -> Result<String, String> {
    run_command("git", args, repo_path)
}

fn run_git_owned(args: &[String], repo_path: &str) -> Result<String, String> {
    run_command_owned("git", args, repo_path)
}

fn run_git_owned_with_env(
    args: &[String],
    repo_path: &str,
    envs: &[(&str, String)],
) -> Result<String, String> {
    run_command_owned_with_env("git", args, repo_path, envs)
}

fn parse_stash_index(stash_id: &str) -> Result<usize, String> {
    let trimmed = stash_id.trim();
    let Some(body) = trimmed
        .strip_prefix("stash@{")
        .and_then(|value| value.strip_suffix('}'))
    else {
        return Err("stashId must be in the form stash@{n}.".to_string());
    };

    body.parse::<usize>()
        .map_err(|_| "stashId must be in the form stash@{n}.".to_string())
}

fn parse_stash_reflog_line(line: &str) -> Option<StashReflogEntryRecord> {
    let (metadata, message) = line.split_once('\t')?;
    let mut head_parts = metadata.splitn(3, ' ');
    let _old_oid = head_parts.next()?.to_string();
    let new_oid = head_parts.next()?.to_string();
    let remainder = head_parts.next()?;

    let timezone_separator = remainder.rfind(' ')?;
    let timezone = remainder[timezone_separator + 1..].to_string();
    let timestamp_and_ident = &remainder[..timezone_separator];
    let timestamp_separator = timestamp_and_ident.rfind(' ')?;
    let timestamp = timestamp_and_ident[timestamp_separator + 1..].to_string();
    let ident = &timestamp_and_ident[..timestamp_separator];
    let email_end = ident.rfind('>')?;
    let email_start = ident[..email_end].rfind('<')?;
    let committer_name = ident[..email_start].trim_end().to_string();
    let committer_email = ident[email_start + 1..email_end].to_string();

    Some(StashReflogEntryRecord {
        new_oid,
        committer_name,
        committer_email,
        timestamp,
        timezone,
        message: message.to_string(),
    })
}

fn resolve_git_path(repo_path: &str, git_path: &str) -> Result<PathBuf, String> {
    let resolved = run_git(&["rev-parse", "--git-path", git_path], repo_path)?;
    let path = PathBuf::from(&resolved);

    if path.is_absolute() {
        return Ok(path);
    }

    Ok(Path::new(repo_path).join(path))
}

fn clear_stash_ref(
    repo_path: &str,
    stash_log_path: &Path,
    current_top_oid: &str,
) -> Result<(), String> {
    let ref_exists = run_git(
        &["show-ref", "--verify", "--quiet", "refs/stash"],
        repo_path,
    )
    .is_ok();

    if ref_exists {
        let delete_with_old = run_git(
            &["update-ref", "-d", "refs/stash", current_top_oid],
            repo_path,
        );
        if delete_with_old.is_err() {
            run_git(&["update-ref", "-d", "refs/stash"], repo_path)?;
        }
    }

    match fs::remove_file(stash_log_path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }

    Ok(())
}

fn rebuild_stash_reflog(
    repo_path: &str,
    stash_log_path: &Path,
    entries: &[StashReflogEntryRecord],
) -> Result<(), String> {
    let current_top_oid = entries
        .last()
        .map(|entry| entry.new_oid.as_str())
        .unwrap_or_default();

    clear_stash_ref(repo_path, stash_log_path, current_top_oid)?;

    for (index, entry) in entries.iter().enumerate() {
        let mut args = vec![
            "update-ref".to_string(),
            "--create-reflog".to_string(),
            "-m".to_string(),
            entry.message.clone(),
            "refs/stash".to_string(),
            entry.new_oid.clone(),
        ];

        if let Some(previous) = index.checked_sub(1).and_then(|value| entries.get(value)) {
            args.push(previous.new_oid.clone());
        }

        let envs = vec![
            ("GIT_COMMITTER_NAME", entry.committer_name.clone()),
            ("GIT_COMMITTER_EMAIL", entry.committer_email.clone()),
            (
                "GIT_COMMITTER_DATE",
                format!("{} {}", entry.timestamp, entry.timezone),
            ),
        ];

        run_git_owned_with_env(&args, repo_path, &envs)?;
    }

    Ok(())
}

fn run_gh(args: &[&str], repo_path: &str) -> Result<String, String> {
    run_command("gh", args, repo_path)
}

fn open_external_url_with_system(url: &str) -> Result<(), String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
        return Err("Only http/https URLs can be opened.".to_string());
    }

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(trimmed);
        command
    };

    #[cfg(target_os = "linux")]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(trimmed);
        command
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("cmd");
        command.args(["/C", "start", "", trimmed]);
        command
    };

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    return Err("Opening external URLs is not supported on this platform.".to_string());

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Failed to open URL: {error}"))
}

fn run_gh_owned(args: &[String], repo_path: &str) -> Result<String, String> {
    run_command_owned("gh", args, repo_path)
}

fn hash_text(text: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    text.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn ensure_repo_path(repo_path: &str) -> Result<(), String> {
    open_repository(repo_path).map(|_| ())?;
    Ok(())
}

fn ensure_local_branch(repo_path: &str, branch_name: &str) -> Result<(), String> {
    if branch_name.trim().is_empty() {
        return Err("branchName is required.".to_string());
    }

    let reference = format!("refs/heads/{branch_name}");
    run_git(&["rev-parse", "--verify", reference.as_str()], repo_path).map(|_| ())
}

fn ensure_branch_pair(
    repo_path: &str,
    source_branch: &str,
    target_branch: &str,
) -> Result<(), String> {
    if source_branch.trim().is_empty() || target_branch.trim().is_empty() {
        return Err("sourceBranch and targetBranch are required.".to_string());
    }

    if source_branch == target_branch {
        return Err("sourceBranch and targetBranch must be different.".to_string());
    }

    ensure_local_branch(repo_path, source_branch)?;
    ensure_local_branch(repo_path, target_branch)?;

    Ok(())
}

fn validate_create_branch_input(
    repo_path: &str,
    base_branch: &str,
    new_branch: &str,
) -> Result<String, String> {
    ensure_repo_path(repo_path)?;
    ensure_local_branch(repo_path, base_branch)?;

    let normalized_new_branch = new_branch.trim();
    if normalized_new_branch.is_empty() {
        return Err("newBranch is required.".to_string());
    }

    if normalized_new_branch == base_branch {
        return Err("newBranch must be different from baseBranch.".to_string());
    }

    run_git(
        &["check-ref-format", "--branch", normalized_new_branch],
        repo_path,
    )?;

    if ensure_local_branch(repo_path, normalized_new_branch).is_ok() {
        return Err(format!(
            "Local branch '{normalized_new_branch}' already exists."
        ));
    }

    Ok(normalized_new_branch.to_string())
}

fn ensure_deletable_local_branch(repo_path: &str, branch_name: &str) -> Result<(), String> {
    ensure_repo_path(repo_path)?;
    ensure_local_branch(repo_path, branch_name)?;

    let current_branch = get_current_branch(repo_path)?;
    if current_branch == branch_name {
        return Err(format!(
            "Cannot delete branch '{branch_name}' checked out at '{repo_path}'"
        ));
    }

    Ok(())
}

fn parse_remote_branch_name(branch_name: &str) -> Result<(String, String), String> {
    let parts: Vec<&str> = branch_name
        .trim()
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect();

    let remote_name = parts
        .first()
        .ok_or_else(|| "branchName must include remote and branch name.".to_string())?;
    let remote_branch_name = parts[1..].join("/");

    if remote_branch_name.is_empty() {
        return Err("branchName must include remote and branch name.".to_string());
    }

    Ok(((*remote_name).to_string(), remote_branch_name))
}

fn get_local_default_branch_name(repo_path: &str) -> Result<Option<String>, String> {
    let branches = get_branches(repo_path.to_string())?;
    let candidate = branches
        .local
        .iter()
        .find(|branch| branch.name == "main")
        .or_else(|| branches.local.iter().find(|branch| branch.name == "master"))
        .or_else(|| {
            branches
                .local
                .iter()
                .find(|branch| branch.name == branches.current)
        })
        .or_else(|| branches.local.first());

    Ok(candidate.map(|branch| branch.name.clone()))
}

fn get_remote_default_branch_name(repo_path: &str, remote_name: &str) -> Option<String> {
    let remote_head_ref = format!("refs/remotes/{remote_name}/HEAD");
    if let Ok(reference) = run_git(
        &[
            "symbolic-ref",
            "--quiet",
            "--short",
            remote_head_ref.as_str(),
        ],
        repo_path,
    ) {
        let normalized = reference.trim();
        let prefix = format!("{remote_name}/");
        if normalized.starts_with(&prefix) {
            return Some(normalized[prefix.len()..].to_string());
        }
    }

    get_local_default_branch_name(repo_path).ok().flatten()
}

fn ensure_deletable_remote_branch(
    repo_path: &str,
    branch_name: &str,
) -> Result<(String, String), String> {
    ensure_repo_path(repo_path)?;
    let (remote_name, remote_branch_name) = parse_remote_branch_name(branch_name)?;
    let reference = format!("refs/remotes/{branch_name}");
    run_git(&["rev-parse", "--verify", reference.as_str()], repo_path)?;

    if let Some(default_branch_name) = get_remote_default_branch_name(repo_path, &remote_name) {
        if remote_branch_name == default_branch_name {
            return Err(format!(
                "Default branch '{default_branch_name}' on remote '{remote_name}' cannot be deleted."
            ));
        }
    }

    Ok((remote_name, remote_branch_name))
}

fn ensure_origin_remote(repo_path: &str) -> Result<(), String> {
    run_git(&["remote", "get-url", "origin"], repo_path).map(|_| ())
}

fn canonicalize_path_string(path: &Path) -> Option<String> {
    fs::canonicalize(path)
        .ok()
        .and_then(|value| value.to_str().map(ToString::to_string))
}

fn normalize_github_remote_url(remote_url: &str) -> Option<String> {
    let trimmed = remote_url.trim();
    if trimmed.is_empty() {
        return None;
    }

    fn normalize_repo_path(path: &str) -> Option<String> {
        let without_git = path.trim().trim_matches('/').trim_end_matches(".git");
        let mut segments = without_git.split('/').filter(|segment| !segment.is_empty());
        let owner = segments.next()?;
        let repo = segments.next()?;

        if segments.next().is_some() {
            return None;
        }

        Some(format!("{owner}/{repo}"))
    }

    if let Some(path) = trimmed.strip_prefix("git@github.com:") {
        return normalize_repo_path(path).map(|repo| format!("https://github.com/{repo}"));
    }

    for prefix in [
        "https://github.com/",
        "http://github.com/",
        "ssh://git@github.com/",
        "git://github.com/",
    ] {
        if let Some(path) = trimmed.strip_prefix(prefix) {
            return normalize_repo_path(path).map(|repo| format!("https://github.com/{repo}"));
        }
    }

    None
}

fn ensure_github_auth(repo_path: &str) -> Result<(), String> {
    run_gh(&["auth", "status", "-h", "github.com"], repo_path).map(|_| ())
}

fn get_branch_upstream(repo_path: &str, branch_name: &str) -> Option<String> {
    let upstream_ref = format!("{branch_name}@{{upstream}}");
    run_git(
        &["rev-parse", "--abbrev-ref", upstream_ref.as_str()],
        repo_path,
    )
    .ok()
    .filter(|value| !value.trim().is_empty())
}

fn is_push_required(repo_path: &str, branch_name: &str) -> Result<bool, String> {
    let Some(upstream) = get_branch_upstream(repo_path, branch_name) else {
        return Ok(true);
    };

    let range = format!("{upstream}..{branch_name}");
    let ahead = run_git(&["rev-list", "--count", range.as_str()], repo_path)?;
    let count = ahead.trim().parse::<usize>().unwrap_or(0);
    Ok(count > 0)
}

fn push_branch_to_origin(repo_path: &str, branch_name: &str) -> Result<(), String> {
    if get_branch_upstream(repo_path, branch_name).is_some() {
        run_git(&["push", "origin", branch_name], repo_path)?;
    } else {
        run_git(&["push", "-u", "origin", branch_name], repo_path)?;
    }

    Ok(())
}

fn find_existing_pull_request(
    repo_path: &str,
    source_branch: &str,
    target_branch: &str,
) -> Result<Option<String>, String> {
    let args = vec![
        "pr".to_string(),
        "list".to_string(),
        "--state".to_string(),
        "open".to_string(),
        "--head".to_string(),
        source_branch.to_string(),
        "--base".to_string(),
        target_branch.to_string(),
        "--json".to_string(),
        "url".to_string(),
    ];
    let output = run_gh_owned(&args, repo_path)?;

    if output.trim().is_empty() {
        return Ok(None);
    }

    let parsed = serde_json::from_str::<Value>(&output).unwrap_or(Value::Null);
    let url = parsed
        .as_array()
        .and_then(|items| items.first())
        .and_then(|item| item.get("url"))
        .and_then(Value::as_str)
        .map(ToString::to_string);

    Ok(url)
}

fn extract_url_from_text(text: &str) -> Option<String> {
    text.split_whitespace()
        .find(|token| token.starts_with("https://") || token.starts_with("http://"))
        .map(ToString::to_string)
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

fn parse_commit_file_stats(output: &str) -> Vec<CommitFileStat> {
    output
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
        .collect()
}

fn working_tree_diff_args(area: &str, subcommand: Option<&str>) -> Result<Vec<String>, String> {
    let mut args = vec!["diff".to_string()];

    match area {
        "staged" => args.push("--cached".to_string()),
        "unstaged" => {}
        _ => return Err("area must be staged or unstaged.".to_string()),
    }

    if let Some(value) = subcommand.filter(|value| !value.is_empty()) {
        args.push(value.to_string());
    }

    Ok(args)
}

fn resolve_working_tree_file_path(repo_path: &str, file: &str) -> Result<PathBuf, String> {
    let repo_root = fs::canonicalize(repo_path)
        .map_err(|error| format!("Failed to resolve repository path: {error}"))?;
    let resolved = fs::canonicalize(repo_root.join(file))
        .map_err(|error| format!("Failed to resolve file path: {error}"))?;

    if !resolved.starts_with(&repo_root) {
        return Err("file must stay within repository.".to_string());
    }

    Ok(resolved)
}

fn resolve_new_file_mode(mode: u32) -> &'static str {
    if mode & 0o111 != 0 {
        "100755"
    } else {
        "100644"
    }
}

fn normalize_text_file_content(content: &str) -> String {
    content.replace("\r\n", "\n").replace('\r', "\n")
}

fn split_text_lines(content: &str) -> (Vec<String>, bool) {
    if content.is_empty() {
        return (Vec::new(), false);
    }

    let normalized = normalize_text_file_content(content);
    let has_trailing_newline = normalized.ends_with('\n');
    let mut lines: Vec<String> = normalized.split('\n').map(ToString::to_string).collect();

    if has_trailing_newline {
        lines.pop();
    }

    (lines, has_trailing_newline)
}

fn build_untracked_text_diff(file: &str, content: &str, mode: &str) -> String {
    let (lines, has_trailing_newline) = split_text_lines(content);
    let mut output = vec![
        format!("diff --git a/{file} b/{file}"),
        format!("new file mode {mode}"),
        "--- /dev/null".to_string(),
        format!("+++ b/{file}"),
    ];

    if !lines.is_empty() {
        output.push(format!("@@ -0,0 +1,{} @@", lines.len()));
        for line in lines {
            output.push(format!("+{line}"));
        }

        if !has_trailing_newline {
            output.push("\\ No newline at end of file".to_string());
        }
    }

    output.join("\n")
}

fn list_untracked_files(repo_path: &str, files: &[String]) -> Result<HashSet<String>, String> {
    let normalized: Vec<String> = files
        .iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect();

    if normalized.is_empty() {
        return Ok(HashSet::new());
    }

    let mut args = vec![
        "ls-files".to_string(),
        "--others".to_string(),
        "--exclude-standard".to_string(),
        "--".to_string(),
    ];
    args.extend(normalized);

    let output = run_git_owned(&args, repo_path)?;

    Ok(output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToString::to_string)
        .collect())
}

fn build_untracked_file_diff_snapshot(
    repo_path: &str,
    file: &str,
) -> Result<(CommitFileStat, String), String> {
    let absolute_path = resolve_working_tree_file_path(repo_path, file)?;
    let metadata = fs::metadata(&absolute_path)
        .map_err(|error| format!("Failed to read file metadata: {error}"))?;
    let buffer =
        fs::read(&absolute_path).map_err(|error| format!("Failed to read file: {error}"))?;
    #[cfg(unix)]
    let file_mode = metadata.permissions().mode();
    #[cfg(not(unix))]
    let file_mode = 0o100644;
    let mode = resolve_new_file_mode(file_mode);

    if buffer.contains(&0) {
        return Ok((
            CommitFileStat {
                file: file.to_string(),
                additions: 0,
                deletions: 0,
            },
            [
                format!("diff --git a/{file} b/{file}"),
                format!("new file mode {mode}"),
                "--- /dev/null".to_string(),
                format!("+++ b/{file}"),
                format!("Binary files /dev/null and b/{file} differ"),
            ]
            .join("\n"),
        ));
    }

    let content = String::from_utf8_lossy(&buffer).to_string();
    let (lines, _) = split_text_lines(&content);

    Ok((
        CommitFileStat {
            file: file.to_string(),
            additions: lines.len() as i64,
            deletions: 0,
        },
        build_untracked_text_diff(file, &content, mode),
    ))
}

fn git_status_index_code(status: Status) -> char {
    if status.contains(Status::CONFLICTED) {
        'U'
    } else if status.contains(Status::INDEX_NEW) {
        'A'
    } else if status.contains(Status::INDEX_MODIFIED) {
        'M'
    } else if status.contains(Status::INDEX_DELETED) {
        'D'
    } else if status.contains(Status::INDEX_RENAMED) {
        'R'
    } else if status.contains(Status::INDEX_TYPECHANGE) {
        'T'
    } else {
        ' '
    }
}

fn git_status_worktree_code(status: Status) -> char {
    if status.contains(Status::CONFLICTED) {
        'U'
    } else if status.contains(Status::WT_NEW) {
        '?'
    } else if status.contains(Status::WT_MODIFIED) {
        'M'
    } else if status.contains(Status::WT_DELETED) {
        'D'
    } else if status.contains(Status::WT_RENAMED) {
        'R'
    } else if status.contains(Status::WT_TYPECHANGE) {
        'T'
    } else {
        ' '
    }
}

fn status_entry_path(entry: &git2::StatusEntry<'_>) -> Option<String> {
    entry.path().map(ToString::to_string)
}

fn build_status_options(include_untracked_dirs: bool) -> StatusOptions {
    let mut options = StatusOptions::new();
    options
        .include_untracked(true)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true);

    if include_untracked_dirs {
        options.recurse_untracked_dirs(true);
    }

    options
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
    let repository = open_repository(repo_path)?;

    let current = match repository.head() {
        Ok(head) => Ok(head
            .shorthand()
            .map(ToString::to_string)
            .unwrap_or_else(|| "HEAD".to_string())),
        Err(error) if error.code() == git2::ErrorCode::UnbornBranch => Ok("HEAD".to_string()),
        Err(error) => Err(map_git2_error(error)),
    };

    current
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

    selected
}

fn strip_label(value: &str, labels: &[&str]) -> String {
    let trimmed = value.trim();
    let lower = trimmed.to_lowercase();

    for label in labels {
        let prefix = format!("{label}:");
        if lower.starts_with(&prefix) {
            return trimmed[prefix.len()..].trim_start().to_string();
        }
    }

    trimmed.to_string()
}

fn trim_blank_lines(lines: Vec<String>) -> Vec<String> {
    let start = lines
        .iter()
        .position(|line| !line.trim().is_empty())
        .unwrap_or(lines.len());
    let end = lines
        .iter()
        .rposition(|line| !line.trim().is_empty())
        .map(|index| index + 1)
        .unwrap_or(start);

    lines
        .into_iter()
        .skip(start)
        .take(end.saturating_sub(start))
        .collect()
}

fn normalize_generated_commit_message(raw_message: &str, fallback_title: &str) -> TitleResponse {
    let normalized = raw_message.replace("\r\n", "\n").replace('\r', "\n");
    let normalized = normalized.trim().to_string();
    let fallback = normalize_title(fallback_title, "Update repository state");

    if normalized.is_empty() {
        return TitleResponse {
            title: fallback,
            description: String::new(),
        };
    }

    let mut fenced_lines = normalized
        .lines()
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    if fenced_lines
        .first()
        .map(|line| line.trim_start().starts_with("```"))
        .unwrap_or(false)
    {
        fenced_lines.remove(0);
    }
    if fenced_lines
        .last()
        .map(|line| line.trim_start().starts_with("```"))
        .unwrap_or(false)
    {
        fenced_lines.pop();
    }

    let lines = trim_blank_lines(fenced_lines);
    if lines.is_empty() {
        return TitleResponse {
            title: fallback,
            description: String::new(),
        };
    }

    let raw_title_line = strip_label(
        lines[0]
            .trim_matches(|character| character == '"' || character == '\'' || character == '`'),
        &["title", "summary", "subject"],
    );
    let title = normalize_title(&raw_title_line, &fallback);
    let mut description_lines = lines.into_iter().skip(1).collect::<Vec<_>>();

    if let Some(first_description_line) = description_lines
        .iter()
        .position(|line| !line.trim().is_empty())
    {
        description_lines[first_description_line] = strip_label(
            &description_lines[first_description_line],
            &["description", "body"],
        );
    }

    TitleResponse {
        title,
        description: trim_blank_lines(description_lines).join("\n"),
    }
}

fn resolve_commit_title_prompt(prompt: &str) -> String {
    let normalized = prompt.trim();
    if normalized.is_empty() {
        DEFAULT_COMMIT_TITLE_PROMPT.to_string()
    } else {
        normalized.to_string()
    }
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

fn run_curl_get_json(url: &str, headers: &[String]) -> Option<Value> {
    let mut command = Command::new("curl");
    command.args(["-sS", "-f", "-m", "9", "-X", "GET", url]);

    for header in headers {
        command.arg("-H");
        command.arg(header);
    }

    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    serde_json::from_str::<Value>(&stdout).ok()
}

fn run_curl_success(url: &str, headers: &[String]) -> bool {
    let mut command = Command::new("curl");
    command.args(["-sS", "-f", "-m", "9", "-X", "GET", url]);

    for header in headers {
        command.arg("-H");
        command.arg(header);
    }

    command
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn is_anthropic_api_key(token: &str) -> bool {
    token.starts_with("sk-ant")
}

fn get_claude_auth_header_variants(token: &str) -> Vec<Vec<String>> {
    let normalized = token.trim();
    if normalized.is_empty() {
        return Vec::new();
    }

    let api_key_headers = vec![format!("x-api-key: {normalized}")];
    let bearer_headers = vec![format!("Authorization: Bearer {normalized}")];

    if is_anthropic_api_key(normalized) {
        vec![api_key_headers, bearer_headers]
    } else {
        vec![bearer_headers, api_key_headers]
    }
}

fn validate_openai_token_internal(token: &str) -> bool {
    let normalized = token.trim();
    if normalized.is_empty() {
        return false;
    }

    run_curl_success(
        "https://api.openai.com/v1/models",
        &[format!("Authorization: Bearer {normalized}")],
    )
}

fn resolve_open_ai_model(model: &str) -> String {
    let normalized = model.trim();
    if normalized.is_empty() {
        DEFAULT_OPENAI_MODEL.to_string()
    } else {
        normalized.to_string()
    }
}

fn sort_open_ai_model_ids(model_ids: Vec<String>) -> Vec<String> {
    let mut deduped = Vec::<String>::new();

    for model_id in model_ids {
        let normalized = model_id.trim();
        if normalized.is_empty() {
            continue;
        }

        if !deduped.iter().any(|existing| existing == normalized) {
            deduped.push(normalized.to_string());
        }
    }

    deduped.sort_by(|left, right| {
        if left == DEFAULT_OPENAI_MODEL && right != DEFAULT_OPENAI_MODEL {
            std::cmp::Ordering::Less
        } else if right == DEFAULT_OPENAI_MODEL && left != DEFAULT_OPENAI_MODEL {
            std::cmp::Ordering::Greater
        } else {
            left.cmp(right)
        }
    });

    deduped
}

fn list_openai_models_internal(token: &str) -> Result<Vec<String>, String> {
    let normalized = token.trim();
    if normalized.is_empty() {
        return Ok(Vec::new());
    }

    let Some(json) = run_curl_get_json(
        "https://api.openai.com/v1/models",
        &[format!("Authorization: Bearer {normalized}")],
    ) else {
        return Err("Failed to load OpenAI models.".to_string());
    };

    let model_ids = json
        .get("data")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    item.get("id")
                        .and_then(Value::as_str)
                        .map(ToString::to_string)
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(sort_open_ai_model_ids(model_ids))
}

fn validate_claude_code_token_internal(token: &str) -> bool {
    let normalized = token.trim();
    if normalized.is_empty() {
        return false;
    }

    get_claude_auth_header_variants(normalized)
        .into_iter()
        .any(|headers| {
            let mut request_headers = headers;
            request_headers.push(format!("anthropic-version: {ANTHROPIC_API_VERSION}"));
            run_curl_success("https://api.anthropic.com/v1/models", &request_headers)
        })
}

fn generate_ai_user_prompt(changed_files: &[String], diff_snippet: &str) -> String {
    format!(
        "Changed files:\n{}\n\nDiff snippet:\n{}",
        changed_files.join("\n"),
        diff_snippet
    )
}

fn generate_with_openai(
    token: &str,
    model: &str,
    system_prompt: &str,
    changed_files: &[String],
    diff_snippet: &str,
) -> Option<String> {
    let normalized_token = token.trim();
    if normalized_token.is_empty() {
        return None;
    }

    let prompt = generate_ai_user_prompt(changed_files, diff_snippet);

    let json = run_curl_json(
        "https://api.openai.com/v1/responses",
        &[
            format!("Authorization: Bearer {normalized_token}"),
            "Content-Type: application/json".to_string(),
        ],
        json!({
            "model": resolve_open_ai_model(model),
            "temperature": 0.2,
            "input": [
                {
                    "role": "system",
                    "content": system_prompt
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
    system_prompt: &str,
    changed_files: &[String],
    diff_snippet: &str,
) -> Option<String> {
    if token.trim().is_empty() {
        return None;
    }

    let prompt = generate_ai_user_prompt(changed_files, diff_snippet);

    for mut headers in get_claude_auth_header_variants(token) {
        headers.push(format!("anthropic-version: {ANTHROPIC_API_VERSION}"));
        headers.push("content-type: application/json".to_string());

        let Some(json) = run_curl_json(
            "https://api.anthropic.com/v1/messages",
            &headers,
            json!({
                "model": "claude-3-5-haiku-latest",
                "max_tokens": 80,
                "system": system_prompt,
                "messages": [
                    {
                        "role": "user",
                        "content": prompt.clone()
                    }
                ]
            }),
        ) else {
            continue;
        };

        if let Some(message) = json
            .get("content")
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
        {
            return Some(message);
        }
    }

    None
}

fn generate_commit_title_internal(
    config: &AppConfig,
    changed_files: &[String],
    diff_snippet: &str,
) -> TitleResponse {
    let fallback = build_heuristic_title(changed_files);
    let limited_diff: String = diff_snippet.chars().take(4000).collect();
    let system_prompt = resolve_commit_title_prompt(&config.commit_title_prompt);
    let provider_order = match config.selected_ai_provider {
        AiProvider::OpenAi => [AiProvider::OpenAi, AiProvider::ClaudeCode],
        AiProvider::ClaudeCode => [AiProvider::ClaudeCode, AiProvider::OpenAi],
    };

    for provider in provider_order {
        let message = match provider {
            AiProvider::OpenAi => generate_with_openai(
                &config.open_ai_token,
                &config.open_ai_model,
                &system_prompt,
                changed_files,
                &limited_diff,
            ),
            AiProvider::ClaudeCode => generate_with_claude(
                &config.claude_code_token,
                &system_prompt,
                changed_files,
                &limited_diff,
            ),
        };

        if let Some(message) = message {
            return normalize_generated_commit_message(&message, &fallback);
        }
    }

    normalize_generated_commit_message("", &fallback)
}

#[tauri::command]
pub fn validate_open_ai_token(token: String) -> Result<TokenValidationResult, String> {
    Ok(TokenValidationResult {
        valid: validate_openai_token_internal(&token),
    })
}

#[tauri::command]
pub fn get_open_ai_models(token: String) -> Result<OpenAiModelsResponse, String> {
    Ok(OpenAiModelsResponse {
        models: list_openai_models_internal(&token)?,
    })
}

#[tauri::command]
pub fn validate_claude_code_token(token: String) -> Result<TokenValidationResult, String> {
    Ok(TokenValidationResult {
        valid: validate_claude_code_token_internal(&token),
    })
}

#[tauri::command]
pub fn health() -> Result<OkResponse, String> {
    Ok(OkResponse { ok: true })
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<OkResponse, String> {
    open_external_url_with_system(&url)?;
    Ok(OkResponse { ok: true })
}

#[tauri::command]
pub fn sync_window_appearance(
    window: tauri::WebviewWindow,
    theme: NativeWindowTheme,
    background_color: [u8; 4],
) -> Result<OkResponse, String> {
    if window.label() != MAIN_WINDOW_LABEL {
        return Ok(OkResponse { ok: true });
    }

    let host_window = window.as_ref().window();
    host_window
        .set_theme(Some(map_native_window_theme(theme)))
        .map_err(|error| format!("Failed to sync window theme: {error}"))?;
    host_window
        .set_background_color(Some(tauri::window::Color(
            background_color[0],
            background_color[1],
            background_color[2],
            background_color[3],
        )))
        .map_err(|error| format!("Failed to sync window background color: {error}"))?;

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
pub fn get_repository_github_url(repo_path: String) -> Result<RepositoryGithubUrlResponse, String> {
    ensure_repo_path(&repo_path)?;

    let remote_url = match run_git(&["remote", "get-url", "origin"], &repo_path) {
        Ok(value) => value,
        Err(_) => {
            return Ok(RepositoryGithubUrlResponse { url: None });
        }
    };

    Ok(RepositoryGithubUrlResponse {
        url: normalize_github_remote_url(&remote_url),
    })
}

#[tauri::command]
pub fn get_repository_mutation_safety(
    repo_path: String,
) -> Result<RepositoryMutationSafetyResponse, String> {
    ensure_repo_path(&repo_path)?;

    let app_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let is_self_repository = canonicalize_path_string(Path::new(&repo_path))
        .zip(canonicalize_path_string(&app_root))
        .map(|(repo, root)| repo == root)
        .unwrap_or(false);

    Ok(RepositoryMutationSafetyResponse { is_self_repository })
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
    let files = parse_commit_file_stats(&file_stats_raw);

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
pub fn get_branch_diff_detail(
    repo_path: String,
    base_ref: String,
    target_ref: String,
) -> Result<BranchDiffDetail, String> {
    ensure_repo_path(&repo_path)?;

    let base_ref = base_ref.trim().to_string();
    let target_ref = target_ref.trim().to_string();

    if base_ref.is_empty() {
        return Err("baseRef is required.".to_string());
    }

    if target_ref.is_empty() {
        return Err("targetRef is required.".to_string());
    }

    let merge_base_sha = run_git(
        &["merge-base", base_ref.as_str(), target_ref.as_str()],
        &repo_path,
    )?;
    let range = format!("{merge_base_sha}..{target_ref}");

    let file_stats_raw = run_git(&["diff", "--numstat", range.as_str()], &repo_path)?;
    let files = parse_commit_file_stats(&file_stats_raw);

    let diff = run_git(&["diff", range.as_str()], &repo_path)?;
    let is_diff_truncated = diff.chars().count() > 25_000;

    Ok(BranchDiffDetail {
        base_ref,
        target_ref,
        merge_base_sha,
        files,
        diff: diff.chars().take(25_000).collect(),
        is_diff_truncated,
    })
}

#[tauri::command]
pub fn get_working_tree_diff_detail(
    repo_path: String,
    file: String,
    area: String,
) -> Result<WorkingTreeDiffDetail, String> {
    ensure_repo_path(&repo_path)?;

    let file = file.trim().to_string();
    if file.is_empty() {
        return Err("file is required.".to_string());
    }

    let area = area.trim().to_string();

    let mut numstat_args = working_tree_diff_args(&area, Some("--numstat"))?;
    numstat_args.push("--".to_string());
    numstat_args.push(file.clone());
    let file_stats_output = run_git_owned(&numstat_args, &repo_path)?;
    let mut files = parse_commit_file_stats(&file_stats_output);

    let mut diff_args = working_tree_diff_args(&area, None)?;
    diff_args.push("--".to_string());
    diff_args.push(file.clone());
    let mut diff = run_git_owned(&diff_args, &repo_path)?;

    if area == "unstaged" && diff.trim().is_empty() {
        let untracked_files = list_untracked_files(&repo_path, &[file.clone()])?;
        if untracked_files.contains(&file) {
            let (file_stat, untracked_diff) =
                build_untracked_file_diff_snapshot(&repo_path, &file)?;
            files = vec![file_stat];
            diff = untracked_diff;
        }
    }

    let is_diff_truncated = diff.chars().count() > 25_000;

    Ok(WorkingTreeDiffDetail {
        file,
        area,
        files,
        diff: diff.chars().take(25_000).collect(),
        is_diff_truncated,
    })
}

#[tauri::command]
pub fn get_working_tree_status(repo_path: String) -> Result<WorkingTreeStatus, String> {
    let repository = open_repository(&repo_path)?;
    let mut options = build_status_options(true);
    let statuses = repository
        .statuses(Some(&mut options))
        .map_err(map_git2_error)?;

    let mut staged = Vec::new();
    let mut unstaged = Vec::new();

    for entry in statuses.iter() {
        let status = entry.status();
        let x = git_status_index_code(status);
        let y = git_status_worktree_code(status);

        if x == ' ' && y == ' ' {
            continue;
        }

        let Some(file) = status_entry_path(&entry) else {
            continue;
        };
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
    if file.trim().is_empty() {
        return Err("file is required.".to_string());
    }

    let repository = open_repository(&repo_path)?;
    let relative_path = Path::new(file.trim());
    let status = repository
        .status_file(relative_path)
        .unwrap_or(Status::WT_NEW);
    let mut index = repository.index().map_err(map_git2_error)?;

    if status.contains(Status::WT_DELETED) && !status.contains(Status::WT_NEW) {
        index.remove_path(relative_path).map_err(map_git2_error)?;
    } else {
        index.add_path(relative_path).map_err(map_git2_error)?;
    }

    index.write().map_err(map_git2_error)?;
    Ok(OkResponse { ok: true })
}

#[tauri::command]
pub fn unstage_file(repo_path: String, file: String) -> Result<OkResponse, String> {
    if file.trim().is_empty() {
        return Err("file is required.".to_string());
    }

    let repository = open_repository(&repo_path)?;

    match repository.revparse_single("HEAD") {
        Ok(head) => {
            repository
                .reset_default(Some(&head), [file.trim()])
                .map_err(map_git2_error)?;
        }
        Err(error) if error.code() == git2::ErrorCode::UnbornBranch => {
            let mut index = repository.index().map_err(map_git2_error)?;
            index
                .remove_path(Path::new(file.trim()))
                .or_else(|remove_error| {
                    if remove_error.code() == git2::ErrorCode::NotFound {
                        Ok(())
                    } else {
                        Err(remove_error)
                    }
                })
                .map_err(map_git2_error)?;
            index.write().map_err(map_git2_error)?;
        }
        Err(error) => return Err(map_git2_error(error)),
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

    let output = run_git(&["stash", "list", "--format=%gd%x1f%cr%x1f%gs"], &repo_path)?;

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
pub fn rename_stash(
    repo_path: String,
    stash_id: String,
    message: String,
) -> Result<OkResponse, String> {
    ensure_repo_path(&repo_path)?;

    let normalized_message = message.trim();
    if normalized_message.is_empty() {
        return Err("message is required.".to_string());
    }

    let stash_index = parse_stash_index(&stash_id)?;
    let stash_log_path = resolve_git_path(&repo_path, "logs/refs/stash")?;
    let stash_log =
        fs::read_to_string(&stash_log_path).map_err(|_| format!("{stash_id} was not found."))?;

    let entries: Vec<StashReflogEntryRecord> = stash_log
        .lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(parse_stash_reflog_line)
        .collect();

    if entries.is_empty() || stash_index >= entries.len() {
        return Err(format!("{stash_id} was not found."));
    }

    let target_log_index = entries.len() - 1 - stash_index;
    let renamed_entries: Vec<StashReflogEntryRecord> = entries
        .iter()
        .enumerate()
        .map(|(index, entry)| {
            let mut next = entry.clone();
            if index == target_log_index {
                next.message = normalized_message.to_string();
            }
            next
        })
        .collect();

    if let Err(error) = rebuild_stash_reflog(&repo_path, &stash_log_path, &renamed_entries) {
        let _ = rebuild_stash_reflog(&repo_path, &stash_log_path, &entries);
        return Err(error);
    }

    Ok(OkResponse { ok: true })
}

#[tauri::command]
pub fn checkout(repo_path: String, reference: String) -> Result<OkResponse, String> {
    if reference.trim().is_empty() {
        return Err("ref is required.".to_string());
    }

    let repository = open_repository(&repo_path)?;
    let (object, reference_match) = repository
        .revparse_ext(reference.trim())
        .map_err(map_git2_error)?;

    let mut checkout = CheckoutBuilder::new();
    checkout.safe();

    if let Some(git_reference) = reference_match {
        let reference_name = git_reference
            .name()
            .ok_or_else(|| "Failed to resolve reference name.".to_string())?;
        repository
            .set_head(reference_name)
            .map_err(map_git2_error)?;
        repository
            .checkout_head(Some(&mut checkout))
            .map_err(map_git2_error)?;
    } else {
        repository
            .checkout_tree(&object, Some(&mut checkout))
            .map_err(map_git2_error)?;
        repository
            .set_head_detached(object.id())
            .map_err(map_git2_error)?;
    }

    Ok(OkResponse { ok: true })
}

#[tauri::command]
pub fn create_branch(
    repo_path: String,
    base_branch: String,
    new_branch: String,
) -> Result<OkResponse, String> {
    let normalized_new_branch =
        validate_create_branch_input(&repo_path, &base_branch, &new_branch)?;
    run_git(
        &[
            "branch",
            normalized_new_branch.as_str(),
            base_branch.as_str(),
        ],
        &repo_path,
    )?;

    Ok(OkResponse { ok: true })
}

#[tauri::command]
pub fn merge_branches(
    repo_path: String,
    source_branch: String,
    target_branch: String,
) -> Result<OkResponse, String> {
    ensure_repo_path(&repo_path)?;
    ensure_branch_pair(&repo_path, &source_branch, &target_branch)?;

    let current_branch = get_current_branch(&repo_path)?;
    if current_branch != target_branch {
        run_git(&["checkout", target_branch.as_str()], &repo_path)?;
    }

    run_git(&["merge", source_branch.as_str()], &repo_path)?;

    Ok(OkResponse { ok: true })
}

#[tauri::command]
pub fn delete_branch(
    repo_path: String,
    branch_name: String,
    branch_type: String,
) -> Result<OkResponse, String> {
    match branch_type.as_str() {
        "local" => {
            ensure_deletable_local_branch(&repo_path, &branch_name)?;
            run_git(&["branch", "-d", branch_name.as_str()], &repo_path)?;
        }
        "remote" => {
            let (remote_name, remote_branch_name) =
                ensure_deletable_remote_branch(&repo_path, &branch_name)?;
            run_git(
                &[
                    "push",
                    remote_name.as_str(),
                    "--delete",
                    remote_branch_name.as_str(),
                ],
                &repo_path,
            )?;
            run_git(&["fetch", remote_name.as_str(), "--prune"], &repo_path)?;
        }
        _ => return Err("branchType must be local or remote.".to_string()),
    }

    Ok(OkResponse { ok: true })
}

#[tauri::command]
pub fn prepare_pull_request(
    repo_path: String,
    source_branch: String,
    target_branch: String,
) -> Result<PullRequestPreparationResponse, String> {
    ensure_repo_path(&repo_path)?;
    ensure_branch_pair(&repo_path, &source_branch, &target_branch)?;
    ensure_origin_remote(&repo_path)?;
    ensure_github_auth(&repo_path)?;

    Ok(PullRequestPreparationResponse {
        push_required: is_push_required(&repo_path, &source_branch)?,
    })
}

#[tauri::command]
pub fn create_pull_request(
    repo_path: String,
    source_branch: String,
    target_branch: String,
    push_source_branch: bool,
) -> Result<PullRequestResponse, String> {
    ensure_repo_path(&repo_path)?;
    ensure_branch_pair(&repo_path, &source_branch, &target_branch)?;
    ensure_origin_remote(&repo_path)?;
    ensure_github_auth(&repo_path)?;

    let push_required = is_push_required(&repo_path, &source_branch)?;
    if push_required && !push_source_branch {
        return Err("Source branch must be pushed before creating a pull request.".to_string());
    }

    if push_source_branch {
        push_branch_to_origin(&repo_path, &source_branch)?;
    }

    if let Some(url) = find_existing_pull_request(&repo_path, &source_branch, &target_branch)? {
        return Err(format!("Pull request already exists: {url}"));
    }

    let args = vec![
        "pr".to_string(),
        "create".to_string(),
        "--base".to_string(),
        target_branch,
        "--head".to_string(),
        source_branch,
        "--fill".to_string(),
    ];
    let output = run_gh_owned(&args, &repo_path)?;
    let url = extract_url_from_text(&output)
        .ok_or_else(|| "Pull request created but URL was not returned.".to_string())?;

    Ok(PullRequestResponse { url })
}

#[tauri::command]
pub fn commit(repo_path: String, title: String, description: String) -> Result<OkResponse, String> {
    if title.trim().is_empty() {
        return Err("Commit title is required.".to_string());
    }

    let repository = open_repository(&repo_path)?;
    let mut index = repository.index().map_err(map_git2_error)?;
    if index.has_conflicts() {
        return Err("Cannot commit while the index has unresolved conflicts.".to_string());
    }

    let tree_oid = index.write_tree().map_err(map_git2_error)?;
    let tree = repository.find_tree(tree_oid).map_err(map_git2_error)?;
    let signature = repository.signature().map_err(map_git2_error)?;
    let message = if description.trim().is_empty() {
        title.trim().to_string()
    } else {
        format!("{}\n\n{}", title.trim(), description.trim())
    };

    match repository.head() {
        Ok(head) => {
            let parent = head.peel_to_commit().map_err(map_git2_error)?;
            let parents: [&GitCommit<'_>; 1] = [&parent];
            repository
                .commit(
                    Some("HEAD"),
                    &signature,
                    &signature,
                    &message,
                    &tree,
                    &parents,
                )
                .map_err(map_git2_error)?;
        }
        Err(error) if error.code() == git2::ErrorCode::UnbornBranch => {
            let parents: [&GitCommit<'_>; 0] = [];
            repository
                .commit(
                    Some("HEAD"),
                    &signature,
                    &signature,
                    &message,
                    &tree,
                    &parents,
                )
                .map_err(map_git2_error)?;
        }
        Err(error) => return Err(map_git2_error(error)),
    };

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
    let repository = open_repository(&repo_path)?;
    let head = match repository.head() {
        Ok(head) => head
            .target()
            .map(|oid| oid.to_string())
            .unwrap_or_else(|| "HEAD".to_string()),
        Err(error) if error.code() == git2::ErrorCode::UnbornBranch => "HEAD".to_string(),
        Err(error) => return Err(map_git2_error(error)),
    };

    let mut options = build_status_options(false);
    let statuses = repository
        .statuses(Some(&mut options))
        .map_err(map_git2_error)?;

    let mut snapshot = String::new();
    snapshot.push_str(&head);

    for entry in statuses.iter() {
        snapshot.push('\n');
        snapshot.push(git_status_index_code(entry.status()));
        snapshot.push(git_status_worktree_code(entry.status()));
        snapshot.push(' ');
        if let Some(path) = status_entry_path(&entry) {
            snapshot.push_str(&path);
        }
    }

    Ok(FingerprintResponse {
        fingerprint: hash_text(&snapshot),
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
        open_ai_model: input.open_ai_model.unwrap_or(current.open_ai_model),
        claude_code_token: input.claude_code_token.unwrap_or(current.claude_code_token),
        selected_ai_provider: input
            .selected_ai_provider
            .unwrap_or(current.selected_ai_provider),
        commit_title_prompt: input
            .commit_title_prompt
            .unwrap_or(current.commit_title_prompt),
        commit_graph_mode: input.commit_graph_mode.unwrap_or(current.commit_graph_mode),
        repository_scan_depth: normalize_repository_scan_depth(
            input
                .repository_scan_depth
                .unwrap_or(current.repository_scan_depth),
        ),
        recently_used: current.recently_used,
        window_state: current.window_state,
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
    Ok(generate_commit_title_internal(
        &config,
        &changed_files,
        &diff_snippet,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::ErrorKind;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_TEMP_REPO_ID: AtomicU64 = AtomicU64::new(0);

    struct TestRepoFixture {
        root_dir: PathBuf,
        repo_path: String,
    }

    impl Drop for TestRepoFixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root_dir);
        }
    }

    fn create_working_tree_diff_fixture() -> TestRepoFixture {
        let temp_dir = std::env::temp_dir();
        let mut root_dir = None;

        for _ in 0..32 {
            let candidate = temp_dir.join(format!(
                "git-chat-ui-tauri-working-tree-diff-{}-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .expect("current time should be after epoch")
                    .as_nanos(),
                NEXT_TEMP_REPO_ID.fetch_add(1, Ordering::Relaxed)
            ));
            match fs::create_dir(&candidate) {
                Ok(()) => {
                    root_dir = Some(candidate);
                    break;
                }
                Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
                Err(error) => panic!("temporary root dir should be created: {error}"),
            }
        }

        let root_dir = root_dir.expect("temporary root dir should be unique");
        let repo_path = root_dir.join("repo");
        fs::create_dir(&repo_path).expect("temporary repo dir should be created");

        let repo_path_str = repo_path.to_string_lossy().to_string();
        run_command("git", &["init", "-b", "main"], &repo_path_str)
            .expect("git init should succeed");
        run_command("git", &["config", "user.name", "Test User"], &repo_path_str)
            .expect("git user.name config should succeed");
        run_command(
            "git",
            &["config", "user.email", "test@example.com"],
            &repo_path_str,
        )
        .expect("git user.email config should succeed");

        fs::write(repo_path.join("README.md"), "line 1\nline 2\n")
            .expect("initial file should be written");
        run_command("git", &["add", "README.md"], &repo_path_str).expect("git add should succeed");
        run_command("git", &["commit", "-m", "init"], &repo_path_str)
            .expect("git commit should succeed");

        fs::write(
            repo_path.join("README.md"),
            "line 1\nline changed\nline 3\n",
        )
        .expect("working tree change should be written");

        TestRepoFixture {
            root_dir,
            repo_path: repo_path_str,
        }
    }

    #[test]
    fn normalize_window_state_clamps_small_dimensions() {
        let value = json!({
            "x": 32,
            "y": 48,
            "width": 640,
            "height": 320,
            "isMaximized": true
        });

        let window_state = normalize_window_state(Some(&value)).expect("window state should parse");

        assert_eq!(
            window_state,
            WindowState {
                x: 32,
                y: 48,
                width: MIN_WINDOW_WIDTH,
                height: MIN_WINDOW_HEIGHT,
                is_maximized: true,
            }
        );
    }

    #[test]
    fn normalize_config_value_preserves_ai_provider_and_prompt() {
        let config = normalize_config_value(json!({
            "openAiToken": "sk-openai",
            "openAiModel": "gpt-4.1",
            "claudeCodeToken": "cc-token",
            "selectedAiProvider": "claudeCode",
            "commitTitlePrompt": "Write a short Japanese commit message.",
            "commitGraphMode": "simple",
            "repositoryScanDepth": 6
        }));

        assert_eq!(config.open_ai_token, "sk-openai");
        assert_eq!(config.open_ai_model, "gpt-4.1");
        assert_eq!(config.claude_code_token, "cc-token");
        assert_eq!(config.selected_ai_provider, AiProvider::ClaudeCode);
        assert_eq!(
            config.commit_title_prompt,
            "Write a short Japanese commit message."
        );
        assert_eq!(config.commit_graph_mode, CommitGraphMode::Simple);
        assert_eq!(config.repository_scan_depth, 6);
    }

    #[test]
    fn resolve_commit_title_prompt_uses_default_when_blank() {
        assert_eq!(
            resolve_commit_title_prompt("   "),
            DEFAULT_COMMIT_TITLE_PROMPT
        );
        assert_eq!(
            resolve_commit_title_prompt("Summarize changes in Japanese."),
            "Summarize changes in Japanese."
        );
    }

    #[test]
    fn resolve_open_ai_model_uses_default_when_blank() {
        assert_eq!(resolve_open_ai_model("   "), DEFAULT_OPENAI_MODEL);
        assert_eq!(resolve_open_ai_model("gpt-4.1"), "gpt-4.1");
    }

    #[test]
    fn sort_open_ai_model_ids_prioritizes_default_and_dedupes() {
        assert_eq!(
            sort_open_ai_model_ids(vec![
                "gpt-4.1".to_string(),
                "gpt-4.1-mini".to_string(),
                "o4-mini".to_string(),
                "gpt-4.1".to_string(),
            ]),
            vec![
                "gpt-4.1-mini".to_string(),
                "gpt-4.1".to_string(),
                "o4-mini".to_string(),
            ]
        );
    }

    #[test]
    fn default_commit_title_prompt_requests_description() {
        assert!(DEFAULT_COMMIT_TITLE_PROMPT.contains("always include a short description"));
        assert!(DEFAULT_COMMIT_TITLE_PROMPT.contains("72 characters or fewer"));
        assert!(DEFAULT_COMMIT_TITLE_PROMPT.contains("rewrite it shorter"));
    }

    #[test]
    fn normalize_generated_commit_message_uses_first_line_and_description() {
        assert_eq!(
            normalize_generated_commit_message(
                "feat(ui): tighten commit prompt handling\n\n- add prefix guidance",
                "Update UI"
            ),
            TitleResponse {
                title: "feat(ui): tighten commit prompt handling".to_string(),
                description: "- add prefix guidance".to_string(),
            }
        );
    }

    #[test]
    fn normalize_generated_commit_message_keeps_long_titles_intact() {
        let result = normalize_generated_commit_message(
            "feat: add a very long summary line that keeps going past the expected seventy-two character limit",
            "Update UI",
        );

        assert_eq!(
            result.title,
            "feat: add a very long summary line that keeps going past the expected seventy-two character limit"
        );
        assert_eq!(result.description, "");
    }

    #[test]
    fn clamp_window_state_to_area_keeps_top_left_visible() {
        let area = tauri::PhysicalRect {
            position: tauri::PhysicalPosition::new(100, 200),
            size: tauri::PhysicalSize::new(1440, 900),
        };
        let window_state = WindowState {
            x: -400,
            y: 1400,
            width: 1480,
            height: 920,
            is_maximized: false,
        };

        let clamped = clamp_window_state_to_area(&window_state, &area);

        assert_eq!(
            clamped,
            WindowState {
                x: 100,
                y: 200,
                width: 1440,
                height: 900,
                is_maximized: false,
            }
        );
    }

    #[test]
    fn window_persist_event_routing_matches_event_type() {
        assert!(should_debounce_window_persist_event(
            &tauri::WindowEvent::Moved(tauri::PhysicalPosition::new(24, 48),)
        ));
        assert!(should_debounce_window_persist_event(
            &tauri::WindowEvent::Resized(tauri::PhysicalSize::new(1440, 900),)
        ));
        assert!(!should_immediately_persist_window_event(
            &tauri::WindowEvent::Moved(tauri::PhysicalPosition::new(24, 48),)
        ));
        assert!(should_immediately_persist_window_event(
            &tauri::WindowEvent::Destroyed
        ));
        assert!(!should_debounce_window_persist_event(
            &tauri::WindowEvent::Focused(true)
        ));
        assert!(!should_immediately_persist_window_event(
            &tauri::WindowEvent::Focused(true)
        ));
    }

    #[test]
    fn get_working_tree_diff_detail_returns_unstaged_diff_for_changed_file() {
        let fixture = create_working_tree_diff_fixture();

        let detail = get_working_tree_diff_detail(
            fixture.repo_path.clone(),
            "README.md".to_string(),
            "unstaged".to_string(),
        )
        .expect("working tree diff detail should be returned");

        assert_eq!(detail.file, "README.md");
        assert_eq!(detail.area, "unstaged");
        assert_eq!(detail.files.len(), 1);
        assert_eq!(detail.files[0].file, "README.md");
        assert_eq!(detail.files[0].additions, 2);
        assert_eq!(detail.files[0].deletions, 1);
        assert!(detail.diff.contains("diff --git a/README.md b/README.md"));
        assert!(detail.diff.contains("+line changed"));
        assert!(!detail.is_diff_truncated);
    }

    #[test]
    fn get_working_tree_diff_detail_returns_untracked_diff_for_new_file() {
        let fixture = create_working_tree_diff_fixture();
        fs::write(
            Path::new(&fixture.repo_path).join("notes.txt"),
            "alpha\nbeta\n",
        )
        .expect("untracked file should be written");

        let detail = get_working_tree_diff_detail(
            fixture.repo_path.clone(),
            "notes.txt".to_string(),
            "unstaged".to_string(),
        )
        .expect("untracked working tree diff detail should be returned");

        assert_eq!(detail.file, "notes.txt");
        assert_eq!(detail.area, "unstaged");
        assert_eq!(detail.files.len(), 1);
        assert_eq!(detail.files[0].file, "notes.txt");
        assert_eq!(detail.files[0].additions, 2);
        assert_eq!(detail.files[0].deletions, 0);
        assert!(detail.diff.contains("diff --git a/notes.txt b/notes.txt"));
        assert!(detail.diff.contains("--- /dev/null"));
        assert!(detail.diff.contains("+alpha"));
        assert!(detail.diff.contains("+beta"));
        assert!(!detail.is_diff_truncated);
    }

    #[test]
    fn create_branch_creates_new_local_branch_without_switching_head() {
        let fixture = create_working_tree_diff_fixture();
        run_command(
            "git",
            &["checkout", "-b", "feature/base"],
            &fixture.repo_path,
        )
        .expect("feature branch should be created");
        run_command("git", &["checkout", "main"], &fixture.repo_path)
            .expect("checkout main should succeed");

        create_branch(
            fixture.repo_path.clone(),
            "feature/base".to_string(),
            "feature/context-menu".to_string(),
        )
        .expect("branch creation command should succeed");

        let base_sha = run_command("git", &["rev-parse", "feature/base"], &fixture.repo_path)
            .expect("base branch sha should resolve");
        let new_sha = run_command(
            "git",
            &["rev-parse", "feature/context-menu"],
            &fixture.repo_path,
        )
        .expect("new branch sha should resolve");
        let current_branch = run_command("git", &["branch", "--show-current"], &fixture.repo_path)
            .expect("current branch should resolve");

        assert_eq!(new_sha, base_sha);
        assert_eq!(current_branch, "main");
    }

    #[test]
    fn create_branch_rejects_duplicate_local_branch_names() {
        let fixture = create_working_tree_diff_fixture();
        run_command(
            "git",
            &["checkout", "-b", "feature/remote-delete"],
            &fixture.repo_path,
        )
        .expect("existing feature branch should be created");
        run_command("git", &["checkout", "main"], &fixture.repo_path)
            .expect("checkout main should succeed");

        let error = create_branch(
            fixture.repo_path.clone(),
            "main".to_string(),
            "feature/remote-delete".to_string(),
        )
        .expect_err("duplicate branch names should be rejected");

        assert_eq!(
            error,
            "Local branch 'feature/remote-delete' already exists."
        );
    }
}
