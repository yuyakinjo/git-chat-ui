use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use git2::{
    build::CheckoutBuilder, Commit as GitCommit, Repository as GitRepository, Status, StatusOptions,
};
use reqwest::blocking::Client;
use reqwest::header::CONTENT_TYPE;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::hash::{Hash, Hasher};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, LazyLock, Mutex};
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
const NO_STAGED_CHANGES_ERROR: &str =
    "No staged changes are available for commit message generation.";
const NO_AI_PROVIDER_ERROR: &str = "No AI provider is configured for commit message generation.";
const REPOSITORY_ASSISTANT_REQUIRES_OPENAI_ERROR: &str =
    "AI sidebar requires an OpenAI token in Config.";
const COMMIT_AVATAR_HISTORY_LIMIT: usize = 100;
const COMMIT_AVATAR_SIZE: usize = 72;
const MAX_REPOSITORY_ASSISTANT_MESSAGES: usize = 12;
const MAX_REPOSITORY_ASSISTANT_LIST_ITEMS: usize = 8;
const DEFAULT_COMMIT_TITLE_PROMPT: &str = concat!(
    "You are a Git assistant. Write a Git commit message from the provided staged changes.\n",
    "Requirements:\n",
    "- The first line must be an conventional commit title such as feat:, fix:, docs:, style:, refactor:, perf:, test:, build:, ci:, chore:, or revert:. Use an optional scope when it adds clarity.\n",
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
static NEXT_TEMP_DIRECTORY_ID: AtomicU64 = AtomicU64::new(0);
static NEXT_MERGE_SESSION_ID: AtomicU64 = AtomicU64::new(0);
static MERGE_SESSIONS: LazyLock<Mutex<HashMap<String, MergeSession>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Clone, Copy)]
struct RepositoryAssistantActionSpec {
    id: &'static str,
    label: &'static str,
    description: &'static str,
    group: &'static str,
    risk: &'static str,
    mutates_working_tree: bool,
}

const REPOSITORY_ASSISTANT_ACTION_SPECS: &[RepositoryAssistantActionSpec] = &[
    RepositoryAssistantActionSpec {
        id: "git.stage_file",
        label: "Stage File",
        description: "Run Git Chat UI's stage-file operation for one file.",
        group: "git",
        risk: "low",
        mutates_working_tree: false,
    },
    RepositoryAssistantActionSpec {
        id: "git.unstage_file",
        label: "Unstage File",
        description: "Run Git Chat UI's unstage-file operation for one file.",
        group: "git",
        risk: "low",
        mutates_working_tree: false,
    },
    RepositoryAssistantActionSpec {
        id: "git.stash_file",
        label: "Stash File",
        description: "Stash one file with the existing stash-file operation.",
        group: "git",
        risk: "medium",
        mutates_working_tree: true,
    },
    RepositoryAssistantActionSpec {
        id: "git.checkout_ref",
        label: "Checkout Ref",
        description: "Checkout a branch or commit ref.",
        group: "git",
        risk: "high",
        mutates_working_tree: true,
    },
    RepositoryAssistantActionSpec {
        id: "git.create_branch",
        label: "Create Branch",
        description: "Create and checkout a new branch from a base branch.",
        group: "git",
        risk: "medium",
        mutates_working_tree: true,
    },
    RepositoryAssistantActionSpec {
        id: "git.merge_branches",
        label: "Merge Branches",
        description: "Merge a source branch into a target branch.",
        group: "git",
        risk: "high",
        mutates_working_tree: true,
    },
    RepositoryAssistantActionSpec {
        id: "git.pull_current_branch",
        label: "Pull Branch",
        description: "Pull upstream changes into the current or specified branch.",
        group: "git",
        risk: "high",
        mutates_working_tree: true,
    },
    RepositoryAssistantActionSpec {
        id: "git.commit",
        label: "Commit",
        description: "Create a commit from staged changes.",
        group: "git",
        risk: "high",
        mutates_working_tree: false,
    },
    RepositoryAssistantActionSpec {
        id: "git.push",
        label: "Push",
        description: "Push the current branch to its remote.",
        group: "git",
        risk: "high",
        mutates_working_tree: false,
    },
    RepositoryAssistantActionSpec {
        id: "git.resolve_conflict_side",
        label: "Resolve Conflict",
        description: "Resolve one conflicted file by choosing merged, ours, or theirs.",
        group: "git",
        risk: "high",
        mutates_working_tree: true,
    },
    RepositoryAssistantActionSpec {
        id: "git.complete_merge_session",
        label: "Complete Merge Session",
        description: "Finish an existing merge session after all conflicts are resolved.",
        group: "git",
        risk: "high",
        mutates_working_tree: true,
    },
    RepositoryAssistantActionSpec {
        id: "git.abort_merge_session",
        label: "Abort Merge Session",
        description: "Abort an in-progress merge session.",
        group: "git",
        risk: "high",
        mutates_working_tree: true,
    },
    RepositoryAssistantActionSpec {
        id: "git.apply_stash",
        label: "Apply Stash",
        description: "Apply a stash entry without dropping it.",
        group: "git",
        risk: "high",
        mutates_working_tree: true,
    },
    RepositoryAssistantActionSpec {
        id: "git.pop_stash",
        label: "Pop Stash",
        description: "Apply and drop a stash entry.",
        group: "git",
        risk: "high",
        mutates_working_tree: true,
    },
    RepositoryAssistantActionSpec {
        id: "gh.pr.prepare",
        label: "Prepare Pull Request",
        description: "Check whether the source branch needs to be pushed before PR creation.",
        group: "githubPr",
        risk: "low",
        mutates_working_tree: false,
    },
    RepositoryAssistantActionSpec {
        id: "gh.pr.create",
        label: "Create Pull Request",
        description: "Create a GitHub pull request, optionally pushing the source branch first.",
        group: "githubPr",
        risk: "high",
        mutates_working_tree: false,
    },
];

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryAssistantPolicy {
    #[serde(default)]
    pub allowed_action_ids: Vec<String>,
}

pub type RepositoryAssistantPolicies = HashMap<String, RepositoryAssistantPolicy>;

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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum OpenAiReasoningEffort {
    Default,
    #[serde(rename = "none")]
    NoneValue,
    Minimal,
    Low,
    Medium,
    High,
    Xhigh,
}

impl Default for OpenAiReasoningEffort {
    fn default() -> Self {
        Self::Default
    }
}

impl OpenAiReasoningEffort {
    fn as_api_value(self) -> Option<&'static str> {
        match self {
            Self::Default => None,
            Self::NoneValue => Some("none"),
            Self::Minimal => Some("minimal"),
            Self::Low => Some("low"),
            Self::Medium => Some("medium"),
            Self::High => Some("high"),
            Self::Xhigh => Some("xhigh"),
        }
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
    pub repository_assistant_open_ai_model: String,
    pub repository_assistant_reasoning_effort: OpenAiReasoningEffort,
    pub claude_code_token: String,
    pub selected_ai_provider: AiProvider,
    pub commit_title_prompt: String,
    pub commit_graph_mode: CommitGraphMode,
    pub repository_scan_depth: usize,
    pub repository_assistant_policies: RepositoryAssistantPolicies,
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
            repository_assistant_open_ai_model: DEFAULT_OPENAI_MODEL.to_string(),
            repository_assistant_reasoning_effort: OpenAiReasoningEffort::Default,
            claude_code_token: String::new(),
            selected_ai_provider: AiProvider::OpenAi,
            commit_title_prompt: DEFAULT_COMMIT_TITLE_PROMPT.to_string(),
            commit_graph_mode: CommitGraphMode::Detailed,
            repository_scan_depth: 4,
            repository_assistant_policies: HashMap::new(),
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
pub struct CommitAuthorAvatarsResponse {
    pub avatars: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct CommitAvatarManifest {
    #[serde(default)]
    commits: HashMap<String, CommitAvatarCommitEntry>,
    #[serde(default)]
    images: HashMap<String, CommitAvatarImageEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommitAvatarCommitEntry {
    image_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommitAvatarImageEntry {
    file_name: String,
    mime_type: String,
}

#[derive(Debug, Deserialize)]
struct GithubCommitAvatarGraphQlResponse {
    data: Option<GithubCommitAvatarGraphQlData>,
}

#[derive(Debug, Deserialize)]
struct GithubCommitAvatarGraphQlData {
    repository: Option<GithubCommitAvatarGraphQlRepository>,
}

#[derive(Debug, Deserialize)]
struct GithubCommitAvatarGraphQlRepository {
    object: Option<GithubCommitAvatarGraphQlObject>,
}

#[derive(Debug, Deserialize)]
struct GithubCommitAvatarGraphQlObject {
    history: Option<GithubCommitAvatarGraphQlHistory>,
}

#[derive(Debug, Deserialize)]
struct GithubCommitAvatarGraphQlHistory {
    nodes: Vec<GithubCommitAvatarGraphQlNode>,
}

#[derive(Debug, Deserialize)]
struct GithubCommitAvatarGraphQlNode {
    oid: Option<String>,
    author: Option<GithubCommitAvatarGraphQlAuthor>,
}

#[derive(Debug, Deserialize)]
struct GithubCommitAvatarGraphQlAuthor {
    user: Option<GithubCommitAvatarGraphQlUser>,
}

#[derive(Debug, Deserialize)]
struct GithubCommitAvatarGraphQlUser {
    #[serde(rename = "avatarUrl")]
    avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CommitFileKind {
    Modified,
    Added,
    Deleted,
    Renamed,
    Changed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitFileStat {
    pub file: String,
    pub additions: i64,
    pub deletions: i64,
    pub kind: CommitFileKind,
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
pub struct CommitFileDiffDetail {
    pub sha: String,
    pub file: String,
    pub diff: String,
    pub is_diff_truncated: bool,
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
pub struct BranchDiffFileDetail {
    pub base_ref: String,
    pub target_ref: String,
    pub file: String,
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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ConflictContextType {
    Repository,
    MergeSession,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ConflictOperation {
    Merge,
    Pull,
    StashApply,
    StashPop,
    Unknown,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ConflictResolutionSide {
    Merged,
    Ours,
    Theirs,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkingTreeStatus {
    pub conflicted: Vec<WorkingFile>,
    pub staged: Vec<WorkingFile>,
    pub unstaged: Vec<WorkingFile>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictSummary {
    pub context_type: ConflictContextType,
    pub operation: ConflictOperation,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_branch: Option<String>,
    pub files: Vec<WorkingFile>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictFileVersion {
    pub is_binary: bool,
    pub content: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictFileDetail {
    pub file: String,
    pub x: String,
    pub y: String,
    pub status_label: String,
    pub merged: ConflictFileVersion,
    pub base: ConflictFileVersion,
    pub ours: ConflictFileVersion,
    pub theirs: ConflictFileVersion,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictOperationResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conflict: Option<ConflictSummary>,
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
pub struct StashDiffDetail {
    pub stash_id: String,
    pub files: Vec<CommitFileStat>,
    pub diff: String,
    pub is_diff_truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StashDiffFileDetail {
    pub stash_id: String,
    pub file: String,
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

#[derive(Debug, Clone)]
struct MergeSession {
    id: String,
    repo_path: String,
    temp_root_path: PathBuf,
    worktree_path: PathBuf,
    source_branch: String,
    target_branch: String,
    previous_target_sha: String,
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

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryAssistantUserProfileResponse {
    pub login: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchPullRequest {
    pub url: String,
    pub has_conflicts: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchPullRequestsResponse {
    pub pull_requests: HashMap<String, BranchPullRequest>,
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
pub struct PullStatusResponse {
    pub branch_name: Option<String>,
    pub upstream_name: Option<String>,
    pub remote_name: Option<String>,
    pub remote_branch_name: Option<String>,
    pub ahead_count: usize,
    pub behind_count: usize,
    pub can_pull: bool,
    pub state: String,
}

fn detached_pull_status_response() -> PullStatusResponse {
    PullStatusResponse {
        branch_name: None,
        upstream_name: None,
        remote_name: None,
        remote_branch_name: None,
        ahead_count: 0,
        behind_count: 0,
        can_pull: false,
        state: "detached".to_string(),
    }
}

fn no_upstream_pull_status_response(branch_name: String) -> PullStatusResponse {
    PullStatusResponse {
        branch_name: Some(branch_name),
        upstream_name: None,
        remote_name: None,
        remote_branch_name: None,
        ahead_count: 0,
        behind_count: 0,
        can_pull: false,
        state: "noUpstream".to_string(),
    }
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
    pub repository_assistant_open_ai_model: Option<String>,
    pub repository_assistant_reasoning_effort: Option<OpenAiReasoningEffort>,
    pub repository_assistant_policies: Option<Value>,
    pub claude_code_token: Option<String>,
    pub selected_ai_provider: Option<AiProvider>,
    pub commit_title_prompt: Option<String>,
    pub commit_graph_mode: Option<CommitGraphMode>,
    pub repository_scan_depth: Option<usize>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateTitleInput {
    pub repo_path: String,
    pub changed_files: Vec<String>,
    pub open_ai_token: Option<String>,
    pub open_ai_model: Option<String>,
    pub claude_code_token: Option<String>,
    pub selected_ai_provider: Option<AiProvider>,
    pub commit_title_prompt: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RepositoryAssistantMessageRole {
    User,
    Assistant,
}

impl RepositoryAssistantMessageRole {
    fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Assistant => "assistant",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryAssistantMessage {
    pub id: String,
    pub role: RepositoryAssistantMessageRole,
    pub content: String,
    pub created_at: String,
}

fn default_repository_assistant_action_args() -> Value {
    Value::Object(serde_json::Map::new())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryAssistantAction {
    pub id: String,
    #[serde(default = "default_repository_assistant_action_args")]
    pub args: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryAssistantActionResult {
    pub action: RepositoryAssistantAction,
    pub status: String,
    pub message: String,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryAssistantActionProposal {
    pub id: String,
    pub action: RepositoryAssistantAction,
    pub reason: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<RepositoryAssistantActionResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatWithRepositoryAssistantInput {
    pub repo_path: String,
    pub messages: Vec<RepositoryAssistantMessage>,
    pub open_ai_model: Option<String>,
    pub reasoning_effort: Option<OpenAiReasoningEffort>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryAssistantResponse {
    pub message: RepositoryAssistantMessage,
    pub proposed_actions: Vec<RepositoryAssistantActionProposal>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryAssistantActionExecutionResponse {
    pub result: RepositoryAssistantActionResult,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteRepositoryAssistantActionInput {
    pub repo_path: String,
    pub action: RepositoryAssistantAction,
}

#[derive(Debug, Clone)]
struct ProviderAttemptResult {
    attempted: bool,
    provider: &'static str,
    error: Option<String>,
    message: Option<String>,
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

fn commit_avatar_cache_root() -> Result<PathBuf, String> {
    Ok(config_dir()?.join("commit-author-avatars"))
}

fn commit_avatar_manifest_path(repo_key: &str) -> Result<PathBuf, String> {
    Ok(commit_avatar_cache_root()?
        .join("manifests")
        .join(format!("{}.json", stable_hash_text(repo_key))))
}

fn commit_avatar_image_path(file_name: &str) -> Result<PathBuf, String> {
    Ok(commit_avatar_cache_root()?.join("images").join(file_name))
}

fn normalize_commit_avatar_mime_type(value: Option<&str>) -> String {
    let normalized = value
        .unwrap_or("image/png")
        .split(';')
        .next()
        .unwrap_or("image/png")
        .trim()
        .to_ascii_lowercase();

    if normalized.starts_with("image/") {
        normalized
    } else {
        "image/png".to_string()
    }
}

fn commit_avatar_extension_for_mime_type(mime_type: &str) -> &'static str {
    match normalize_commit_avatar_mime_type(Some(mime_type)).as_str() {
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        _ => "png",
    }
}

fn normalize_github_history_ref(ref_name: &str) -> String {
    let trimmed = ref_name.trim();
    if trimmed.is_empty() {
        return "HEAD".to_string();
    }

    if let Some(value) = trimmed.strip_prefix("refs/heads/") {
        return value.to_string();
    }

    if let Some(value) = trimmed.strip_prefix("refs/remotes/") {
        let segments: Vec<&str> = value
            .split('/')
            .filter(|segment| !segment.is_empty())
            .collect();
        if segments.len() > 1 {
            return segments[1..].join("/");
        }
    }

    if let Some(value) = trimmed.strip_prefix("origin/") {
        return value.to_string();
    }

    trimmed.to_string()
}

fn resolve_github_history_ref(repo_path: &str, ref_name: Option<&str>) -> Result<String, String> {
    let normalized = normalize_github_history_ref(ref_name.unwrap_or("HEAD"));
    if normalized != "HEAD" {
        return Ok(normalized);
    }

    run_git(&["rev-parse", "HEAD"], repo_path)
}

fn parse_github_repository_slug(repository_url: &str) -> Option<(String, String)> {
    let parsed = Url::parse(repository_url).ok()?;
    let segments: Vec<&str> = parsed
        .path()
        .trim_matches('/')
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect();

    if segments.len() != 2 {
        return None;
    }

    Some((segments[0].to_string(), segments[1].to_string()))
}

fn read_commit_avatar_manifest(repo_key: &str) -> CommitAvatarManifest {
    let path = match commit_avatar_manifest_path(repo_key) {
        Ok(path) => path,
        Err(_) => return CommitAvatarManifest::default(),
    };

    match fs::read_to_string(path) {
        Ok(content) => serde_json::from_str::<CommitAvatarManifest>(&content).unwrap_or_default(),
        Err(_) => CommitAvatarManifest::default(),
    }
}

fn write_commit_avatar_manifest(
    repo_key: &str,
    manifest: &CommitAvatarManifest,
) -> Result<(), String> {
    let path = commit_avatar_manifest_path(repo_key)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create avatar manifest dir: {error}"))?;
    }

    let body = serde_json::to_string_pretty(manifest)
        .map_err(|error| format!("Failed to serialize avatar manifest: {error}"))?;
    fs::write(path, body).map_err(|error| format!("Failed to write avatar manifest: {error}"))
}

fn parse_github_commit_avatar_graphql_response(raw: &str) -> HashMap<String, String> {
    let parsed = serde_json::from_str::<GithubCommitAvatarGraphQlResponse>(raw).ok();
    let nodes = parsed
        .and_then(|value| value.data)
        .and_then(|value| value.repository)
        .and_then(|value| value.object)
        .and_then(|value| value.history)
        .map(|value| value.nodes)
        .unwrap_or_default();

    let mut avatars = HashMap::new();
    for node in nodes {
        let sha = node.oid.unwrap_or_default().trim().to_string();
        let avatar_url = node
            .author
            .and_then(|value| value.user)
            .and_then(|value| value.avatar_url)
            .unwrap_or_default()
            .trim()
            .to_string();

        if sha.is_empty() || avatar_url.is_empty() {
            continue;
        }

        avatars.insert(sha, avatar_url);
    }

    avatars
}

fn fetch_github_commit_avatar_urls(
    repo_path: &str,
    owner: &str,
    name: &str,
    ref_name: &str,
) -> Result<HashMap<String, String>, String> {
    let query = [
        "query($owner: String!, $name: String!, $ref: String!, $limit: Int!, $avatarSize: Int!) {",
        "  repository(owner: $owner, name: $name) {",
        "    object(expression: $ref) {",
        "      ... on Commit {",
        "        history(first: $limit) {",
        "          nodes {",
        "            oid",
        "            author {",
        "              user {",
        "                avatarUrl(size: $avatarSize)",
        "              }",
        "            }",
        "          }",
        "        }",
        "      }",
        "    }",
        "  }",
        "}",
    ]
    .join("\n");

    let args = vec![
        "api".to_string(),
        "graphql".to_string(),
        "-f".to_string(),
        format!("query={query}"),
        "-F".to_string(),
        format!("owner={owner}"),
        "-F".to_string(),
        format!("name={name}"),
        "-F".to_string(),
        format!("ref={ref_name}"),
        "-F".to_string(),
        format!("limit={COMMIT_AVATAR_HISTORY_LIMIT}"),
        "-F".to_string(),
        format!("avatarSize={COMMIT_AVATAR_SIZE}"),
    ];

    let output = run_gh_owned(&args, repo_path)?;
    Ok(parse_github_commit_avatar_graphql_response(&output))
}

fn download_commit_avatar_image(url: &str) -> Result<(Vec<u8>, String), String> {
    let client = Client::builder()
        .user_agent("git-chat-ui")
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("Failed to create avatar client: {error}"))?;
    let response = client
        .get(url)
        .header("Accept", "image/*")
        .send()
        .map_err(|error| format!("Failed to download avatar image: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Failed to download avatar image: HTTP {}",
            response.status()
        ));
    }

    let mime_type = normalize_commit_avatar_mime_type(
        response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok()),
    );
    let bytes = response
        .bytes()
        .map_err(|error| format!("Failed to read avatar image: {error}"))?
        .to_vec();

    Ok((bytes, mime_type))
}

fn persist_commit_avatar_image(
    image_key: &str,
    avatar_url: &str,
    manifest: &mut CommitAvatarManifest,
) -> Result<(), String> {
    if let Some(existing) = manifest.images.get(image_key) {
        let cached_path = commit_avatar_image_path(&existing.file_name)?;
        if cached_path.is_file() {
            return Ok(());
        }
    }

    let (bytes, mime_type) = download_commit_avatar_image(avatar_url)?;
    let file_name = format!(
        "{image_key}.{}",
        commit_avatar_extension_for_mime_type(&mime_type)
    );
    let target_path = commit_avatar_image_path(&file_name)?;
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create avatar cache dir: {error}"))?;
    }
    fs::write(&target_path, bytes)
        .map_err(|error| format!("Failed to write avatar image cache: {error}"))?;
    manifest.images.insert(
        image_key.to_string(),
        CommitAvatarImageEntry {
            file_name,
            mime_type,
        },
    );
    Ok(())
}

fn build_commit_author_avatar_sources(
    manifest: &CommitAvatarManifest,
    shas: &[String],
) -> HashMap<String, String> {
    let mut avatars = HashMap::new();

    for sha in shas {
        let Some(commit_entry) = manifest.commits.get(sha) else {
            continue;
        };
        let Some(image_entry) = manifest.images.get(&commit_entry.image_key) else {
            continue;
        };
        let Ok(path) = commit_avatar_image_path(&image_entry.file_name) else {
            continue;
        };
        let Ok(bytes) = fs::read(path) else {
            continue;
        };

        avatars.insert(
            sha.clone(),
            format!(
                "data:{};base64,{}",
                image_entry.mime_type,
                BASE64_STANDARD.encode(bytes)
            ),
        );
    }

    avatars
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

fn normalize_repository_assistant_open_ai_model(
    value: Option<&Value>,
    fallback_open_ai_model: &str,
) -> String {
    let fallback = resolve_open_ai_model(fallback_open_ai_model);
    let normalized = value
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();

    if normalized.is_empty() {
        fallback
    } else {
        normalized.to_string()
    }
}

fn normalize_open_ai_reasoning_effort_value(value: Option<&Value>) -> OpenAiReasoningEffort {
    value
        .cloned()
        .and_then(|candidate| serde_json::from_value::<OpenAiReasoningEffort>(candidate).ok())
        .unwrap_or_default()
}

fn is_repository_assistant_action_id(value: &str) -> bool {
    REPOSITORY_ASSISTANT_ACTION_SPECS
        .iter()
        .any(|spec| spec.id == value)
}

fn repository_assistant_action_sort_key(action_id: &str) -> usize {
    REPOSITORY_ASSISTANT_ACTION_SPECS
        .iter()
        .position(|spec| spec.id == action_id)
        .unwrap_or(REPOSITORY_ASSISTANT_ACTION_SPECS.len())
}

fn normalize_repository_assistant_allowed_action_ids(value: Option<&Value>) -> Vec<String> {
    let Some(Value::Array(items)) = value else {
        return Vec::new();
    };

    let mut seen = HashSet::new();
    let mut normalized = items
        .iter()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|candidate| !candidate.is_empty() && is_repository_assistant_action_id(candidate))
        .filter_map(|candidate| {
            let owned = candidate.to_string();
            if seen.insert(owned.clone()) {
                Some(owned)
            } else {
                None
            }
        })
        .collect::<Vec<_>>();

    normalized.sort_by_key(|action_id| repository_assistant_action_sort_key(action_id));
    normalized
}

fn normalize_repository_assistant_policies_value(
    value: Option<&Value>,
) -> RepositoryAssistantPolicies {
    let Some(Value::Object(map)) = value else {
        return HashMap::new();
    };

    map.iter()
        .filter_map(|(repo_path, policy_value)| {
            let trimmed_repo_path = repo_path.trim();
            if trimmed_repo_path.is_empty() {
                return None;
            }

            let allowed_action_ids = match policy_value {
                Value::Object(policy_map) => normalize_repository_assistant_allowed_action_ids(
                    policy_map.get("allowedActionIds"),
                ),
                _ => Vec::new(),
            };

            Some((
                trimmed_repo_path.to_string(),
                RepositoryAssistantPolicy { allowed_action_ids },
            ))
        })
        .collect()
}

fn normalize_repository_assistant_policies(
    policies: &RepositoryAssistantPolicies,
) -> RepositoryAssistantPolicies {
    let value = serde_json::to_value(policies).unwrap_or(Value::Null);
    normalize_repository_assistant_policies_value(Some(&value))
}

fn is_repository_assistant_action_allowed(
    policies: &RepositoryAssistantPolicies,
    repo_path: &str,
    action_id: &str,
) -> bool {
    policies
        .get(repo_path)
        .map(|policy| {
            policy
                .allowed_action_ids
                .iter()
                .any(|candidate| candidate == action_id)
        })
        .unwrap_or(false)
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
    let repository_assistant_open_ai_model = normalize_repository_assistant_open_ai_model(
        value.get("repositoryAssistantOpenAiModel"),
        &open_ai_model,
    );
    let repository_assistant_reasoning_effort =
        normalize_open_ai_reasoning_effort_value(value.get("repositoryAssistantReasoningEffort"));
    let repository_assistant_policies =
        normalize_repository_assistant_policies_value(value.get("repositoryAssistantPolicies"));

    let claude_code_token = value
        .get("claudeCodeToken")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    let selected_ai_provider = normalize_selected_ai_provider(value.get("selectedAiProvider"));
    let commit_title_prompt = resolve_commit_title_prompt(
        value
            .get("commitTitlePrompt")
            .and_then(Value::as_str)
            .unwrap_or_default(),
    );

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
        repository_assistant_open_ai_model,
        repository_assistant_reasoning_effort,
        claude_code_token,
        selected_ai_provider,
        commit_title_prompt,
        commit_graph_mode,
        repository_scan_depth,
        repository_assistant_policies,
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

    let open_ai_model = normalize_open_ai_model(Some(&Value::String(config.open_ai_model.clone())));
    let repository_assistant_open_ai_model = normalize_repository_assistant_open_ai_model(
        Some(&Value::String(
            config.repository_assistant_open_ai_model.clone(),
        )),
        &open_ai_model,
    );

    let normalized = AppConfig {
        open_ai_token: config.open_ai_token.clone(),
        open_ai_model,
        repository_assistant_open_ai_model,
        repository_assistant_reasoning_effort: config.repository_assistant_reasoning_effort,
        claude_code_token: config.claude_code_token.clone(),
        selected_ai_provider: config.selected_ai_provider,
        commit_title_prompt: resolve_commit_title_prompt(&config.commit_title_prompt),
        commit_graph_mode: config.commit_graph_mode,
        repository_scan_depth: normalize_repository_scan_depth(config.repository_scan_depth),
        repository_assistant_policies: normalize_repository_assistant_policies(
            &config.repository_assistant_policies,
        ),
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

fn run_command_buffer(command: &str, args: &[&str], repo_path: &str) -> Result<Vec<u8>, String> {
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

    Ok(output.stdout)
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

fn run_git_buffer(args: &[&str], repo_path: &str) -> Result<Vec<u8>, String> {
    run_command_buffer("git", args, repo_path)
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

fn read_stash_reflog_entries(
    stash_log_path: &Path,
    stash_id_for_error: &str,
) -> Result<Vec<StashReflogEntryRecord>, String> {
    let stash_log = fs::read_to_string(stash_log_path)
        .map_err(|_| format!("{stash_id_for_error} was not found."))?;

    Ok(stash_log
        .lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(parse_stash_reflog_line)
        .collect())
}

fn validate_append_file(repo_path: &str, file: &str) -> Result<String, String> {
    let normalized_file = file.trim().to_string();
    if normalized_file.is_empty() {
        return Err("file is required.".to_string());
    }

    run_git(
        &[
            "ls-files",
            "--error-unmatch",
            "--",
            normalized_file.as_str(),
        ],
        repo_path,
    )?;

    Ok(normalized_file)
}

fn collect_append_file_patches(repo_path: &str, file: &str) -> Result<(String, String), String> {
    let staged_patch = run_git(&["diff", "--binary", "--cached", "--", file], repo_path)?;
    let unstaged_patch = run_git(&["diff", "--binary", "--", file], repo_path)?;

    if staged_patch.trim().is_empty() && unstaged_patch.trim().is_empty() {
        return Err(format!(
            "No staged or unstaged changes were found for '{file}'."
        ));
    }

    Ok((staged_patch, unstaged_patch))
}

fn apply_patch_file(
    worktree_path: &str,
    temp_root_path: &Path,
    name: &str,
    patch: &str,
    apply_to_index: bool,
) -> Result<(), String> {
    if patch.trim().is_empty() {
        return Ok(());
    }

    let patch_path = temp_root_path.join(name);
    fs::write(&patch_path, format!("{patch}\n")).map_err(|error| error.to_string())?;
    let patch_path_str = patch_path.to_string_lossy().to_string();

    let mut args = vec!["apply".to_string()];
    if apply_to_index {
        args.push("--index".to_string());
    }
    args.push("--binary".to_string());
    args.push("--whitespace=nowarn".to_string());
    args.push(patch_path_str);

    run_git_owned(&args, worktree_path).map(|_| ())
}

fn create_replacement_stash_commit(
    repo_path: &str,
    stash_id: &str,
    stash_message: &str,
    staged_patch: &str,
    unstaged_patch: &str,
) -> Result<String, String> {
    let temp_root_path = create_temporary_directory("stash-append")?;
    let worktree_path = temp_root_path.join("worktree");
    let worktree_path_str = worktree_path.to_string_lossy().to_string();

    let operation_result = (|| {
        run_git(
            &[
                "worktree",
                "add",
                "--detach",
                worktree_path_str.as_str(),
                "HEAD",
            ],
            repo_path,
        )?;
        run_git(
            &["stash", "apply", "--index", stash_id],
            worktree_path_str.as_str(),
        )?;
        apply_patch_file(
            worktree_path_str.as_str(),
            &temp_root_path,
            "staged.patch",
            staged_patch,
            true,
        )?;
        apply_patch_file(
            worktree_path_str.as_str(),
            &temp_root_path,
            "unstaged.patch",
            unstaged_patch,
            false,
        )?;

        let replacement_oid = run_git(
            &["stash", "create", stash_message],
            worktree_path_str.as_str(),
        )?;
        let replacement_oid = replacement_oid.trim().to_string();
        if replacement_oid.is_empty() {
            return Err("Failed to create replacement stash.".to_string());
        }

        Ok(replacement_oid)
    })();

    let cleanup_result = remove_temporary_worktree(repo_path, &temp_root_path, &worktree_path);

    match operation_result {
        Ok(replacement_oid) => {
            cleanup_result?;
            Ok(replacement_oid)
        }
        Err(error) => {
            let _ = cleanup_result;
            Err(error)
        }
    }
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

fn stable_hash_text(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    format!("{:x}", hasher.finalize())
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

fn create_temporary_directory(prefix: &str) -> Result<PathBuf, String> {
    let temp_dir = std::env::temp_dir();

    for _ in 0..32 {
        let candidate = temp_dir.join(format!(
            "git-chat-ui-{prefix}-{}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|error| error.to_string())?
                .as_nanos(),
            NEXT_TEMP_DIRECTORY_ID.fetch_add(1, Ordering::Relaxed)
        ));

        match fs::create_dir(&candidate) {
            Ok(()) => return Ok(candidate),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.to_string()),
        }
    }

    Err("Failed to create temporary directory.".to_string())
}

fn remove_temporary_worktree(
    repo_path: &str,
    temp_root_path: &Path,
    worktree_path: &Path,
) -> Result<(), String> {
    let worktree_path_str = worktree_path.to_string_lossy().to_string();
    let _ = run_git(
        &["worktree", "remove", "--force", worktree_path_str.as_str()],
        repo_path,
    );

    match fs::remove_dir_all(temp_root_path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn merge_branch_without_checkout(
    repo_path: &str,
    source_branch: &str,
    target_branch: &str,
) -> Result<ConflictOperationResult, String> {
    let temp_root_path = create_temporary_directory("merge")?;
    let worktree_path = temp_root_path.join("worktree");
    let worktree_path_str = worktree_path.to_string_lossy().to_string();
    let target_reference = format!("refs/heads/{target_branch}");
    let previous_target_oid = run_git(
        &["rev-parse", "--verify", target_reference.as_str()],
        repo_path,
    )?;

    if let Err(error) = run_git(
        &[
            "worktree",
            "add",
            "--detach",
            worktree_path_str.as_str(),
            target_branch,
        ],
        repo_path,
    ) {
        let _ = remove_temporary_worktree(repo_path, &temp_root_path, &worktree_path);
        return Err(error);
    }

    match run_git(&["merge", source_branch], worktree_path_str.as_str()) {
        Ok(_) => {
            let merged_target_oid = run_git(&["rev-parse", "HEAD"], worktree_path_str.as_str())?;
            if merged_target_oid != previous_target_oid {
                let args = vec![
                    "update-ref".to_string(),
                    "-m".to_string(),
                    format!("branch action merge {source_branch} into {target_branch}"),
                    target_reference.clone(),
                    merged_target_oid,
                    previous_target_oid.clone(),
                ];
                run_git_owned(&args, repo_path)?;
            }

            remove_temporary_worktree(repo_path, &temp_root_path, &worktree_path)?;
            Ok(ConflictOperationResult {
                ok: true,
                conflict: None,
            })
        }
        Err(error) if is_conflict_message(&error) => {
            let session = register_merge_session(MergeSession {
                id: String::new(),
                repo_path: repo_path.to_string(),
                temp_root_path: temp_root_path.clone(),
                worktree_path: worktree_path.clone(),
                source_branch: source_branch.to_string(),
                target_branch: target_branch.to_string(),
                previous_target_sha: previous_target_oid.clone(),
            })?;

            Ok(ConflictOperationResult {
                ok: false,
                conflict: Some(get_conflict_summary_for_context(
                    repo_path,
                    Some(session.id.as_str()),
                    Some(ConflictOperation::Merge),
                    Some(source_branch),
                    Some(target_branch),
                )?),
            })
        }
        Err(error) => {
            let _ = remove_temporary_worktree(repo_path, &temp_root_path, &worktree_path);
            Err(error)
        }
    }
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

fn resolve_repository_github_url(repo_path: &str) -> Option<String> {
    let remote_url = run_git(&["remote", "get-url", "origin"], repo_path).ok()?;
    normalize_github_remote_url(&remote_url)
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

fn resolve_pull_status_branch_name(
    repo_path: &str,
    branch_name: Option<&str>,
) -> Result<Option<String>, String> {
    if let Some(branch_name) = branch_name {
        let normalized = branch_name.trim();
        if !normalized.is_empty() {
            ensure_local_branch(repo_path, normalized)?;
            return Ok(Some(normalized.to_string()));
        }
    }

    let current_branch = get_current_branch(repo_path)?;
    if current_branch.trim().is_empty() || current_branch == "HEAD" {
        return Ok(None);
    }

    Ok(Some(current_branch))
}

fn parse_commit_count(value: &str) -> usize {
    value.trim().parse::<usize>().unwrap_or(0)
}

fn resolve_pull_status_state(ahead_count: usize, behind_count: usize) -> &'static str {
    if behind_count > 0 && ahead_count == 0 {
        return "behind";
    }

    if ahead_count > 0 && behind_count == 0 {
        return "ahead";
    }

    if ahead_count > 0 && behind_count > 0 {
        return "diverged";
    }

    "upToDate"
}

fn get_pull_status_for_branch(
    repo_path: &str,
    branch_name: Option<&str>,
) -> Result<PullStatusResponse, String> {
    ensure_repo_path(repo_path)?;

    let Some(resolved_branch_name) = resolve_pull_status_branch_name(repo_path, branch_name)?
    else {
        return Ok(detached_pull_status_response());
    };

    let Some(upstream_name) = get_branch_upstream(repo_path, &resolved_branch_name) else {
        return Ok(no_upstream_pull_status_response(resolved_branch_name));
    };

    let ahead_count = parse_commit_count(&run_git(
        &[
            "rev-list",
            "--count",
            &format!("{upstream_name}..{resolved_branch_name}"),
        ],
        repo_path,
    )?);
    let behind_count = parse_commit_count(&run_git(
        &[
            "rev-list",
            "--count",
            &format!("{resolved_branch_name}..{upstream_name}"),
        ],
        repo_path,
    )?);
    let state = resolve_pull_status_state(ahead_count, behind_count).to_string();
    let (remote_name, remote_branch_name) = parse_remote_branch_name(&upstream_name)
        .map(|(remote_name, remote_branch_name)| (Some(remote_name), Some(remote_branch_name)))
        .unwrap_or((None, None));

    Ok(PullStatusResponse {
        branch_name: Some(resolved_branch_name),
        upstream_name: Some(upstream_name),
        remote_name,
        remote_branch_name,
        ahead_count,
        behind_count,
        can_pull: state == "behind",
        state,
    })
}

fn fast_forward_branch_to_upstream(
    repo_path: &str,
    branch_name: &str,
    upstream_name: &str,
) -> Result<(), String> {
    let branch_head = run_git(
        &[
            "rev-parse",
            "--verify",
            &format!("refs/heads/{branch_name}"),
        ],
        repo_path,
    )?;
    let upstream_head = run_git(&["rev-parse", "--verify", upstream_name], repo_path)?;

    if branch_head == upstream_head {
        return Ok(());
    }

    if run_git(
        &["merge-base", "--is-ancestor", &branch_head, &upstream_head],
        repo_path,
    )
    .is_err()
    {
        return Err(format!(
            "Not possible to fast-forward, aborting. Local branch '{branch_name}' and upstream '{upstream_name}' have diverged."
        ));
    }

    let args = vec![
        "update-ref".to_string(),
        "-m".to_string(),
        format!("pull branch {branch_name} from {upstream_name}"),
        format!("refs/heads/{branch_name}"),
        upstream_head,
        branch_head,
    ];
    run_git_owned(&args, repo_path).map(|_| ())
}

fn pull_branch(repo_path: &str, branch_name: Option<&str>) -> Result<(), String> {
    ensure_repo_path(repo_path)?;

    let normalized_branch_name = branch_name.map(str::trim).filter(|value| !value.is_empty());
    let current_branch_name = get_current_branch(repo_path)?;
    let target_branch_name = normalized_branch_name.unwrap_or(current_branch_name.as_str());

    if target_branch_name.trim().is_empty() || target_branch_name == "HEAD" {
        return Err("Cannot pull while HEAD is detached.".to_string());
    }

    ensure_local_branch(repo_path, target_branch_name)?;

    let Some(upstream) = get_branch_upstream(repo_path, target_branch_name) else {
        return Err(format!(
            "Current branch '{target_branch_name}' has no upstream branch."
        ));
    };

    if current_branch_name == target_branch_name {
        let args = vec!["pull".to_string(), "--ff-only".to_string()];
        run_git_owned_with_env(
            &args,
            repo_path,
            &[("GIT_TERMINAL_PROMPT", "0".to_string())],
        )?;
        return Ok(());
    }

    if let Ok((remote_name, remote_branch_name)) = parse_remote_branch_name(&upstream) {
        let args = vec!["fetch".to_string(), remote_name, remote_branch_name];
        run_git_owned_with_env(
            &args,
            repo_path,
            &[("GIT_TERMINAL_PROMPT", "0".to_string())],
        )?;
    }

    let refreshed_status = get_pull_status_for_branch(repo_path, Some(target_branch_name))?;
    let Some(refreshed_upstream) = refreshed_status.upstream_name else {
        return Err(format!(
            "Current branch '{target_branch_name}' has no upstream branch."
        ));
    };

    if refreshed_status.state == "diverged" {
        return Err(format!(
            "Not possible to fast-forward, aborting. Local branch '{target_branch_name}' and upstream '{refreshed_upstream}' have diverged."
        ));
    }

    if refreshed_status.state != "behind" {
        return Ok(());
    }

    fast_forward_branch_to_upstream(repo_path, target_branch_name, &refreshed_upstream)
}

fn sync_upstream_tracking_ref_to_branch_head(
    repo_path: &str,
    branch_name: &str,
) -> Result<(), String> {
    let Some(upstream) = get_branch_upstream(repo_path, branch_name) else {
        return Ok(());
    };

    if parse_remote_branch_name(&upstream).is_err() {
        return Ok(());
    }

    let head = run_git(
        &[
            "rev-parse",
            "--verify",
            &format!("refs/heads/{branch_name}"),
        ],
        repo_path,
    )?;
    run_git(
        &[
            "update-ref",
            "-m",
            &format!("sync tracking ref for {branch_name}"),
            &format!("refs/remotes/{upstream}"),
            head.as_str(),
        ],
        repo_path,
    )?;

    Ok(())
}

fn sync_current_branch_upstream_tracking_ref(repo_path: &str) -> Result<(), String> {
    let branch_name = get_current_branch(repo_path)?;
    if branch_name.trim().is_empty() || branch_name == "HEAD" {
        return Ok(());
    }

    sync_upstream_tracking_ref_to_branch_head(repo_path, &branch_name)
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

    sync_upstream_tracking_ref_to_branch_head(repo_path, branch_name)?;

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

fn get_open_pull_requests(repo_path: &str) -> Result<HashMap<String, BranchPullRequest>, String> {
    if resolve_repository_github_url(repo_path).is_none() {
        return Ok(HashMap::new());
    }

    if ensure_github_auth(repo_path).is_err() {
        return Ok(HashMap::new());
    }

    let args = vec![
        "pr".to_string(),
        "list".to_string(),
        "--state".to_string(),
        "open".to_string(),
        "--limit".to_string(),
        "200".to_string(),
        "--json".to_string(),
        "headRefName,url,mergeable,mergeStateStatus".to_string(),
    ];
    let output = match run_gh_owned(&args, repo_path) {
        Ok(output) => output,
        Err(_) => return Ok(HashMap::new()),
    };

    if output.trim().is_empty() {
        return Ok(HashMap::new());
    }

    let parsed = serde_json::from_str::<Value>(&output).unwrap_or(Value::Null);
    let mut pull_requests = HashMap::new();

    if let Some(items) = parsed.as_array() {
        for item in items {
            let Some(head_ref_name) = item.get("headRefName").and_then(Value::as_str) else {
                continue;
            };
            let Some(url) = item.get("url").and_then(Value::as_str) else {
                continue;
            };

            let normalized_head_ref_name = head_ref_name.trim();
            let normalized_url = url.trim();
            if normalized_head_ref_name.is_empty()
                || normalized_url.is_empty()
                || pull_requests.contains_key(normalized_head_ref_name)
            {
                continue;
            }

            let mergeable = item
                .get("mergeable")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim()
                .to_uppercase();
            let merge_state_status = item
                .get("mergeStateStatus")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim()
                .to_uppercase();

            pull_requests.insert(
                normalized_head_ref_name.to_string(),
                BranchPullRequest {
                    url: normalized_url.to_string(),
                    has_conflicts: mergeable == "CONFLICTING" || merge_state_status == "DIRTY",
                },
            );
        }
    }

    Ok(pull_requests)
}

fn parse_github_viewer_response(raw: &str) -> RepositoryAssistantUserProfileResponse {
    let parsed = serde_json::from_str::<Value>(raw).unwrap_or(Value::Null);
    let login = parsed
        .get("login")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let avatar_url = parsed
        .get("avatar_url")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);

    RepositoryAssistantUserProfileResponse { login, avatar_url }
}

fn get_repository_assistant_user_profile_for_repo(
    repo_path: &str,
) -> Result<RepositoryAssistantUserProfileResponse, String> {
    ensure_repo_path(repo_path)?;

    match run_gh(&["api", "user", "--cache", "1h"], repo_path) {
        Ok(output) => Ok(parse_github_viewer_response(&output)),
        Err(_) => Ok(RepositoryAssistantUserProfileResponse {
            login: None,
            avatar_url: None,
        }),
    }
}

fn extract_url_from_text(text: &str) -> Option<String> {
    text.split_whitespace()
        .find(|token| token.starts_with("https://") || token.starts_with("http://"))
        .map(ToString::to_string)
}

fn status_code_label(code: &str) -> String {
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

fn is_unmerged_status(x: char, y: char) -> bool {
    matches!(
        (x, y),
        ('U', 'U') | ('A', 'A') | ('D', 'D') | ('A', 'U') | ('U', 'A') | ('D', 'U') | ('U', 'D')
    )
}

fn status_label(x: char, y: char) -> String {
    match (x, y) {
        ('U', 'U') => "Both Modified".to_string(),
        ('A', 'A') => "Both Added".to_string(),
        ('D', 'D') => "Both Deleted".to_string(),
        ('A', 'U') => "Added by Ours".to_string(),
        ('U', 'A') => "Added by Theirs".to_string(),
        ('D', 'U') => "Deleted by Ours".to_string(),
        ('U', 'D') => "Deleted by Theirs".to_string(),
        _ => {
            let code = if x != ' ' && x != '?' { x } else { y };
            status_code_label(&code.to_string())
        }
    }
}

fn diff_status_kind(code: char) -> CommitFileKind {
    match code {
        'A' => CommitFileKind::Added,
        'D' => CommitFileKind::Deleted,
        'M' => CommitFileKind::Modified,
        'R' => CommitFileKind::Renamed,
        _ => CommitFileKind::Changed,
    }
}

fn parse_diff_file_kinds(output: &str) -> Vec<(String, CommitFileKind)> {
    output
        .lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| {
            let mut parts = line.split('\t');
            let status_raw = parts.next()?.trim();
            let status_code = status_raw.chars().next()?;
            let paths: Vec<&str> = parts.collect();
            let file = match status_code {
                'R' | 'C' => paths.last().copied().unwrap_or(""),
                _ => paths.first().copied().unwrap_or(""),
            }
            .trim();

            if file.is_empty() {
                return None;
            }

            Some((file.to_string(), diff_status_kind(status_code)))
        })
        .collect()
}

fn parse_status_path(raw_path: &str) -> (Option<String>, String) {
    match raw_path.split_once(" -> ") {
        Some((left, right)) => (Some(left.to_string()), right.to_string()),
        None => (None, raw_path.to_string()),
    }
}

fn parse_commit_file_stats(output: &str, status_output: Option<&str>) -> Vec<CommitFileStat> {
    let stats: Vec<CommitFileStat> = output
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
                kind: CommitFileKind::Changed,
            })
        })
        .collect();

    let statuses = status_output.map(parse_diff_file_kinds).unwrap_or_default();
    if statuses.is_empty() {
        return stats;
    }

    if statuses.len() == stats.len() {
        return stats
            .into_iter()
            .enumerate()
            .map(|(index, stat)| {
                let (status_file, kind) = statuses
                    .get(index)
                    .cloned()
                    .unwrap_or((stat.file.clone(), CommitFileKind::Changed));

                CommitFileStat {
                    file: if status_file.trim().is_empty() {
                        stat.file
                    } else {
                        status_file
                    },
                    additions: stat.additions,
                    deletions: stat.deletions,
                    kind,
                }
            })
            .collect();
    }

    let kind_by_file: HashMap<String, CommitFileKind> = statuses.into_iter().collect();
    stats
        .into_iter()
        .map(|stat| CommitFileStat {
            kind: kind_by_file
                .get(&stat.file)
                .cloned()
                .unwrap_or(CommitFileKind::Changed),
            ..stat
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

fn resolve_working_tree_candidate_path(repo_path: &str, file: &str) -> Result<PathBuf, String> {
    let candidate = Path::new(file);
    if candidate.is_absolute()
        || candidate.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("file must stay within repository.".to_string());
    }

    Ok(Path::new(repo_path).join(candidate))
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
                kind: CommitFileKind::Added,
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
            kind: CommitFileKind::Added,
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

fn is_open_ai_reasoning_model(model: &str) -> bool {
    let normalized = model.trim().to_ascii_lowercase();
    normalized.starts_with("gpt-5")
        || normalized.starts_with("o1")
        || normalized.starts_with("o3")
        || normalized.starts_with("o4")
}

fn supports_non_reasoning_parameters_for_reasoning_model(model: &str) -> bool {
    model.trim().to_ascii_lowercase().starts_with("gpt-5.1")
}

fn should_include_open_ai_temperature(
    model: &str,
    reasoning_effort: OpenAiReasoningEffort,
) -> bool {
    if !is_open_ai_reasoning_model(model) {
        return true;
    }

    matches!(reasoning_effort, OpenAiReasoningEffort::NoneValue)
        && supports_non_reasoning_parameters_for_reasoning_model(model)
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

fn build_commit_generation_failure_message(results: &[ProviderAttemptResult]) -> String {
    let providers = results
        .iter()
        .map(|result| result.provider)
        .collect::<Vec<_>>()
        .join(" and ");
    let details = results
        .iter()
        .map(|result| {
            format!(
                "{}: {}",
                result.provider,
                result.error.as_deref().unwrap_or("Unknown failure.")
            )
        })
        .collect::<Vec<_>>()
        .join(" ");

    format!("Commit message generation failed for {providers}. {details}")
}

fn generate_with_openai(
    token: &str,
    model: &str,
    system_prompt: &str,
    changed_files: &[String],
    diff_snippet: &str,
) -> ProviderAttemptResult {
    let normalized_token = token.trim();
    if normalized_token.is_empty() {
        return ProviderAttemptResult {
            attempted: false,
            provider: "OpenAI",
            error: None,
            message: None,
        };
    }

    let prompt = generate_ai_user_prompt(changed_files, diff_snippet);

    let Some(json) = run_curl_json(
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
    ) else {
        return ProviderAttemptResult {
            attempted: true,
            provider: "OpenAI",
            error: Some("OpenAI request failed.".to_string()),
            message: None,
        };
    };

    if let Some(text) = json.get("output_text").and_then(Value::as_str) {
        if !text.trim().is_empty() {
            return ProviderAttemptResult {
                attempted: true,
                provider: "OpenAI",
                error: None,
                message: Some(text.to_string()),
            };
        }
    }

    let message = json
        .get("output")
        .and_then(Value::as_array)
        .and_then(|output| output.first())
        .and_then(|first| first.get("content"))
        .and_then(Value::as_array)
        .and_then(|content| content.first())
        .and_then(|item| item.get("text"))
        .and_then(Value::as_str)
        .and_then(|text| {
            if text.trim().is_empty() {
                None
            } else {
                Some(text.to_string())
            }
        });

    ProviderAttemptResult {
        attempted: true,
        provider: "OpenAI",
        error: if message.is_some() {
            None
        } else {
            Some("OpenAI API returned no text.".to_string())
        },
        message,
    }
}

fn generate_with_claude(
    token: &str,
    system_prompt: &str,
    changed_files: &[String],
    diff_snippet: &str,
) -> ProviderAttemptResult {
    if token.trim().is_empty() {
        return ProviderAttemptResult {
            attempted: false,
            provider: "Claude Code",
            error: None,
            message: None,
        };
    }

    let prompt = generate_ai_user_prompt(changed_files, diff_snippet);
    let mut failure_message = "Claude Code request failed.".to_string();

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
                        item.get("text").and_then(Value::as_str).and_then(|text| {
                            if text.trim().is_empty() {
                                None
                            } else {
                                Some(text.to_string())
                            }
                        })
                    } else {
                        None
                    }
                })
            })
        {
            return ProviderAttemptResult {
                attempted: true,
                provider: "Claude Code",
                error: None,
                message: Some(message),
            };
        }

        failure_message = "Claude Code API returned no text.".to_string();
    }

    ProviderAttemptResult {
        attempted: true,
        provider: "Claude Code",
        error: Some(failure_message),
        message: None,
    }
}

fn current_timestamp_millis() -> String {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_millis().to_string(),
        Err(_) => "0".to_string(),
    }
}

fn create_repository_assistant_message_id() -> String {
    format!(
        "assistant-{}-{}",
        std::process::id(),
        current_timestamp_millis()
    )
}

fn format_repository_assistant_working_files(items: &[WorkingFile], empty_label: &str) -> String {
    if items.is_empty() {
        return empty_label.to_string();
    }

    let visible_items = items
        .iter()
        .take(MAX_REPOSITORY_ASSISTANT_LIST_ITEMS)
        .map(|item| format!("{} ({})", item.file, item.status_label))
        .collect::<Vec<_>>();
    let remainder = items.len().saturating_sub(visible_items.len());

    if remainder > 0 {
        format!("{}, +{} more", visible_items.join(", "), remainder)
    } else {
        visible_items.join(", ")
    }
}

fn format_repository_assistant_branch_names(branches: &[Branch], empty_label: &str) -> String {
    if branches.is_empty() {
        return empty_label.to_string();
    }

    let visible_items = branches
        .iter()
        .take(MAX_REPOSITORY_ASSISTANT_LIST_ITEMS)
        .map(|branch| branch.name.clone())
        .collect::<Vec<_>>();
    let remainder = branches.len().saturating_sub(visible_items.len());

    if remainder > 0 {
        format!("{}, +{} more", visible_items.join(", "), remainder)
    } else {
        visible_items.join(", ")
    }
}

fn format_repository_assistant_commits(commits: &[CommitListItem]) -> String {
    if commits.is_empty() {
        return "No recent commits were loaded.".to_string();
    }

    commits
        .iter()
        .take(6)
        .map(|commit| {
            let short_sha: String = commit.sha.chars().take(7).collect();
            format!("- {} {} ({})", short_sha, commit.subject, commit.author)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn build_repository_assistant_context(repo_path: &str) -> Result<String, String> {
    let branches = get_branches(repo_path.to_string())?;
    let working_tree_status = get_working_tree_status(repo_path.to_string())?;
    let pull_status = get_pull_status(repo_path.to_string(), None).ok();
    let recent_commits = get_commits(repo_path.to_string(), None, None, 0, 6)?;
    let conflict_summary = get_conflict_summary(repo_path.to_string(), None).ok();

    let pull_line = match pull_status {
        Some(status) => match status.branch_name.as_deref() {
            Some(branch_name) => format!(
                "{} is {}{} (ahead {}, behind {}).",
                branch_name,
                status.state,
                status
                    .upstream_name
                    .as_deref()
                    .map(|upstream| format!(" against {}", upstream))
                    .unwrap_or_default(),
                status.ahead_count,
                status.behind_count
            ),
            None => "Pull status is unavailable or detached.".to_string(),
        },
        None => "Pull status is unavailable or detached.".to_string(),
    };

    let conflict_line = match conflict_summary {
        Some(summary) if !summary.files.is_empty() => format!(
            "{} conflicted files during {}{}: {}",
            summary.files.len(),
            match summary.operation {
                ConflictOperation::Merge => "merge",
                ConflictOperation::Pull => "pull",
                ConflictOperation::StashApply => "stashApply",
                ConflictOperation::StashPop => "stashPop",
                ConflictOperation::Unknown => "unknown",
            },
            match (&summary.source_branch, &summary.target_branch) {
                (Some(source), Some(target)) => format!(" ({} -> {})", source, target),
                _ => String::new(),
            },
            format_repository_assistant_working_files(&summary.files, "none")
        ),
        _ => "No active conflicts.".to_string(),
    };

    Ok([
        format!("Repository path: {}", repo_path),
        format!("Checked out branch: {}", branches.current),
        format!(
            "Local branches: {}",
            format_repository_assistant_branch_names(&branches.local, "none")
        ),
        format!(
            "Remote branches: {}",
            format_repository_assistant_branch_names(&branches.remote, "none")
        ),
        format!("Pull status: {}", pull_line),
        format!("Conflicts: {}", conflict_line),
        format!(
            "Staged files ({}): {}",
            working_tree_status.staged.len(),
            format_repository_assistant_working_files(&working_tree_status.staged, "none")
        ),
        format!(
            "Unstaged files ({}): {}",
            working_tree_status.unstaged.len(),
            format_repository_assistant_working_files(&working_tree_status.unstaged, "none")
        ),
        format!(
            "Recent commits:\n{}",
            format_repository_assistant_commits(&recent_commits.commits)
        ),
    ]
    .join("\n"))
}

fn describe_repository_assistant_action_args(action_id: &str) -> &'static str {
    match action_id {
        "git.stage_file" | "git.unstage_file" | "git.stash_file" => r#"{"file":"path/to/file"}"#,
        "git.checkout_ref" => r#"{"ref":"feature/name"}"#,
        "git.create_branch" => r#"{"baseBranch":"main","newBranch":"feature/name"}"#,
        "git.merge_branches" => r#"{"sourceBranch":"feature/name","targetBranch":"main"}"#,
        "git.pull_current_branch" => r#"{"branchName":"main"} or {}"#,
        "git.commit" => r#"{"title":"feat: summary","description":"- detail"}"#,
        "git.push" => "{}",
        "git.resolve_conflict_side" => {
            r#"{"file":"src/app.ts","side":"ours","sessionId":"session-1"}"#
        }
        "git.complete_merge_session" | "git.abort_merge_session" => r#"{"sessionId":"session-1"}"#,
        "git.apply_stash" | "git.pop_stash" => r#"{"stashId":"stash@{0}"}"#,
        "gh.pr.prepare" => r#"{"sourceBranch":"feature/name","targetBranch":"main"}"#,
        "gh.pr.create" => {
            r#"{"sourceBranch":"feature/name","targetBranch":"main","pushSourceBranch":true}"#
        }
        _ => "{}",
    }
}

fn build_repository_assistant_action_catalog_prompt() -> String {
    REPOSITORY_ASSISTANT_ACTION_SPECS
        .iter()
        .map(|spec| {
            format!(
                "- {}: {} group={} risk={} args={}",
                spec.id,
                spec.description,
                spec.group,
                spec.risk,
                describe_repository_assistant_action_args(spec.id)
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn build_repository_assistant_system_prompt(context: &str) -> String {
    [
        "You are Git Chat UI's repository assistant.",
        "Help the user understand and plan Git operations for the current repository.",
        "Be concrete, operational, and concise.",
        "Prefer the safest next action and call out destructive or conflict-prone steps.",
        "If the repository state is ambiguous, say what additional detail is needed.",
        "Do not invent repository state beyond the provided context.",
        "When proposing actions, use only the catalog below and only when the next step is clear enough to run after user approval.",
        "Return strict JSON only with this shape:",
        r#"{"message":"short markdown reply","proposedActions":[{"action":{"id":"git.stage_file","args":{"file":"src/app.ts"}},"reason":"why this is the next step"}]}"#,
        "If no action should be suggested, return an empty proposedActions array.",
        "Do not include markdown fences, commentary before JSON, or unknown action ids.",
        "Action catalog:",
        &build_repository_assistant_action_catalog_prompt(),
        "Repository context:",
        context,
    ]
    .join("\n\n")
}

fn normalize_trimmed_string_value(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn normalize_repository_assistant_action(
    action: &RepositoryAssistantAction,
) -> Option<RepositoryAssistantAction> {
    if !is_repository_assistant_action_id(&action.id) {
        return None;
    }

    let args = match &action.args {
        Value::Object(map) => map.clone(),
        Value::Null => serde_json::Map::new(),
        _ => return None,
    };

    match action.id.as_str() {
        "git.stage_file" | "git.unstage_file" | "git.stash_file" => {
            let file = normalize_trimmed_string_value(args.get("file"))?;
            Some(RepositoryAssistantAction {
                id: action.id.clone(),
                args: json!({ "file": file }),
            })
        }
        "git.checkout_ref" => {
            let reference = normalize_trimmed_string_value(args.get("ref"))?;
            Some(RepositoryAssistantAction {
                id: action.id.clone(),
                args: json!({ "ref": reference }),
            })
        }
        "git.create_branch" => {
            let base_branch = normalize_trimmed_string_value(args.get("baseBranch"))?;
            let new_branch = normalize_trimmed_string_value(args.get("newBranch"))?;
            Some(RepositoryAssistantAction {
                id: action.id.clone(),
                args: json!({
                    "baseBranch": base_branch,
                    "newBranch": new_branch,
                }),
            })
        }
        "git.merge_branches" => {
            let source_branch = normalize_trimmed_string_value(args.get("sourceBranch"))?;
            let target_branch = normalize_trimmed_string_value(args.get("targetBranch"))?;
            Some(RepositoryAssistantAction {
                id: action.id.clone(),
                args: json!({
                    "sourceBranch": source_branch,
                    "targetBranch": target_branch,
                }),
            })
        }
        "git.pull_current_branch" => {
            let branch_name = normalize_trimmed_string_value(args.get("branchName"));
            Some(RepositoryAssistantAction {
                id: action.id.clone(),
                args: match branch_name {
                    Some(branch_name) => json!({ "branchName": branch_name }),
                    None => json!({}),
                },
            })
        }
        "git.commit" => {
            let title = normalize_trimmed_string_value(args.get("title"))?;
            let description = args
                .get("description")
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or_default()
                .to_string();
            Some(RepositoryAssistantAction {
                id: action.id.clone(),
                args: json!({
                    "title": title,
                    "description": description,
                }),
            })
        }
        "git.push" => Some(RepositoryAssistantAction {
            id: action.id.clone(),
            args: json!({}),
        }),
        "git.resolve_conflict_side" => {
            let file = normalize_trimmed_string_value(args.get("file"))?;
            let side = match args.get("side").and_then(Value::as_str) {
                Some("merged" | "ours" | "theirs") => args
                    .get("side")
                    .and_then(Value::as_str)
                    .unwrap()
                    .to_string(),
                _ => return None,
            };
            let session_id = normalize_trimmed_string_value(args.get("sessionId"));
            Some(RepositoryAssistantAction {
                id: action.id.clone(),
                args: match session_id {
                    Some(session_id) => {
                        json!({ "file": file, "side": side, "sessionId": session_id })
                    }
                    None => json!({ "file": file, "side": side }),
                },
            })
        }
        "git.complete_merge_session" | "git.abort_merge_session" => {
            let session_id = normalize_trimmed_string_value(args.get("sessionId"))?;
            Some(RepositoryAssistantAction {
                id: action.id.clone(),
                args: json!({ "sessionId": session_id }),
            })
        }
        "git.apply_stash" | "git.pop_stash" => {
            let stash_id = normalize_trimmed_string_value(args.get("stashId"))?;
            Some(RepositoryAssistantAction {
                id: action.id.clone(),
                args: json!({ "stashId": stash_id }),
            })
        }
        "gh.pr.prepare" => {
            let source_branch = normalize_trimmed_string_value(args.get("sourceBranch"))?;
            let target_branch = normalize_trimmed_string_value(args.get("targetBranch"))?;
            Some(RepositoryAssistantAction {
                id: action.id.clone(),
                args: json!({
                    "sourceBranch": source_branch,
                    "targetBranch": target_branch,
                }),
            })
        }
        "gh.pr.create" => {
            let source_branch = normalize_trimmed_string_value(args.get("sourceBranch"))?;
            let target_branch = normalize_trimmed_string_value(args.get("targetBranch"))?;
            let push_source_branch = args.get("pushSourceBranch").and_then(Value::as_bool)?;
            Some(RepositoryAssistantAction {
                id: action.id.clone(),
                args: json!({
                    "sourceBranch": source_branch,
                    "targetBranch": target_branch,
                    "pushSourceBranch": push_source_branch,
                }),
            })
        }
        _ => None,
    }
}

fn extract_repository_assistant_structured_payload(raw_text: &str) -> Option<Value> {
    let trimmed = raw_text.trim();
    if trimmed.is_empty() {
        return None;
    }

    serde_json::from_str::<Value>(trimmed).ok().or_else(|| {
        let fence_start = trimmed.find("```")?;
        let fenced = &trimmed[(fence_start + 3)..];
        let fenced = fenced
            .strip_prefix("json")
            .or_else(|| fenced.strip_prefix("JSON"))
            .unwrap_or(fenced);
        let fenced = fenced.trim_start();
        let fence_end = fenced.rfind("```")?;
        serde_json::from_str::<Value>(fenced[..fence_end].trim()).ok()
    })
}

fn normalize_repository_assistant_proposals(
    value: Option<&Value>,
) -> Vec<RepositoryAssistantActionProposal> {
    let Some(Value::Array(items)) = value else {
        return Vec::new();
    };

    items
        .iter()
        .filter_map(|item| {
            let Value::Object(map) = item else {
                return None;
            };
            let action = map
                .get("action")
                .cloned()
                .and_then(|value| serde_json::from_value::<RepositoryAssistantAction>(value).ok())
                .and_then(|action| normalize_repository_assistant_action(&action))?;
            let reason = normalize_trimmed_string_value(map.get("reason"))?;
            let id = normalize_trimmed_string_value(map.get("id"))
                .unwrap_or_else(create_repository_assistant_message_id);

            Some(RepositoryAssistantActionProposal {
                id,
                action,
                reason,
                status: "proposed".to_string(),
                result: None,
            })
        })
        .collect()
}

fn parse_repository_assistant_response_payload(
    raw_text: &str,
) -> Option<(String, Vec<RepositoryAssistantActionProposal>)> {
    let Value::Object(map) = extract_repository_assistant_structured_payload(raw_text)? else {
        return None;
    };
    let message = normalize_trimmed_string_value(map.get("message"))?;
    let proposed_actions = normalize_repository_assistant_proposals(map.get("proposedActions"));

    Some((message, proposed_actions))
}

fn normalize_repository_assistant_messages(
    messages: &[RepositoryAssistantMessage],
) -> Vec<RepositoryAssistantMessage> {
    let mut normalized = messages
        .iter()
        .filter(|message| !message.content.trim().is_empty())
        .cloned()
        .collect::<Vec<_>>();
    if normalized.len() > MAX_REPOSITORY_ASSISTANT_MESSAGES {
        normalized.drain(0..(normalized.len() - MAX_REPOSITORY_ASSISTANT_MESSAGES));
    }

    normalized
}

fn chat_with_openai(
    token: &str,
    model: &str,
    reasoning_effort: OpenAiReasoningEffort,
    system_prompt: &str,
    messages: &[RepositoryAssistantMessage],
) -> Result<String, String> {
    let normalized_token = token.trim();
    if normalized_token.is_empty() {
        return Err(REPOSITORY_ASSISTANT_REQUIRES_OPENAI_ERROR.to_string());
    }

    let normalized_messages = normalize_repository_assistant_messages(messages);
    if normalized_messages.is_empty() {
        return Err("messages must include at least one non-empty user message.".to_string());
    }

    let input_messages = normalized_messages
        .iter()
        .map(|message| {
            json!({
                "role": message.role.as_str(),
                "content": message.content.trim(),
            })
        })
        .collect::<Vec<_>>();
    let mut input = vec![json!({
        "role": "system",
        "content": system_prompt
    })];
    input.extend(input_messages);
    let resolved_model = resolve_open_ai_model(model);
    let mut request_body = json!({
        "model": resolved_model,
        "max_output_tokens": 900,
        "input": input
    });

    if should_include_open_ai_temperature(&resolved_model, reasoning_effort) {
        request_body["temperature"] = json!(0.2);
    }

    if let Some(effort) = reasoning_effort.as_api_value() {
        request_body["reasoning"] = json!({
            "effort": effort
        });
    }

    let Some(json) = run_curl_json(
        "https://api.openai.com/v1/responses",
        &[
            format!("Authorization: Bearer {normalized_token}"),
            "Content-Type: application/json".to_string(),
        ],
        request_body,
    ) else {
        return Err("OpenAI request failed.".to_string());
    };

    if let Some(text) = json.get("output_text").and_then(Value::as_str) {
        if !text.trim().is_empty() {
            return Ok(text.trim().to_string());
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
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
        .ok_or_else(|| "OpenAI API returned no text.".to_string())
}

fn get_repository_assistant_action_spec(
    action_id: &str,
) -> Option<&'static RepositoryAssistantActionSpec> {
    REPOSITORY_ASSISTANT_ACTION_SPECS
        .iter()
        .find(|spec| spec.id == action_id)
}

fn create_repository_assistant_action_result(
    action: &RepositoryAssistantAction,
    status: &str,
    message: String,
    data: Option<Value>,
) -> RepositoryAssistantActionResult {
    RepositoryAssistantActionResult {
        action: action.clone(),
        status: status.to_string(),
        message,
        created_at: current_timestamp_millis(),
        data,
    }
}

fn format_repository_assistant_conflict_message(prefix: &str, file_count: usize) -> String {
    format!(
        "{} Conflicts require manual resolution ({} file{}).",
        prefix,
        file_count,
        if file_count == 1 { "" } else { "s" }
    )
}

fn is_self_repository_path(repo_path: &str) -> bool {
    let app_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    canonicalize_path_string(Path::new(repo_path))
        .zip(canonicalize_path_string(&app_root))
        .map(|(repo, root)| repo == root)
        .unwrap_or(false)
}

fn repository_assistant_self_repo_blocked_message(
    action: &RepositoryAssistantAction,
    label: &str,
) -> String {
    match action.id.as_str() {
        "git.merge_branches" => format!(
            "Repository assistant cannot run {} against git-chat-ui's own repository when the target branch is currently checked out while the app is running from that checkout.",
            label
        ),
        _ => format!(
            "Repository assistant cannot run {} against git-chat-ui's own repository while the app is running from that checkout.",
            label
        ),
    }
}

fn repository_assistant_action_touches_self_working_tree(
    repo_path: &str,
    action: &RepositoryAssistantAction,
    spec: &RepositoryAssistantActionSpec,
) -> Result<bool, String> {
    if !spec.mutates_working_tree || !is_self_repository_path(repo_path) {
        return Ok(false);
    }

    match action.id.as_str() {
        "git.merge_branches" => {
            let target_branch =
                repository_assistant_action_arg_required_string(action, "targetBranch")?;
            Ok(get_current_branch(repo_path)? == target_branch)
        }
        "git.resolve_conflict_side" => {
            Ok(repository_assistant_action_arg_optional_string(action, "sessionId").is_none())
        }
        "git.complete_merge_session" | "git.abort_merge_session" => Ok(false),
        _ => Ok(true),
    }
}

fn assert_repository_assistant_action_safe(
    repo_path: &str,
    action: &RepositoryAssistantAction,
) -> Result<(), String> {
    let Some(spec) = get_repository_assistant_action_spec(&action.id) else {
        return Err("action is invalid.".to_string());
    };

    if repository_assistant_action_touches_self_working_tree(repo_path, action, spec)? {
        return Err(repository_assistant_self_repo_blocked_message(
            action, spec.label,
        ));
    }

    Ok(())
}

fn repository_assistant_action_arg_required_string(
    action: &RepositoryAssistantAction,
    key: &str,
) -> Result<String, String> {
    action
        .args
        .as_object()
        .and_then(|args| args.get(key))
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .ok_or_else(|| "action is invalid.".to_string())
}

fn repository_assistant_action_arg_optional_string(
    action: &RepositoryAssistantAction,
    key: &str,
) -> Option<String> {
    action
        .args
        .as_object()
        .and_then(|args| args.get(key))
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn repository_assistant_action_arg_bool(
    action: &RepositoryAssistantAction,
    key: &str,
) -> Result<bool, String> {
    action
        .args
        .as_object()
        .and_then(|args| args.get(key))
        .and_then(Value::as_bool)
        .ok_or_else(|| "action is invalid.".to_string())
}

fn dispatch_repository_assistant_action(
    repo_path: &str,
    action: &RepositoryAssistantAction,
) -> Result<RepositoryAssistantActionResult, String> {
    match action.id.as_str() {
        "git.stage_file" => {
            let file = repository_assistant_action_arg_required_string(action, "file")?;
            stage_file(repo_path.to_string(), file.clone())?;
            Ok(create_repository_assistant_action_result(
                action,
                "succeeded",
                format!("Staged {}.", file),
                None,
            ))
        }
        "git.unstage_file" => {
            let file = repository_assistant_action_arg_required_string(action, "file")?;
            unstage_file(repo_path.to_string(), file.clone())?;
            Ok(create_repository_assistant_action_result(
                action,
                "succeeded",
                format!("Unstaged {}.", file),
                None,
            ))
        }
        "git.stash_file" => {
            let file = repository_assistant_action_arg_required_string(action, "file")?;
            stash_file(repo_path.to_string(), file.clone())?;
            Ok(create_repository_assistant_action_result(
                action,
                "succeeded",
                format!("Stashed {}.", file),
                None,
            ))
        }
        "git.checkout_ref" => {
            let reference = repository_assistant_action_arg_required_string(action, "ref")?;
            checkout(repo_path.to_string(), reference.clone())?;
            Ok(create_repository_assistant_action_result(
                action,
                "succeeded",
                format!("Checked out {}.", reference),
                None,
            ))
        }
        "git.create_branch" => {
            let base_branch =
                repository_assistant_action_arg_required_string(action, "baseBranch")?;
            let new_branch = repository_assistant_action_arg_required_string(action, "newBranch")?;
            create_branch(
                repo_path.to_string(),
                base_branch.clone(),
                new_branch.clone(),
            )?;
            Ok(create_repository_assistant_action_result(
                action,
                "succeeded",
                format!(
                    "Created and checked out {} from {}.",
                    new_branch, base_branch
                ),
                None,
            ))
        }
        "git.merge_branches" => {
            let source_branch =
                repository_assistant_action_arg_required_string(action, "sourceBranch")?;
            let target_branch =
                repository_assistant_action_arg_required_string(action, "targetBranch")?;
            let result = merge_branches(
                repo_path.to_string(),
                source_branch.clone(),
                target_branch.clone(),
            )?;
            if !result.ok {
                let data = serde_json::to_value(&result).ok();
                let file_count = result
                    .conflict
                    .as_ref()
                    .map(|conflict| conflict.files.len())
                    .unwrap_or(0);
                return Ok(create_repository_assistant_action_result(
                    action,
                    "failed",
                    format_repository_assistant_conflict_message(
                        &format!(
                            "Merge from {} into {} started.",
                            source_branch, target_branch
                        ),
                        file_count,
                    ),
                    data,
                ));
            }

            Ok(create_repository_assistant_action_result(
                action,
                "succeeded",
                format!("Merged {} into {}.", source_branch, target_branch),
                None,
            ))
        }
        "git.pull_current_branch" => {
            let branch_name = repository_assistant_action_arg_optional_string(action, "branchName");
            pull_current_branch(repo_path.to_string(), branch_name.clone())?;
            Ok(create_repository_assistant_action_result(
                action,
                "succeeded",
                match branch_name {
                    Some(branch_name) => {
                        format!("Pulled upstream changes into {}.", branch_name)
                    }
                    None => "Pulled upstream changes into the current branch.".to_string(),
                },
                None,
            ))
        }
        "git.commit" => {
            let title = repository_assistant_action_arg_required_string(action, "title")?;
            let description =
                repository_assistant_action_arg_required_string(action, "description")
                    .unwrap_or_default();
            commit(repo_path.to_string(), title.clone(), description)?;
            Ok(create_repository_assistant_action_result(
                action,
                "succeeded",
                format!("Committed: {}", title),
                None,
            ))
        }
        "git.push" => {
            push(repo_path.to_string())?;
            Ok(create_repository_assistant_action_result(
                action,
                "succeeded",
                "Pushed the current branch.".to_string(),
                None,
            ))
        }
        "git.resolve_conflict_side" => {
            let file = repository_assistant_action_arg_required_string(action, "file")?;
            let side =
                match repository_assistant_action_arg_required_string(action, "side")?.as_str() {
                    "merged" => ConflictResolutionSide::Merged,
                    "ours" => ConflictResolutionSide::Ours,
                    "theirs" => ConflictResolutionSide::Theirs,
                    _ => return Err("action is invalid.".to_string()),
                };
            let session_id = repository_assistant_action_arg_optional_string(action, "sessionId");
            let side_label = match side {
                ConflictResolutionSide::Merged => "merged",
                ConflictResolutionSide::Ours => "ours",
                ConflictResolutionSide::Theirs => "theirs",
            };
            resolve_conflict_version(repo_path.to_string(), file.clone(), side, session_id)?;
            Ok(create_repository_assistant_action_result(
                action,
                "succeeded",
                format!("Resolved {} using {}.", file, side_label),
                None,
            ))
        }
        "git.complete_merge_session" => {
            let session_id = repository_assistant_action_arg_required_string(action, "sessionId")?;
            complete_merge_session(repo_path.to_string(), session_id)?;
            Ok(create_repository_assistant_action_result(
                action,
                "succeeded",
                "Completed the merge session.".to_string(),
                None,
            ))
        }
        "git.abort_merge_session" => {
            let session_id = repository_assistant_action_arg_required_string(action, "sessionId")?;
            abort_merge_session(repo_path.to_string(), session_id)?;
            Ok(create_repository_assistant_action_result(
                action,
                "succeeded",
                "Aborted the merge session.".to_string(),
                None,
            ))
        }
        "git.apply_stash" => {
            let stash_id = repository_assistant_action_arg_required_string(action, "stashId")?;
            let result = apply_stash(repo_path.to_string(), stash_id.clone())?;
            if !result.ok {
                let data = serde_json::to_value(&result).ok();
                let file_count = result
                    .conflict
                    .as_ref()
                    .map(|conflict| conflict.files.len())
                    .unwrap_or(0);
                return Ok(create_repository_assistant_action_result(
                    action,
                    "failed",
                    format_repository_assistant_conflict_message(
                        &format!("Applied {}.", stash_id),
                        file_count,
                    ),
                    data,
                ));
            }

            Ok(create_repository_assistant_action_result(
                action,
                "succeeded",
                format!("Applied {}.", stash_id),
                None,
            ))
        }
        "git.pop_stash" => {
            let stash_id = repository_assistant_action_arg_required_string(action, "stashId")?;
            let result = pop_stash(repo_path.to_string(), stash_id.clone())?;
            if !result.ok {
                let data = serde_json::to_value(&result).ok();
                let file_count = result
                    .conflict
                    .as_ref()
                    .map(|conflict| conflict.files.len())
                    .unwrap_or(0);
                return Ok(create_repository_assistant_action_result(
                    action,
                    "failed",
                    format_repository_assistant_conflict_message(
                        &format!("Popped {}.", stash_id),
                        file_count,
                    ),
                    data,
                ));
            }

            Ok(create_repository_assistant_action_result(
                action,
                "succeeded",
                format!("Popped {}.", stash_id),
                None,
            ))
        }
        "gh.pr.prepare" => {
            let source_branch =
                repository_assistant_action_arg_required_string(action, "sourceBranch")?;
            let target_branch =
                repository_assistant_action_arg_required_string(action, "targetBranch")?;
            let result =
                prepare_pull_request(repo_path.to_string(), source_branch.clone(), target_branch)?;
            let message = if result.push_required {
                format!(
                    "{} needs a push before creating the pull request.",
                    source_branch
                )
            } else {
                format!("{} is ready for pull request creation.", source_branch)
            };
            Ok(create_repository_assistant_action_result(
                action,
                "succeeded",
                message,
                serde_json::to_value(&result).ok(),
            ))
        }
        "gh.pr.create" => {
            let source_branch =
                repository_assistant_action_arg_required_string(action, "sourceBranch")?;
            let target_branch =
                repository_assistant_action_arg_required_string(action, "targetBranch")?;
            let push_source_branch =
                repository_assistant_action_arg_bool(action, "pushSourceBranch")?;
            let result = create_pull_request(
                repo_path.to_string(),
                source_branch,
                target_branch,
                push_source_branch,
            )?;
            let url = result.url.clone();
            Ok(create_repository_assistant_action_result(
                action,
                "succeeded",
                format!("Created pull request: {}", url),
                serde_json::to_value(&result).ok(),
            ))
        }
        _ => Err("action is invalid.".to_string()),
    }
}

fn generate_commit_title_internal(
    config: &AppConfig,
    changed_files: &[String],
    diff_snippet: &str,
) -> Result<TitleResponse, String> {
    let changed_files = changed_files
        .iter()
        .map(|file| file.trim().to_string())
        .filter(|file| !file.is_empty())
        .collect::<Vec<_>>();
    if changed_files.is_empty() {
        return Err(NO_STAGED_CHANGES_ERROR.to_string());
    }

    let fallback = build_heuristic_title(&changed_files);
    let limited_diff: String = diff_snippet.chars().take(4000).collect();
    let system_prompt = resolve_commit_title_prompt(&config.commit_title_prompt);

    let provider_result = match config.selected_ai_provider {
        AiProvider::OpenAi => generate_with_openai(
            &config.open_ai_token,
            &config.open_ai_model,
            &system_prompt,
            &changed_files,
            &limited_diff,
        ),
        AiProvider::ClaudeCode => generate_with_claude(
            &config.claude_code_token,
            &system_prompt,
            &changed_files,
            &limited_diff,
        ),
    };

    if let Some(message) = provider_result.message.as_deref() {
        return Ok(normalize_generated_commit_message(message, &fallback));
    }

    if !provider_result.attempted {
        return Err(NO_AI_PROVIDER_ERROR.to_string());
    }

    Err(build_commit_generation_failure_message(&[provider_result]))
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
    Ok(RepositoryGithubUrlResponse {
        url: resolve_repository_github_url(&repo_path),
    })
}

#[tauri::command]
pub fn get_repository_assistant_user_profile(
    repo_path: String,
) -> Result<RepositoryAssistantUserProfileResponse, String> {
    get_repository_assistant_user_profile_for_repo(&repo_path)
}

#[tauri::command]
pub fn get_branch_pull_requests(repo_path: String) -> Result<BranchPullRequestsResponse, String> {
    ensure_repo_path(&repo_path)?;
    Ok(BranchPullRequestsResponse {
        pull_requests: get_open_pull_requests(&repo_path)?,
    })
}

#[tauri::command]
pub fn get_repository_mutation_safety(
    repo_path: String,
) -> Result<RepositoryMutationSafetyResponse, String> {
    ensure_repo_path(&repo_path)?;

    Ok(RepositoryMutationSafetyResponse {
        is_self_repository: is_self_repository_path(&repo_path),
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
pub fn get_commit_author_avatars(
    repo_path: String,
    ref_name: Option<String>,
    shas: Vec<String>,
    allow_remote_fetch: bool,
) -> Result<CommitAuthorAvatarsResponse, String> {
    ensure_repo_path(&repo_path)?;

    let mut seen = HashSet::new();
    let requested_shas: Vec<String> = shas
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty() && seen.insert(value.clone()))
        .collect();

    if requested_shas.is_empty() {
        return Ok(CommitAuthorAvatarsResponse {
            avatars: HashMap::new(),
        });
    }

    let repository_url = resolve_repository_github_url(&repo_path);
    let repo_key = repository_url.clone().unwrap_or_else(|| repo_path.clone());
    let mut manifest = read_commit_avatar_manifest(&repo_key);

    if allow_remote_fetch {
        if let Some(repository_url) = repository_url.as_deref() {
            if let Some((owner, name)) = parse_github_repository_slug(repository_url) {
                if ensure_github_auth(&repo_path).is_ok() {
                    if let Ok(history_ref) =
                        resolve_github_history_ref(&repo_path, ref_name.as_deref())
                    {
                        if let Ok(commit_avatar_urls) =
                            fetch_github_commit_avatar_urls(&repo_path, &owner, &name, &history_ref)
                        {
                            let mut changed = false;

                            for (sha, avatar_url) in commit_avatar_urls {
                                let image_key = stable_hash_text(&avatar_url);
                                if persist_commit_avatar_image(
                                    &image_key,
                                    &avatar_url,
                                    &mut manifest,
                                )
                                .is_ok()
                                {
                                    manifest
                                        .commits
                                        .insert(sha, CommitAvatarCommitEntry { image_key });
                                    changed = true;
                                }
                            }

                            if changed {
                                let _ = write_commit_avatar_manifest(&repo_key, &manifest);
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(CommitAuthorAvatarsResponse {
        avatars: build_commit_author_avatar_sources(&manifest, &requested_shas),
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
    let file_status_raw = run_git(
        &["show", "--pretty=format:", "--name-status", &sha],
        &repo_path,
    )?;
    let files = parse_commit_file_stats(&file_stats_raw, Some(&file_status_raw));

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
pub fn get_commit_file_diff_detail(
    repo_path: String,
    sha: String,
    file: String,
) -> Result<CommitFileDiffDetail, String> {
    ensure_repo_path(&repo_path)?;

    let sha = sha.trim().to_string();
    let file = file.trim().to_string();

    if sha.is_empty() {
        return Err("sha is required.".to_string());
    }

    if file.is_empty() {
        return Err("file is required.".to_string());
    }

    let diff = run_git(
        &[
            "show",
            "--pretty=format:",
            sha.as_str(),
            "--",
            file.as_str(),
        ],
        &repo_path,
    )?;
    let is_diff_truncated = diff.chars().count() > 25_000;

    Ok(CommitFileDiffDetail {
        sha,
        file,
        diff: diff.chars().take(25_000).collect(),
        is_diff_truncated,
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
    let file_status_raw = run_git(&["diff", "--name-status", range.as_str()], &repo_path)?;
    let files = parse_commit_file_stats(&file_stats_raw, Some(&file_status_raw));

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
pub fn get_branch_diff_file_detail(
    repo_path: String,
    base_ref: String,
    target_ref: String,
    file: String,
) -> Result<BranchDiffFileDetail, String> {
    ensure_repo_path(&repo_path)?;

    let base_ref = base_ref.trim().to_string();
    let target_ref = target_ref.trim().to_string();
    let file = file.trim().to_string();

    if base_ref.is_empty() {
        return Err("baseRef is required.".to_string());
    }

    if target_ref.is_empty() {
        return Err("targetRef is required.".to_string());
    }

    if file.is_empty() {
        return Err("file is required.".to_string());
    }

    let merge_base_sha = run_git(
        &["merge-base", base_ref.as_str(), target_ref.as_str()],
        &repo_path,
    )?;
    let range = format!("{merge_base_sha}..{target_ref}");
    let diff = run_git(&["diff", range.as_str(), "--", file.as_str()], &repo_path)?;
    let is_diff_truncated = diff.chars().count() > 25_000;

    Ok(BranchDiffFileDetail {
        base_ref,
        target_ref,
        file,
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
    let mut name_status_args = working_tree_diff_args(&area, Some("--name-status"))?;
    name_status_args.push("--".to_string());
    name_status_args.push(file.clone());
    let file_status_output = run_git_owned(&name_status_args, &repo_path)?;
    let mut files = parse_commit_file_stats(&file_stats_output, Some(&file_status_output));

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
    ensure_repo_path(&repo_path)?;
    let output = run_git(&["status", "--porcelain=v1", "-uall"], &repo_path)?;
    let mut conflicted = Vec::new();
    let mut staged = Vec::new();
    let mut unstaged = Vec::new();

    for line in output.lines() {
        let Some(entry) = parse_working_tree_status_entry(line) else {
            continue;
        };

        let item = WorkingFile {
            file: entry.file.clone(),
            x: entry.x.to_string(),
            y: entry.y.to_string(),
            status_label: status_label(entry.x, entry.y),
        };

        if is_unmerged_status(entry.x, entry.y) {
            conflicted.push(item);
            continue;
        }

        if entry.x != ' ' && entry.x != '?' {
            staged.push(WorkingFile {
                file: entry.file.clone(),
                x: entry.x.to_string(),
                y: entry.y.to_string(),
                status_label: item.status_label.clone(),
            });
        }

        if entry.y != ' ' || entry.x == '?' {
            unstaged.push(WorkingFile {
                file: entry.file,
                x: entry.x.to_string(),
                y: entry.y.to_string(),
                status_label: item.status_label,
            });
        }
    }

    conflicted.sort_by(|left, right| left.file.cmp(&right.file));
    staged.sort_by(|left, right| left.file.cmp(&right.file));
    unstaged.sort_by(|left, right| left.file.cmp(&right.file));

    Ok(WorkingTreeStatus {
        conflicted,
        staged,
        unstaged,
    })
}

#[tauri::command]
pub fn get_conflict_summary(
    repo_path: String,
    session_id: Option<String>,
) -> Result<ConflictSummary, String> {
    get_conflict_summary_for_context(&repo_path, session_id.as_deref(), None, None, None)
}

#[tauri::command]
pub fn get_conflict_file_detail(
    repo_path: String,
    file: String,
    session_id: Option<String>,
) -> Result<ConflictFileDetail, String> {
    let normalized_file = file.trim().to_string();
    if normalized_file.is_empty() {
        return Err("file is required.".to_string());
    }

    let context = resolve_conflict_context(&repo_path, session_id.as_deref())?;
    let status = get_conflict_file_status(&context.worktree_path, &normalized_file)?
        .ok_or_else(|| format!("'{}' is not a conflicted file.", normalized_file))?;

    Ok(ConflictFileDetail {
        file: normalized_file.clone(),
        x: status.x,
        y: status.y,
        status_label: status.status_label,
        merged: map_conflict_buffer_to_version(read_merged_buffer(
            &context.worktree_path,
            &normalized_file,
        )?),
        base: map_conflict_buffer_to_version(read_stage_buffer(
            &context.worktree_path,
            1,
            &normalized_file,
        )?),
        ours: map_conflict_buffer_to_version(read_stage_buffer(
            &context.worktree_path,
            2,
            &normalized_file,
        )?),
        theirs: map_conflict_buffer_to_version(read_stage_buffer(
            &context.worktree_path,
            3,
            &normalized_file,
        )?),
    })
}

#[tauri::command]
pub fn resolve_conflict_version(
    repo_path: String,
    file: String,
    side: ConflictResolutionSide,
    session_id: Option<String>,
) -> Result<OkResponse, String> {
    let normalized_file = file.trim().to_string();
    if normalized_file.is_empty() {
        return Err("file is required.".to_string());
    }

    let context = resolve_conflict_context(&repo_path, session_id.as_deref())?;
    if get_conflict_file_status(&context.worktree_path, &normalized_file)?.is_none() {
        return Err(format!("'{}' is not a conflicted file.", normalized_file));
    }

    stage_conflict_resolution(&context.worktree_path, &normalized_file, side)?;
    Ok(OkResponse { ok: true })
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

#[derive(Debug, Clone)]
struct WorkingTreeFileStatusEntryRecord {
    file: String,
    previous_file: Option<String>,
    x: char,
    y: char,
}

#[derive(Debug, Clone)]
struct ConflictContext {
    worktree_path: String,
    context_type: ConflictContextType,
    operation: ConflictOperation,
    session_id: Option<String>,
    source_branch: Option<String>,
    target_branch: Option<String>,
}

fn parse_working_tree_status_entry(line: &str) -> Option<WorkingTreeFileStatusEntryRecord> {
    if line.trim().is_empty() {
        return None;
    }

    let x = line.chars().nth(0).unwrap_or(' ');
    let y = line.chars().nth(1).unwrap_or(' ');
    let raw_path = line.get(3..).unwrap_or("").trim();
    if raw_path.is_empty() {
        return None;
    }

    let (previous_file, file) = parse_status_path(raw_path);
    if file.is_empty() {
        return None;
    }

    Some(WorkingTreeFileStatusEntryRecord {
        file,
        previous_file,
        x,
        y,
    })
}

fn create_merge_session_id() -> String {
    format!(
        "merge-session-{}-{}",
        current_timestamp(),
        NEXT_MERGE_SESSION_ID.fetch_add(1, Ordering::Relaxed) + 1
    )
}

fn register_merge_session(mut session: MergeSession) -> Result<MergeSession, String> {
    session.id = create_merge_session_id();
    let mut sessions = MERGE_SESSIONS
        .lock()
        .map_err(|_| "Failed to lock merge session registry.".to_string())?;
    sessions.insert(session.id.clone(), session.clone());
    Ok(session)
}

fn get_merge_session(session_id: &str) -> Result<MergeSession, String> {
    let sessions = MERGE_SESSIONS
        .lock()
        .map_err(|_| "Failed to lock merge session registry.".to_string())?;
    sessions
        .get(session_id)
        .cloned()
        .ok_or_else(|| format!("Merge session '{session_id}' was not found."))
}

fn remove_merge_session(session_id: &str) -> Result<Option<MergeSession>, String> {
    let mut sessions = MERGE_SESSIONS
        .lock()
        .map_err(|_| "Failed to lock merge session registry.".to_string())?;
    Ok(sessions.remove(session_id))
}

fn get_working_tree_file_status_entry(
    repo_path: &str,
    file: &str,
) -> Result<Option<WorkingTreeFileStatusEntryRecord>, String> {
    let args = vec![
        "status".to_string(),
        "--porcelain=v1".to_string(),
        "-uall".to_string(),
        "--".to_string(),
        file.to_string(),
    ];
    let output = run_git_owned(&args, repo_path)?;

    for line in output.lines() {
        if let Some(entry) = parse_working_tree_status_entry(line) {
            if entry.file == file {
                return Ok(Some(entry));
            }
        }
    }

    Ok(None)
}

fn list_conflict_files(worktree_path: &str) -> Result<Vec<WorkingFile>, String> {
    let output = run_git(&["status", "--porcelain=v1", "-uall"], worktree_path)?;
    let mut files: Vec<WorkingFile> = output
        .lines()
        .filter_map(parse_working_tree_status_entry)
        .filter(|entry| is_unmerged_status(entry.x, entry.y))
        .map(|entry| WorkingFile {
            file: entry.file,
            x: entry.x.to_string(),
            y: entry.y.to_string(),
            status_label: status_label(entry.x, entry.y),
        })
        .collect();
    files.sort_by(|left, right| left.file.cmp(&right.file));
    Ok(files)
}

fn is_missing_stage_error(message: &str) -> bool {
    let normalized = message.to_ascii_lowercase();
    normalized.contains("does not exist (neither on disk nor in the index)")
        || normalized.contains("exists on disk, but not in")
        || normalized.contains("not at stage ")
        || normalized.contains("does not have our version")
        || normalized.contains("does not have their version")
}

fn map_conflict_buffer_to_version(buffer: Option<Vec<u8>>) -> ConflictFileVersion {
    match buffer {
        None => ConflictFileVersion {
            is_binary: false,
            content: None,
        },
        Some(buffer) if buffer.contains(&0) => ConflictFileVersion {
            is_binary: true,
            content: None,
        },
        Some(buffer) => ConflictFileVersion {
            is_binary: false,
            content: Some(
                String::from_utf8_lossy(&buffer)
                    .replace("\r\n", "\n")
                    .replace('\r', "\n"),
            ),
        },
    }
}

fn read_stage_buffer(
    worktree_path: &str,
    stage: u8,
    file: &str,
) -> Result<Option<Vec<u8>>, String> {
    let stage_spec = format!(":{stage}:{file}");
    match run_git_buffer(&["show", stage_spec.as_str()], worktree_path) {
        Ok(buffer) => Ok(Some(buffer)),
        Err(error) if is_missing_stage_error(&error) => Ok(None),
        Err(error) => Err(error),
    }
}

fn read_merged_buffer(worktree_path: &str, file: &str) -> Result<Option<Vec<u8>>, String> {
    let absolute_path = resolve_working_tree_candidate_path(worktree_path, file)?;
    match fs::read(absolute_path) {
        Ok(buffer) => Ok(Some(buffer)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn detect_repository_conflict_operation(worktree_path: &str) -> ConflictOperation {
    match resolve_git_path(worktree_path, "MERGE_HEAD") {
        Ok(path) if path.exists() => ConflictOperation::Merge,
        _ => ConflictOperation::Unknown,
    }
}

fn resolve_conflict_context(
    repo_path: &str,
    session_id: Option<&str>,
) -> Result<ConflictContext, String> {
    ensure_repo_path(repo_path)?;

    let normalized_session_id = session_id.unwrap_or("").trim();
    if normalized_session_id.is_empty() {
        return Ok(ConflictContext {
            worktree_path: repo_path.to_string(),
            context_type: ConflictContextType::Repository,
            operation: detect_repository_conflict_operation(repo_path),
            session_id: None,
            source_branch: None,
            target_branch: None,
        });
    }

    let session = get_merge_session(normalized_session_id)?;
    if session.repo_path != repo_path {
        return Err(format!(
            "Merge session '{}' does not belong to this repository.",
            normalized_session_id
        ));
    }

    Ok(ConflictContext {
        worktree_path: session.worktree_path.to_string_lossy().to_string(),
        context_type: ConflictContextType::MergeSession,
        operation: ConflictOperation::Merge,
        session_id: Some(session.id),
        source_branch: Some(session.source_branch),
        target_branch: Some(session.target_branch),
    })
}

fn get_conflict_summary_for_context(
    repo_path: &str,
    session_id: Option<&str>,
    operation: Option<ConflictOperation>,
    source_branch: Option<&str>,
    target_branch: Option<&str>,
) -> Result<ConflictSummary, String> {
    let context = resolve_conflict_context(repo_path, session_id)?;

    Ok(ConflictSummary {
        context_type: context.context_type,
        operation: operation.unwrap_or(context.operation),
        session_id: context.session_id,
        source_branch: source_branch
            .map(ToString::to_string)
            .or(context.source_branch),
        target_branch: target_branch
            .map(ToString::to_string)
            .or(context.target_branch),
        files: list_conflict_files(&context.worktree_path)?,
    })
}

fn get_conflict_file_status(
    worktree_path: &str,
    file: &str,
) -> Result<Option<WorkingFile>, String> {
    let output = run_git(
        &["status", "--porcelain=v1", "-uall", "--", file],
        worktree_path,
    )?;

    for line in output.lines() {
        if let Some(entry) = parse_working_tree_status_entry(line) {
            if entry.file == file && is_unmerged_status(entry.x, entry.y) {
                return Ok(Some(WorkingFile {
                    file: entry.file,
                    x: entry.x.to_string(),
                    y: entry.y.to_string(),
                    status_label: status_label(entry.x, entry.y),
                }));
            }
        }
    }

    Ok(None)
}

fn stage_conflict_resolution(
    worktree_path: &str,
    file: &str,
    side: ConflictResolutionSide,
) -> Result<(), String> {
    if side == ConflictResolutionSide::Merged {
        run_git(&["add", "--", file], worktree_path)?;
        return Ok(());
    }

    let (flag, stage) = match side {
        ConflictResolutionSide::Ours => ("--ours", 2),
        ConflictResolutionSide::Theirs => ("--theirs", 3),
        ConflictResolutionSide::Merged => unreachable!("merged resolution returns early"),
    };

    if read_stage_buffer(worktree_path, stage, file)?.is_some() {
        run_git(&["checkout", flag, "--", file], worktree_path)?;
        run_git(&["add", "--", file], worktree_path)?;
        return Ok(());
    }

    remove_working_tree_path(worktree_path, file)?;
    run_git(&["add", "--", file], worktree_path)?;
    Ok(())
}

fn is_conflict_message(message: &str) -> bool {
    let normalized = message.to_ascii_lowercase();
    normalized.contains("merge conflict") || normalized.contains("conflict")
}

fn path_exists_in_head(repo_path: &str, file: &str) -> bool {
    let args = vec![
        "ls-tree".to_string(),
        "-r".to_string(),
        "--name-only".to_string(),
        "HEAD".to_string(),
        "--".to_string(),
        file.to_string(),
    ];

    run_git_owned(&args, repo_path)
        .map(|output| output.lines().any(|line| line.trim() == file))
        .unwrap_or(false)
}

fn remove_working_tree_path(repo_path: &str, file: &str) -> Result<(), String> {
    let absolute_path = Path::new(repo_path).join(file);
    match fs::symlink_metadata(&absolute_path) {
        Ok(metadata) => {
            if metadata.is_dir() {
                fs::remove_dir_all(&absolute_path).map_err(|error| error.to_string())
            } else {
                fs::remove_file(&absolute_path).map_err(|error| error.to_string())
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn restore_paths_from_head(
    repo_path: &str,
    files: &[String],
    head_paths: &[String],
) -> Result<(), String> {
    let mut restore_args = vec![
        "restore".to_string(),
        "--source=HEAD".to_string(),
        "--staged".to_string(),
        "--worktree".to_string(),
        "--".to_string(),
    ];
    restore_args.extend(files.iter().cloned());

    if run_git_owned(&restore_args, repo_path).is_ok() {
        return Ok(());
    }

    let mut reset_args = vec!["reset".to_string(), "HEAD".to_string(), "--".to_string()];
    reset_args.extend(files.iter().cloned());
    run_git_owned(&reset_args, repo_path)?;

    if !head_paths.is_empty() {
        let mut checkout_args = vec!["checkout".to_string(), "--".to_string()];
        checkout_args.extend(head_paths.iter().cloned());
        run_git_owned(&checkout_args, repo_path)?;
    }

    for file in files {
        if !head_paths.iter().any(|head_path| head_path == file) {
            remove_working_tree_path(repo_path, file)?;
        }
    }

    Ok(())
}

fn remove_paths_from_index_and_working_tree(
    repo_path: &str,
    files: &[String],
) -> Result<(), String> {
    let mut remove_args = vec![
        "rm".to_string(),
        "--cached".to_string(),
        "--force".to_string(),
        "--".to_string(),
    ];
    remove_args.extend(files.iter().cloned());
    run_git_owned(&remove_args, repo_path)?;

    for file in files {
        remove_working_tree_path(repo_path, file)?;
    }

    Ok(())
}

#[tauri::command]
pub fn discard_file(repo_path: String, file: String) -> Result<OkResponse, String> {
    ensure_repo_path(&repo_path)?;

    let normalized_file = file.trim().to_string();
    if normalized_file.is_empty() {
        return Err("file is required.".to_string());
    }

    let Some(entry) = get_working_tree_file_status_entry(&repo_path, &normalized_file)? else {
        return Ok(OkResponse { ok: true });
    };

    if entry.x == '?' && entry.y == '?' {
        remove_working_tree_path(&repo_path, &entry.file)?;
        return Ok(OkResponse { ok: true });
    }

    let restore_paths = match entry.previous_file {
        Some(previous_file) => vec![previous_file, entry.file.clone()],
        None => vec![entry.file.clone()],
    };
    let head_paths: Vec<String> = restore_paths
        .iter()
        .filter(|candidate| path_exists_in_head(&repo_path, candidate))
        .cloned()
        .collect();

    if !head_paths.is_empty() {
        restore_paths_from_head(&repo_path, &restore_paths, &head_paths)?;
    } else {
        remove_paths_from_index_and_working_tree(&repo_path, &[entry.file])?;
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
pub fn append_file_to_stash(
    repo_path: String,
    stash_id: String,
    file: String,
) -> Result<OkResponse, String> {
    ensure_repo_path(&repo_path)?;

    let stash_id = stash_id.trim().to_string();
    let file = validate_append_file(&repo_path, &file)?;
    let stash_index = parse_stash_index(&stash_id)?;
    let stash_log_path = resolve_git_path(&repo_path, "logs/refs/stash")?;
    let entries = read_stash_reflog_entries(&stash_log_path, &stash_id)?;

    if entries.is_empty() || stash_index >= entries.len() {
        return Err(format!("{stash_id} was not found."));
    }

    let target_log_index = entries.len() - 1 - stash_index;
    let target_entry = entries[target_log_index].clone();
    let (staged_patch, unstaged_patch) = collect_append_file_patches(&repo_path, &file)?;
    let replacement_oid = create_replacement_stash_commit(
        &repo_path,
        &stash_id,
        &target_entry.message,
        &staged_patch,
        &unstaged_patch,
    )?;
    let replaced_entries: Vec<StashReflogEntryRecord> = entries
        .iter()
        .enumerate()
        .map(|(index, entry)| {
            let mut next = entry.clone();
            if index == target_log_index {
                next.new_oid = replacement_oid.clone();
            }
            next
        })
        .collect();

    if let Err(error) = rebuild_stash_reflog(&repo_path, &stash_log_path, &replaced_entries) {
        let _ = rebuild_stash_reflog(&repo_path, &stash_log_path, &entries);
        return Err(error);
    }

    Ok(OkResponse { ok: true })
}

#[tauri::command]
pub fn get_stash_diff_detail(
    repo_path: String,
    stash_id: String,
) -> Result<StashDiffDetail, String> {
    ensure_repo_path(&repo_path)?;

    let stash_id = stash_id.trim().to_string();
    parse_stash_index(&stash_id)?;

    let file_stats_output = run_git(
        &["stash", "show", "--numstat", "--format=", stash_id.as_str()],
        &repo_path,
    )?;
    let file_status_output = run_git(
        &[
            "stash",
            "show",
            "--name-status",
            "--format=",
            stash_id.as_str(),
        ],
        &repo_path,
    )?;
    let files = parse_commit_file_stats(&file_stats_output, Some(&file_status_output));

    let diff = run_git(
        &["stash", "show", "--patch", "--format=", stash_id.as_str()],
        &repo_path,
    )?;
    let is_diff_truncated = diff.chars().count() > 25_000;

    Ok(StashDiffDetail {
        stash_id,
        files,
        diff: diff.chars().take(25_000).collect(),
        is_diff_truncated,
    })
}

#[tauri::command]
pub fn get_stash_diff_file_detail(
    repo_path: String,
    stash_id: String,
    file: String,
) -> Result<StashDiffFileDetail, String> {
    ensure_repo_path(&repo_path)?;

    let stash_id = stash_id.trim().to_string();
    let file = file.trim().to_string();
    parse_stash_index(&stash_id)?;

    if file.is_empty() {
        return Err("file is required.".to_string());
    }

    let stash_base = format!("{stash_id}^1");
    let diff = run_git(
        &[
            "diff",
            stash_base.as_str(),
            stash_id.as_str(),
            "--",
            file.as_str(),
        ],
        &repo_path,
    )?;
    let is_diff_truncated = diff.chars().count() > 25_000;

    Ok(StashDiffFileDetail {
        stash_id,
        file,
        diff: diff.chars().take(25_000).collect(),
        is_diff_truncated,
    })
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
    let entries = read_stash_reflog_entries(&stash_log_path, &stash_id)?;

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
pub fn delete_stash(repo_path: String, stash_id: String) -> Result<OkResponse, String> {
    ensure_repo_path(&repo_path)?;

    let stash_id = stash_id.trim().to_string();
    parse_stash_index(&stash_id)?;
    run_git(&["stash", "drop", stash_id.as_str()], &repo_path)?;

    Ok(OkResponse { ok: true })
}

#[tauri::command]
pub fn apply_stash(repo_path: String, stash_id: String) -> Result<ConflictOperationResult, String> {
    ensure_repo_path(&repo_path)?;

    let stash_id = stash_id.trim().to_string();
    parse_stash_index(&stash_id)?;
    match run_git(&["stash", "apply", stash_id.as_str()], &repo_path) {
        Ok(_) => Ok(ConflictOperationResult {
            ok: true,
            conflict: None,
        }),
        Err(error) if is_conflict_message(&error) => Ok(ConflictOperationResult {
            ok: false,
            conflict: Some(get_conflict_summary_for_context(
                &repo_path,
                None,
                Some(ConflictOperation::StashApply),
                None,
                None,
            )?),
        }),
        Err(error) => Err(error),
    }
}

#[tauri::command]
pub fn pop_stash(repo_path: String, stash_id: String) -> Result<ConflictOperationResult, String> {
    ensure_repo_path(&repo_path)?;

    let stash_id = stash_id.trim().to_string();
    parse_stash_index(&stash_id)?;
    match run_git(&["stash", "pop", stash_id.as_str()], &repo_path) {
        Ok(_) => Ok(ConflictOperationResult {
            ok: true,
            conflict: None,
        }),
        Err(error) if is_conflict_message(&error) => Ok(ConflictOperationResult {
            ok: false,
            conflict: Some(get_conflict_summary_for_context(
                &repo_path,
                None,
                Some(ConflictOperation::StashPop),
                None,
                None,
            )?),
        }),
        Err(error) => Err(error),
    }
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
            "checkout",
            "-b",
            normalized_new_branch.as_str(),
            base_branch.as_str(),
        ],
        &repo_path,
    )?;

    Ok(OkResponse { ok: true })
}

#[tauri::command]
pub fn get_pull_status(
    repo_path: String,
    branch_name: Option<String>,
) -> Result<PullStatusResponse, String> {
    get_pull_status_for_branch(&repo_path, branch_name.as_deref())
}

#[tauri::command]
pub fn merge_branches(
    repo_path: String,
    source_branch: String,
    target_branch: String,
) -> Result<ConflictOperationResult, String> {
    ensure_repo_path(&repo_path)?;
    ensure_branch_pair(&repo_path, &source_branch, &target_branch)?;

    let current_branch = get_current_branch(&repo_path)?;
    if current_branch == target_branch {
        match run_git(&["merge", source_branch.as_str()], &repo_path) {
            Ok(_) => {}
            Err(error) if is_conflict_message(&error) => {
                return Ok(ConflictOperationResult {
                    ok: false,
                    conflict: Some(get_conflict_summary_for_context(
                        &repo_path,
                        None,
                        Some(ConflictOperation::Merge),
                        None,
                        None,
                    )?),
                });
            }
            Err(error) => return Err(error),
        }
    } else {
        return merge_branch_without_checkout(&repo_path, &source_branch, &target_branch);
    }

    Ok(ConflictOperationResult {
        ok: true,
        conflict: None,
    })
}

#[tauri::command]
pub fn complete_merge_session(repo_path: String, session_id: String) -> Result<OkResponse, String> {
    let normalized_session_id = session_id.trim().to_string();
    if normalized_session_id.is_empty() {
        return Err("sessionId is required.".to_string());
    }

    let session = get_merge_session(&normalized_session_id)?;
    if session.repo_path != repo_path {
        return Err(format!(
            "Merge session '{}' does not belong to this repository.",
            normalized_session_id
        ));
    }

    let remaining_conflicts =
        list_conflict_files(session.worktree_path.to_string_lossy().as_ref())?;
    if !remaining_conflicts.is_empty() {
        return Err(
            "Resolve all conflicted files before completing the merge session.".to_string(),
        );
    }

    let mut operation_error = None;

    if let Err(error) = run_git(
        &["commit", "--no-edit"],
        session.worktree_path.to_string_lossy().as_ref(),
    ) {
        operation_error = Some(error);
    } else if let Ok(merged_target_sha) = run_git(
        &["rev-parse", "HEAD"],
        session.worktree_path.to_string_lossy().as_ref(),
    ) {
        if merged_target_sha != session.previous_target_sha {
            let args = vec![
                "update-ref".to_string(),
                "-m".to_string(),
                format!(
                    "branch action merge {} into {}",
                    session.source_branch, session.target_branch
                ),
                format!("refs/heads/{}", session.target_branch),
                merged_target_sha,
                session.previous_target_sha.clone(),
            ];
            if let Err(error) = run_git_owned(&args, &session.repo_path) {
                operation_error = Some(error);
            }
        }
    } else {
        operation_error = Some("Failed to resolve merged target SHA.".to_string());
    }

    if let Err(error) = remove_temporary_worktree(
        &session.repo_path,
        &session.temp_root_path,
        &session.worktree_path,
    ) {
        if operation_error.is_none() {
            operation_error = Some(error);
        }
    }

    let _ = remove_merge_session(&normalized_session_id);

    match operation_error {
        Some(error) => Err(error),
        None => Ok(OkResponse { ok: true }),
    }
}

#[tauri::command]
pub fn abort_merge_session(repo_path: String, session_id: String) -> Result<OkResponse, String> {
    let normalized_session_id = session_id.trim().to_string();
    if normalized_session_id.is_empty() {
        return Err("sessionId is required.".to_string());
    }

    let session = get_merge_session(&normalized_session_id)?;
    if session.repo_path != repo_path {
        return Err(format!(
            "Merge session '{}' does not belong to this repository.",
            normalized_session_id
        ));
    }

    let _ = run_git(
        &["merge", "--abort"],
        session.worktree_path.to_string_lossy().as_ref(),
    );
    remove_temporary_worktree(
        &session.repo_path,
        &session.temp_root_path,
        &session.worktree_path,
    )?;
    let _ = remove_merge_session(&normalized_session_id);

    Ok(OkResponse { ok: true })
}

#[tauri::command]
pub fn pull_current_branch(
    repo_path: String,
    branch_name: Option<String>,
) -> Result<OkResponse, String> {
    pull_branch(&repo_path, branch_name.as_deref())?;
    Ok(OkResponse { ok: true })
}

#[tauri::command]
pub fn delete_branch(
    repo_path: String,
    branch_name: String,
    branch_type: String,
    force_delete: Option<bool>,
) -> Result<OkResponse, String> {
    let should_force_delete = force_delete.unwrap_or(false);

    match branch_type.as_str() {
        "local" => {
            ensure_deletable_local_branch(&repo_path, &branch_name)?;
            let delete_flag = if should_force_delete { "-D" } else { "-d" };
            run_git(&["branch", delete_flag, branch_name.as_str()], &repo_path)?;
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
    sync_current_branch_upstream_tracking_ref(&repo_path)?;

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
    let current_branch = get_current_branch(&repo_path)?;
    snapshot.push('\n');
    snapshot.push_str(&current_branch);
    if current_branch != "HEAD" {
        if let Some(upstream_name) = get_branch_upstream(&repo_path, &current_branch) {
            snapshot.push('\n');
            snapshot.push_str(&upstream_name);
            let upstream_head = run_git(
                &["rev-parse", "--verify", upstream_name.as_str()],
                &repo_path,
            )
            .unwrap_or_default();
            snapshot.push('\n');
            snapshot.push_str(&upstream_head);
        }
    }

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
        repository_assistant_open_ai_model: input
            .repository_assistant_open_ai_model
            .unwrap_or(current.repository_assistant_open_ai_model),
        repository_assistant_reasoning_effort: input
            .repository_assistant_reasoning_effort
            .unwrap_or(current.repository_assistant_reasoning_effort),
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
        repository_assistant_policies: input
            .repository_assistant_policies
            .as_ref()
            .map(|value| normalize_repository_assistant_policies_value(Some(value)))
            .unwrap_or(current.repository_assistant_policies),
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
pub fn generate_title(input: GenerateTitleInput) -> Result<TitleResponse, String> {
    ensure_repo_path(&input.repo_path)?;

    let current = read_config()?;
    let config = AppConfig {
        open_ai_token: input.open_ai_token.unwrap_or(current.open_ai_token),
        open_ai_model: input.open_ai_model.unwrap_or(current.open_ai_model),
        repository_assistant_open_ai_model: current.repository_assistant_open_ai_model,
        repository_assistant_reasoning_effort: current.repository_assistant_reasoning_effort,
        claude_code_token: input.claude_code_token.unwrap_or(current.claude_code_token),
        selected_ai_provider: input
            .selected_ai_provider
            .unwrap_or(current.selected_ai_provider),
        commit_title_prompt: input
            .commit_title_prompt
            .unwrap_or(current.commit_title_prompt),
        commit_graph_mode: current.commit_graph_mode,
        repository_scan_depth: current.repository_scan_depth,
        repository_assistant_policies: current.repository_assistant_policies,
        recently_used: current.recently_used,
        window_state: current.window_state,
    };
    let diff_snippet = get_diff_snippet(&input.repo_path, &input.changed_files)?;
    generate_commit_title_internal(&config, &input.changed_files, &diff_snippet)
}

#[tauri::command]
pub fn chat_with_repository_assistant(
    input: ChatWithRepositoryAssistantInput,
) -> Result<RepositoryAssistantResponse, String> {
    ensure_repo_path(&input.repo_path)?;

    let config = read_config()?;
    if config.open_ai_token.trim().is_empty() {
        return Err(REPOSITORY_ASSISTANT_REQUIRES_OPENAI_ERROR.to_string());
    }

    let system_prompt = build_repository_assistant_system_prompt(
        &build_repository_assistant_context(&input.repo_path)?,
    );
    let open_ai_model = input
        .open_ai_model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(config.repository_assistant_open_ai_model.as_str())
        .to_string();
    let message = chat_with_openai(
        &config.open_ai_token,
        &open_ai_model,
        input
            .reasoning_effort
            .unwrap_or(config.repository_assistant_reasoning_effort),
        &system_prompt,
        &input.messages,
    )?;
    let (content, proposed_actions) = parse_repository_assistant_response_payload(&message)
        .unwrap_or_else(|| (message.clone(), Vec::new()));

    Ok(RepositoryAssistantResponse {
        message: RepositoryAssistantMessage {
            id: create_repository_assistant_message_id(),
            role: RepositoryAssistantMessageRole::Assistant,
            content,
            created_at: current_timestamp_millis(),
        },
        proposed_actions,
    })
}

#[tauri::command]
pub fn execute_repository_assistant_action(
    input: ExecuteRepositoryAssistantActionInput,
) -> Result<RepositoryAssistantActionExecutionResponse, String> {
    ensure_repo_path(&input.repo_path)?;

    let action = normalize_repository_assistant_action(&input.action)
        .ok_or_else(|| "action is invalid.".to_string())?;
    let config = read_config()?;
    if !is_repository_assistant_action_allowed(
        &config.repository_assistant_policies,
        &input.repo_path,
        &action.id,
    ) {
        return Err(format!(
            "{} is not allowlisted for this repository.",
            action.id
        ));
    }

    assert_repository_assistant_action_safe(&input.repo_path, &action)?;

    let result = match dispatch_repository_assistant_action(&input.repo_path, &action) {
        Ok(result) => result,
        Err(error) => create_repository_assistant_action_result(&action, "failed", error, None),
    };

    Ok(RepositoryAssistantActionExecutionResponse { result })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::ErrorKind;
    use std::io::Write;
    use std::process::Stdio;
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

    fn run_command_with_input(
        command: &str,
        args: &[&str],
        repo_path: &str,
        input: &str,
    ) -> Result<String, String> {
        let mut child = Command::new(command)
            .args(args)
            .current_dir(repo_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("Failed to execute {command}: {error}"))?;

        child
            .stdin
            .as_mut()
            .ok_or_else(|| format!("Failed to write stdin for {command}."))?
            .write_all(input.as_bytes())
            .map_err(|error| format!("Failed to write stdin for {command}: {error}"))?;

        let output = child
            .wait_with_output()
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

    fn hash_blob(repo_path: &str, content: &[u8]) -> String {
        let temp_path = Path::new(repo_path).join(format!(
            ".git-chat-ui-blob-{}-{}",
            current_timestamp(),
            NEXT_TEMP_REPO_ID.fetch_add(1, Ordering::Relaxed)
        ));
        fs::write(&temp_path, content).expect("temporary blob file should be written");
        let oid = run_command(
            "git",
            &["hash-object", "-w", temp_path.to_string_lossy().as_ref()],
            repo_path,
        )
        .expect("blob should be hashed");
        fs::remove_file(temp_path).expect("temporary blob file should be removed");
        oid
    }

    fn stage_conflict_entries(
        repo_path: &str,
        file: &str,
        entries: &[(u8, &[u8])],
        merged_content: Option<&[u8]>,
        reset_index: bool,
    ) {
        if reset_index {
            run_command("git", &["read-tree", "--empty"], repo_path)
                .expect("index should be cleared");
        }
        let worktree_path = Path::new(repo_path).join(file);
        let _ = fs::remove_file(&worktree_path);

        for (stage, content) in entries {
            let oid = hash_blob(repo_path, content);
            run_command_with_input(
                "git",
                &["update-index", "--index-info"],
                repo_path,
                &format!("100644 {} {}\t{}\n", oid, stage, file),
            )
            .expect("conflict stage should be added");
        }

        match merged_content {
            Some(content) => {
                if let Some(parent) = worktree_path.parent() {
                    fs::create_dir_all(parent).expect("conflict parent dir should be created");
                }
                fs::write(worktree_path, content).expect("merged conflict file should be written");
            }
            None => {
                let _ = fs::remove_file(worktree_path);
            }
        }
    }

    fn create_conflict_fixture() -> TestRepoFixture {
        let root_dir = create_temporary_directory("tauri-conflict-fixture")
            .expect("temporary root dir should be created");
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
        run_command(
            "git",
            &["commit", "--allow-empty", "-m", "init"],
            &repo_path_str,
        )
        .expect("initial empty commit should succeed");

        TestRepoFixture {
            root_dir,
            repo_path: repo_path_str,
        }
    }

    fn create_merge_conflict_session_fixture() -> TestRepoFixture {
        let root_dir = create_temporary_directory("tauri-merge-session-fixture")
            .expect("temporary root dir should be created");
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

        fs::write(repo_path.join("conflict.txt"), "base\n").expect("base file should be written");
        run_command("git", &["add", "conflict.txt"], &repo_path_str)
            .expect("git add should succeed");
        run_command("git", &["commit", "-m", "init"], &repo_path_str)
            .expect("git commit should succeed");

        run_command(
            "git",
            &["checkout", "-b", "feature/conflict"],
            &repo_path_str,
        )
        .expect("feature branch should be created");
        fs::write(repo_path.join("conflict.txt"), "feature\n")
            .expect("feature file should be written");
        run_command("git", &["commit", "-am", "feature"], &repo_path_str)
            .expect("feature commit should succeed");

        run_command("git", &["checkout", "main"], &repo_path_str)
            .expect("checkout main should succeed");
        fs::write(repo_path.join("conflict.txt"), "main\n").expect("main file should be written");
        run_command("git", &["commit", "-am", "main"], &repo_path_str)
            .expect("main commit should succeed");

        run_command("git", &["checkout", "feature/conflict"], &repo_path_str)
            .expect("checkout feature branch should succeed");

        TestRepoFixture {
            root_dir,
            repo_path: repo_path_str,
        }
    }

    fn create_stash_fixture() -> TestRepoFixture {
        let temp_dir = std::env::temp_dir();
        let mut root_dir = None;

        for _ in 0..32 {
            let candidate = temp_dir.join(format!(
                "git-chat-ui-tauri-stash-{}-{}-{}",
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

        fs::write(repo_path.join("README.md"), "root\n").expect("README should be written");
        fs::write(repo_path.join("alpha.txt"), "alpha base\n").expect("alpha should be written");
        fs::write(repo_path.join("beta.txt"), "beta base\n").expect("beta should be written");
        run_command(
            "git",
            &["add", "README.md", "alpha.txt", "beta.txt"],
            &repo_path_str,
        )
        .expect("git add should succeed");
        run_command("git", &["commit", "-m", "init"], &repo_path_str)
            .expect("git commit should succeed");

        fs::write(repo_path.join("alpha.txt"), "alpha updated\n")
            .expect("alpha update should be written");
        run_command(
            "git",
            &["stash", "push", "-m", "first stash", "--", "alpha.txt"],
            &repo_path_str,
        )
        .expect("first stash should succeed");

        fs::write(repo_path.join("beta.txt"), "beta updated\n")
            .expect("beta update should be written");
        run_command(
            "git",
            &["stash", "push", "-m", "second stash", "--", "beta.txt"],
            &repo_path_str,
        )
        .expect("second stash should succeed");

        TestRepoFixture {
            root_dir,
            repo_path: repo_path_str,
        }
    }

    fn create_merge_fixture() -> TestRepoFixture {
        let root_dir = create_temporary_directory("tauri-merge-fixture")
            .expect("temporary root dir should be created");
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

        fs::write(repo_path.join("README.md"), "root\n").expect("README should be written");
        run_command("git", &["add", "README.md"], &repo_path_str).expect("git add should succeed");
        run_command("git", &["commit", "-m", "init"], &repo_path_str)
            .expect("git commit should succeed");

        run_command(
            "git",
            &["checkout", "-b", "feature/dnd-merge"],
            &repo_path_str,
        )
        .expect("feature branch should be created");
        fs::write(repo_path.join("feature.txt"), "feature\n")
            .expect("feature file should be written");
        run_command("git", &["add", "feature.txt"], &repo_path_str)
            .expect("git add should succeed");
        run_command("git", &["commit", "-m", "feature"], &repo_path_str)
            .expect("git commit should succeed");

        TestRepoFixture {
            root_dir,
            repo_path: repo_path_str,
        }
    }

    fn create_pull_fixture() -> (TestRepoFixture, String) {
        let root_dir = create_temporary_directory("tauri-pull-fixture")
            .expect("temporary root dir should be created");
        let origin_path = root_dir.join("origin.git");
        let repo_path = root_dir.join("local");
        let root_dir_str = root_dir.to_string_lossy().to_string();
        let origin_path_str = origin_path.to_string_lossy().to_string();
        let repo_path_str = repo_path.to_string_lossy().to_string();
        run_command("git", &["init", "--bare", &origin_path_str], &root_dir_str)
            .expect("bare origin should be created");
        run_command(
            "git",
            &["clone", &origin_path_str, &repo_path_str],
            &root_dir_str,
        )
        .expect("local clone should succeed");
        run_command("git", &["config", "user.name", "Test User"], &repo_path_str)
            .expect("git user.name config should succeed");
        run_command(
            "git",
            &["config", "user.email", "test@example.com"],
            &repo_path_str,
        )
        .expect("git user.email config should succeed");

        run_command("git", &["checkout", "-b", "main"], &repo_path_str)
            .expect("main branch should be created");
        fs::write(repo_path.join("README.md"), "root\n").expect("README should be written");
        run_command("git", &["add", "README.md"], &repo_path_str).expect("git add should succeed");
        run_command("git", &["commit", "-m", "init"], &repo_path_str)
            .expect("git commit should succeed");
        run_command("git", &["push", "-u", "origin", "main"], &repo_path_str)
            .expect("git push should succeed");
        run_command(
            "git",
            &["symbolic-ref", "HEAD", "refs/heads/main"],
            &origin_path_str,
        )
        .expect("origin head should be updated");
        run_command(
            "git",
            &["remote", "set-head", "origin", "--auto"],
            &repo_path_str,
        )
        .expect("origin head should be detected locally");

        let collaborator_path = root_dir.join("collaborator");
        let collaborator_path_str = collaborator_path.to_string_lossy().to_string();
        run_command(
            "git",
            &["clone", &origin_path_str, &collaborator_path_str],
            &root_dir_str,
        )
        .expect("collaborator clone should succeed");
        run_command(
            "git",
            &["config", "user.name", "Test User"],
            &collaborator_path_str,
        )
        .expect("git user.name config should succeed");
        run_command(
            "git",
            &["config", "user.email", "test@example.com"],
            &collaborator_path_str,
        )
        .expect("git user.email config should succeed");
        run_command("git", &["checkout", "main"], &collaborator_path_str)
            .expect("collaborator should track main");

        (
            TestRepoFixture {
                root_dir,
                repo_path: repo_path_str,
            },
            collaborator_path_str,
        )
    }

    fn create_branch_diff_fixture() -> TestRepoFixture {
        let root_dir = create_temporary_directory("tauri-branch-diff-fixture")
            .expect("temporary root dir should be created");
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

        let base_lines = (0..3200)
            .map(|index| format!("base line {index}"))
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(repo_path.join("big.txt"), format!("{base_lines}\n"))
            .expect("initial large file should be written");
        fs::create_dir_all(repo_path.join("src")).expect("src directory should be created");
        fs::write(
            repo_path.join("src").join("app.ts"),
            "export const version = 'base';\n",
        )
        .expect("initial app.ts should be written");
        run_command("git", &["add", "big.txt", "src/app.ts"], &repo_path_str)
            .expect("git add should succeed");
        run_command("git", &["commit", "-m", "init"], &repo_path_str)
            .expect("git commit should succeed");

        run_command("git", &["checkout", "-b", "feature/syntax"], &repo_path_str)
            .expect("feature branch should be created");

        let feature_lines = (0..3200)
            .map(|index| format!("feature line {index}"))
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(repo_path.join("big.txt"), format!("{feature_lines}\n"))
            .expect("updated large file should be written");
        fs::write(
            repo_path.join("src").join("app.ts"),
            "export const version = 'feature';\n",
        )
        .expect("updated app.ts should be written");
        run_command("git", &["add", "big.txt", "src/app.ts"], &repo_path_str)
            .expect("git add should succeed");
        run_command("git", &["commit", "-m", "feature"], &repo_path_str)
            .expect("git commit should succeed");

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
            "repositoryAssistantOpenAiModel": "gpt-5.4",
            "repositoryAssistantReasoningEffort": "high",
            "claudeCodeToken": "cc-token",
            "selectedAiProvider": "claudeCode",
            "commitTitlePrompt": "Write a short Japanese commit message.",
            "commitGraphMode": "simple",
            "repositoryScanDepth": 6
        }));

        assert_eq!(config.open_ai_token, "sk-openai");
        assert_eq!(config.open_ai_model, "gpt-4.1");
        assert_eq!(config.repository_assistant_open_ai_model, "gpt-5.4");
        assert_eq!(
            config.repository_assistant_reasoning_effort,
            OpenAiReasoningEffort::High
        );
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
    fn normalize_config_value_uses_default_commit_title_prompt_when_missing_or_blank() {
        let missing_prompt = normalize_config_value(json!({
            "openAiModel": "gpt-4.1-mini"
        }));
        let blank_prompt = normalize_config_value(json!({
            "commitTitlePrompt": "   "
        }));

        assert_eq!(
            missing_prompt.commit_title_prompt,
            DEFAULT_COMMIT_TITLE_PROMPT
        );
        assert_eq!(
            blank_prompt.commit_title_prompt,
            DEFAULT_COMMIT_TITLE_PROMPT
        );
    }

    #[test]
    fn parse_github_viewer_response_extracts_login_and_avatar_url() {
        assert_eq!(
            parse_github_viewer_response(
                r#"{"login":"octocat","avatar_url":"https://avatars.githubusercontent.com/u/1?v=4"}"#
            ),
            RepositoryAssistantUserProfileResponse {
                login: Some("octocat".to_string()),
                avatar_url: Some("https://avatars.githubusercontent.com/u/1?v=4".to_string()),
            }
        );
    }

    #[test]
    fn parse_github_viewer_response_normalizes_blank_fields_to_none() {
        assert_eq!(
            parse_github_viewer_response(r#"{"login":"   ","avatar_url":""}"#),
            RepositoryAssistantUserProfileResponse {
                login: None,
                avatar_url: None,
            }
        );
    }

    #[test]
    fn normalize_config_value_falls_back_to_commit_model_for_repository_assistant() {
        let config = normalize_config_value(json!({
            "openAiModel": "gpt-4.1",
            "repositoryAssistantOpenAiModel": "   "
        }));

        assert_eq!(config.repository_assistant_open_ai_model, "gpt-4.1");
        assert_eq!(
            config.repository_assistant_reasoning_effort,
            OpenAiReasoningEffort::Default
        );
    }

    #[test]
    fn normalize_config_value_normalizes_repository_assistant_policies() {
        let config = normalize_config_value(json!({
            "repositoryAssistantPolicies": {
                " /tmp/repo-a ": {
                    "allowedActionIds": [
                        "git.push",
                        "gh.pr.create",
                        "git.push",
                        "not.valid"
                    ]
                },
                "": {
                    "allowedActionIds": ["git.stage_file"]
                }
            }
        }));

        assert_eq!(config.repository_assistant_policies.len(), 1);
        assert_eq!(
            config
                .repository_assistant_policies
                .get("/tmp/repo-a")
                .expect("policy should exist")
                .allowed_action_ids,
            vec!["git.push".to_string(), "gh.pr.create".to_string()]
        );
    }

    #[test]
    fn normalize_repository_assistant_action_rejects_blank_strings() {
        let action = RepositoryAssistantAction {
            id: "git.stage_file".to_string(),
            args: json!({
                "file": "   "
            }),
        };

        assert!(normalize_repository_assistant_action(&action).is_none());
    }

    #[test]
    fn repository_assistant_self_repo_safety_allows_metadata_only_actions() {
        let repo_path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .to_string_lossy()
            .to_string();

        let stage_action = RepositoryAssistantAction {
            id: "git.stage_file".to_string(),
            args: json!({
                "file": "src/App.tsx"
            }),
        };
        let commit_action = RepositoryAssistantAction {
            id: "git.commit".to_string(),
            args: json!({
                "title": "test: metadata only",
                "description": ""
            }),
        };

        assert!(assert_repository_assistant_action_safe(&repo_path, &stage_action).is_ok());
        assert!(assert_repository_assistant_action_safe(&repo_path, &commit_action).is_ok());
    }

    #[test]
    fn repository_assistant_self_repo_safety_blocks_working_tree_actions() {
        let repo_path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .to_string_lossy()
            .to_string();
        let action = RepositoryAssistantAction {
            id: "git.checkout_ref".to_string(),
            args: json!({
                "ref": "main"
            }),
        };

        assert_eq!(
            assert_repository_assistant_action_safe(&repo_path, &action),
            Err("Repository assistant cannot run Checkout Ref against git-chat-ui's own repository while the app is running from that checkout.".to_string())
        );
    }

    #[test]
    fn repository_assistant_self_repo_safety_allows_merge_on_non_current_target() {
        let repo_path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .to_string_lossy()
            .to_string();
        let action = RepositoryAssistantAction {
            id: "git.merge_branches".to_string(),
            args: json!({
                "sourceBranch": "feature/safe-merge",
                "targetBranch": "__self_repo_safe_target__"
            }),
        };

        assert!(assert_repository_assistant_action_safe(&repo_path, &action).is_ok());
    }

    #[test]
    fn repository_assistant_self_repo_safety_blocks_merge_into_current_branch() {
        let repo_path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .to_string_lossy()
            .to_string();
        let current_branch = get_current_branch(&repo_path).expect("current branch should resolve");
        let action = RepositoryAssistantAction {
            id: "git.merge_branches".to_string(),
            args: json!({
                "sourceBranch": "feature/unsafe-merge",
                "targetBranch": current_branch
            }),
        };

        assert_eq!(
            assert_repository_assistant_action_safe(&repo_path, &action),
            Err("Repository assistant cannot run Merge Branches against git-chat-ui's own repository when the target branch is currently checked out while the app is running from that checkout.".to_string())
        );
    }

    #[test]
    fn repository_assistant_self_repo_safety_allows_merge_session_actions() {
        let repo_path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .to_string_lossy()
            .to_string();
        let resolve_action = RepositoryAssistantAction {
            id: "git.resolve_conflict_side".to_string(),
            args: json!({
                "file": "src/App.tsx",
                "side": "ours",
                "sessionId": "session-1"
            }),
        };
        let complete_action = RepositoryAssistantAction {
            id: "git.complete_merge_session".to_string(),
            args: json!({
                "sessionId": "session-1"
            }),
        };
        let abort_action = RepositoryAssistantAction {
            id: "git.abort_merge_session".to_string(),
            args: json!({
                "sessionId": "session-1"
            }),
        };

        assert!(assert_repository_assistant_action_safe(&repo_path, &resolve_action).is_ok());
        assert!(assert_repository_assistant_action_safe(&repo_path, &complete_action).is_ok());
        assert!(assert_repository_assistant_action_safe(&repo_path, &abort_action).is_ok());
    }

    #[test]
    fn parse_repository_assistant_response_payload_extracts_message_and_actions() {
        let payload = r#"```json
{
  "message": "Stage the file first.",
  "proposedActions": [
    {
      "action": {
        "id": "git.stage_file",
        "args": {
          "file": "src/App.tsx"
        }
      },
      "reason": "The file is ready to be staged."
    }
  ]
}
```"#;

        let (message, proposed_actions) =
            parse_repository_assistant_response_payload(payload).expect("payload should parse");

        assert_eq!(message, "Stage the file first.");
        assert_eq!(proposed_actions.len(), 1);
        assert_eq!(proposed_actions[0].action.id, "git.stage_file");
        assert_eq!(
            proposed_actions[0].action.args,
            json!({
                "file": "src/App.tsx"
            })
        );
        assert_eq!(
            proposed_actions[0].reason,
            "The file is ready to be staged."
        );
        assert_eq!(proposed_actions[0].status, "proposed");
        assert!(proposed_actions[0].result.is_none());
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
    fn open_ai_reasoning_effort_as_api_value_omits_default() {
        assert_eq!(OpenAiReasoningEffort::Default.as_api_value(), None);
        assert_eq!(OpenAiReasoningEffort::High.as_api_value(), Some("high"));
    }

    #[test]
    fn should_include_open_ai_temperature_only_for_supported_models() {
        assert!(should_include_open_ai_temperature(
            "gpt-4.1-mini",
            OpenAiReasoningEffort::Default
        ));
        assert!(!should_include_open_ai_temperature(
            "gpt-5.4",
            OpenAiReasoningEffort::Default
        ));
        assert!(should_include_open_ai_temperature(
            "gpt-5.1",
            OpenAiReasoningEffort::NoneValue
        ));
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
        assert!(DEFAULT_COMMIT_TITLE_PROMPT.contains("conventional commit title such as feat:"));
        assert!(DEFAULT_COMMIT_TITLE_PROMPT.contains("always include a short description"));
        assert!(DEFAULT_COMMIT_TITLE_PROMPT.contains("72 characters or fewer"));
        assert!(DEFAULT_COMMIT_TITLE_PROMPT.contains("rewrite it shorter"));
        assert!(!DEFAULT_COMMIT_TITLE_PROMPT.contains("Angular-style"));
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
    fn generate_commit_title_internal_rejects_when_no_staged_changes_are_provided() {
        let config = AppConfig::default();

        assert_eq!(
            generate_commit_title_internal(&config, &[], "")
                .expect_err("empty changed files should be rejected"),
            NO_STAGED_CHANGES_ERROR
        );
    }

    #[test]
    fn generate_commit_title_internal_does_not_fallback_to_the_other_provider() {
        let mut config = AppConfig::default();
        config.claude_code_token = "cc-live-token".to_string();
        config.selected_ai_provider = AiProvider::OpenAi;

        assert_eq!(
            generate_commit_title_internal(&config, &["src/App.tsx".to_string()], "+ change")
                .expect_err("selected provider without token should not fallback"),
            NO_AI_PROVIDER_ERROR
        );
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
    fn get_branch_diff_file_detail_returns_selected_file_when_aggregate_diff_is_truncated() {
        let fixture = create_branch_diff_fixture();

        let overall = get_branch_diff_detail(
            fixture.repo_path.clone(),
            "main".to_string(),
            "feature/syntax".to_string(),
        )
        .expect("branch diff detail should be returned");

        assert!(overall.is_diff_truncated);
        assert!(overall.files.iter().any(|file| file.file == "src/app.ts"));
        assert!(!overall
            .diff
            .contains("diff --git a/src/app.ts b/src/app.ts"));

        let detail = get_branch_diff_file_detail(
            fixture.repo_path.clone(),
            "main".to_string(),
            "feature/syntax".to_string(),
            "src/app.ts".to_string(),
        )
        .expect("branch file diff detail should be returned");

        assert_eq!(detail.file, "src/app.ts");
        assert!(detail.diff.contains("diff --git a/src/app.ts b/src/app.ts"));
        assert!(detail.diff.contains("+export const version = 'feature';"));
        assert!(!detail.is_diff_truncated);
    }

    #[test]
    fn get_commit_file_diff_detail_returns_selected_file_when_aggregate_diff_is_truncated() {
        let fixture = create_branch_diff_fixture();
        let sha = run_command("git", &["rev-parse", "HEAD"], &fixture.repo_path)
            .expect("head sha should resolve");
        let overall = get_commit_detail(fixture.repo_path.clone(), sha.clone())
            .expect("commit detail should be returned");

        assert!(overall.files.iter().any(|file| file.file == "src/app.ts"));
        assert!(!overall
            .diff
            .contains("diff --git a/src/app.ts b/src/app.ts"));

        let detail = get_commit_file_diff_detail(
            fixture.repo_path.clone(),
            sha.clone(),
            "src/app.ts".to_string(),
        )
        .expect("commit file diff detail should be returned");

        assert_eq!(detail.sha, sha);
        assert_eq!(detail.file, "src/app.ts");
        assert!(detail.diff.contains("diff --git a/src/app.ts b/src/app.ts"));
        assert!(detail.diff.contains("+export const version = 'feature';"));
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
    fn discard_file_restores_tracked_modified_file_to_head() {
        let fixture = create_working_tree_diff_fixture();

        discard_file(fixture.repo_path.clone(), "README.md".to_string())
            .expect("discard file should succeed");

        let status = run_command("git", &["status", "--porcelain"], &fixture.repo_path)
            .expect("git status should succeed");
        let contents = fs::read_to_string(Path::new(&fixture.repo_path).join("README.md"))
            .expect("README contents should be readable");

        assert_eq!(status, "");
        assert_eq!(contents, "line 1\nline 2\n");
    }

    #[test]
    fn discard_file_removes_staged_added_file_from_index_and_working_tree() {
        let fixture = create_working_tree_diff_fixture();
        let notes_path = Path::new(&fixture.repo_path).join("notes.txt");
        fs::write(&notes_path, "alpha\nbeta\n").expect("notes file should be written");
        run_command("git", &["add", "notes.txt"], &fixture.repo_path)
            .expect("git add should succeed");

        discard_file(fixture.repo_path.clone(), "notes.txt".to_string())
            .expect("discard file should succeed");

        let status = run_command("git", &["status", "--porcelain"], &fixture.repo_path)
            .expect("git status should succeed");

        assert!(!status.contains("notes.txt"));
        assert!(!notes_path.exists());
    }

    #[test]
    fn discard_file_removes_pure_untracked_directory() {
        let fixture = create_working_tree_diff_fixture();
        let nested_repo_path = Path::new(&fixture.repo_path).join("repo");
        fs::create_dir(&nested_repo_path).expect("nested repo dir should be created");
        run_command(
            "git",
            &["init"],
            nested_repo_path.to_string_lossy().as_ref(),
        )
        .expect("nested repo should be initialized");
        fs::write(nested_repo_path.join("README.md"), "nested\n")
            .expect("nested repo readme should be written");

        discard_file(fixture.repo_path.clone(), "repo/".to_string())
            .expect("pure untracked directory should be discarded");

        let status = run_command("git", &["status", "--porcelain"], &fixture.repo_path)
            .expect("git status should succeed");

        assert!(!status.contains("repo/"));
        assert!(!nested_repo_path.exists());
    }

    #[test]
    fn get_stash_diff_detail_returns_selected_stash_diff() {
        let fixture = create_stash_fixture();

        let detail = get_stash_diff_detail(fixture.repo_path.clone(), "stash@{0}".to_string())
            .expect("stash diff detail should be returned");

        assert_eq!(detail.stash_id, "stash@{0}");
        assert_eq!(detail.files.len(), 1);
        assert_eq!(detail.files[0].file, "beta.txt");
        assert_eq!(detail.files[0].additions, 1);
        assert_eq!(detail.files[0].deletions, 1);
        assert!(detail.diff.contains("diff --git a/beta.txt b/beta.txt"));
        assert!(detail.diff.contains("+beta updated"));
        assert!(!detail.is_diff_truncated);
    }

    #[test]
    fn get_stash_diff_file_detail_returns_selected_file_diff() {
        let fixture = create_stash_fixture();

        let detail = get_stash_diff_file_detail(
            fixture.repo_path.clone(),
            "stash@{0}".to_string(),
            "beta.txt".to_string(),
        )
        .expect("stash file diff detail should be returned");

        assert_eq!(detail.stash_id, "stash@{0}");
        assert_eq!(detail.file, "beta.txt");
        assert!(detail.diff.contains("diff --git a/beta.txt b/beta.txt"));
        assert!(detail.diff.contains("+beta updated"));
        assert!(!detail.is_diff_truncated);
    }

    #[test]
    fn append_file_to_stash_replaces_selected_entry_with_combined_diff() {
        let fixture = create_stash_fixture();
        fs::write(
            Path::new(&fixture.repo_path).join("README.md"),
            "root\nappended line\n",
        )
        .expect("README update should be written");

        append_file_to_stash(
            fixture.repo_path.clone(),
            "stash@{1}".to_string(),
            "README.md".to_string(),
        )
        .expect("append to stash should succeed");

        let stashes = get_stashes(fixture.repo_path.clone()).expect("stashes should be returned");
        let messages: Vec<String> = stashes
            .stashes
            .iter()
            .map(|stash| stash.message.clone())
            .collect();
        assert_eq!(
            messages,
            vec![
                "On main: second stash".to_string(),
                "On main: first stash".to_string()
            ]
        );
        assert_eq!(stashes.stashes[0].files, vec!["beta.txt".to_string()]);

        let mut replaced_files = stashes.stashes[1].files.clone();
        replaced_files.sort();
        assert_eq!(
            replaced_files,
            vec!["README.md".to_string(), "alpha.txt".to_string()]
        );

        let detail = get_stash_diff_detail(fixture.repo_path.clone(), "stash@{1}".to_string())
            .expect("combined stash diff should be returned");
        let mut detail_files: Vec<String> =
            detail.files.iter().map(|file| file.file.clone()).collect();
        detail_files.sort();
        assert_eq!(
            detail_files,
            vec!["README.md".to_string(), "alpha.txt".to_string()]
        );
        assert!(detail.diff.contains("diff --git a/README.md b/README.md"));
        assert!(detail.diff.contains("+appended line"));
        assert!(detail.diff.contains("diff --git a/alpha.txt b/alpha.txt"));
        assert!(detail.diff.contains("+alpha updated"));
    }

    #[test]
    fn delete_stash_removes_only_the_selected_entry() {
        let fixture = create_stash_fixture();

        delete_stash(fixture.repo_path.clone(), "stash@{1}".to_string())
            .expect("stash delete should succeed");

        let stashes = get_stashes(fixture.repo_path.clone()).expect("stashes should be returned");
        let messages: Vec<String> = stashes
            .stashes
            .iter()
            .map(|stash| stash.message.clone())
            .collect();
        assert_eq!(messages, vec!["On main: second stash".to_string()]);
        assert_eq!(stashes.stashes[0].files, vec!["beta.txt".to_string()]);
    }

    #[test]
    fn create_branch_creates_new_local_branch_and_switches_head_to_it() {
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
        assert_eq!(current_branch, "feature/context-menu");
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

    #[test]
    fn merge_branches_updates_non_current_target_without_switching_head() {
        let fixture = create_merge_fixture();

        let feature_sha = run_command(
            "git",
            &["rev-parse", "feature/dnd-merge"],
            &fixture.repo_path,
        )
        .expect("feature branch sha should resolve");

        merge_branches(
            fixture.repo_path.clone(),
            "feature/dnd-merge".to_string(),
            "main".to_string(),
        )
        .expect("merge command should succeed");

        let current_branch = run_command("git", &["branch", "--show-current"], &fixture.repo_path)
            .expect("current branch should resolve");
        let main_sha = run_command("git", &["rev-parse", "main"], &fixture.repo_path)
            .expect("main sha should resolve");
        let feature_file = fs::read_to_string(Path::new(&fixture.repo_path).join("feature.txt"))
            .expect("feature file should remain present");

        assert_eq!(current_branch, "feature/dnd-merge");
        assert_eq!(main_sha, feature_sha);
        assert_eq!(feature_file, "feature\n");
    }

    #[test]
    fn get_working_tree_status_classifies_unmerged_entries_with_pair_aware_labels() {
        let fixture = create_conflict_fixture();

        stage_conflict_entries(
            &fixture.repo_path,
            "aa.txt",
            &[(2, b"ours aa\n"), (3, b"theirs aa\n")],
            None,
            true,
        );
        stage_conflict_entries(
            &fixture.repo_path,
            "au.txt",
            &[(2, b"ours au\n")],
            None,
            false,
        );
        stage_conflict_entries(
            &fixture.repo_path,
            "dd.txt",
            &[(1, b"base dd\n")],
            None,
            false,
        );
        stage_conflict_entries(
            &fixture.repo_path,
            "du.txt",
            &[(1, b"base du\n"), (3, b"theirs du\n")],
            None,
            false,
        );
        stage_conflict_entries(
            &fixture.repo_path,
            "ua.txt",
            &[(3, b"theirs ua\n")],
            None,
            false,
        );
        stage_conflict_entries(
            &fixture.repo_path,
            "ud.txt",
            &[(1, b"base ud\n"), (2, b"ours ud\n")],
            None,
            false,
        );
        stage_conflict_entries(
            &fixture.repo_path,
            "uu.txt",
            &[(1, b"base uu\n"), (2, b"ours uu\n"), (3, b"theirs uu\n")],
            None,
            false,
        );

        let status = get_working_tree_status(fixture.repo_path.clone())
            .expect("working tree status should resolve");
        let labels: HashMap<String, String> = status
            .conflicted
            .into_iter()
            .map(|item| {
                (
                    item.file,
                    format!("{}{}:{}", item.x, item.y, item.status_label),
                )
            })
            .collect();

        assert!(status.staged.is_empty());
        assert!(status.unstaged.is_empty());
        assert_eq!(
            labels,
            HashMap::from([
                ("aa.txt".to_string(), "AA:Both Added".to_string()),
                ("au.txt".to_string(), "AU:Added by Ours".to_string()),
                ("dd.txt".to_string(), "DD:Both Deleted".to_string()),
                ("du.txt".to_string(), "DU:Deleted by Ours".to_string()),
                ("ua.txt".to_string(), "UA:Added by Theirs".to_string()),
                ("ud.txt".to_string(), "UD:Deleted by Theirs".to_string()),
                ("uu.txt".to_string(), "UU:Both Modified".to_string()),
            ])
        );
    }

    #[test]
    fn conflict_detail_returns_text_delete_side_and_binary_versions() {
        let fixture = create_conflict_fixture();
        stage_conflict_entries(
            &fixture.repo_path,
            "notes.txt",
            &[(1, b"base\n"), (2, b"ours\n"), (3, b"theirs\n")],
            Some(b"<<<<<<< ours\nours\n=======\ntheirs\n>>>>>>> theirs\n"),
            true,
        );
        stage_conflict_entries(
            &fixture.repo_path,
            "delete-side.txt",
            &[(1, b"base\n"), (2, b"ours\n")],
            None,
            false,
        );
        stage_conflict_entries(
            &fixture.repo_path,
            "binary.dat",
            &[(2, &[0_u8, 1, 2, 3][..]), (3, &[0_u8, 4, 5, 6][..])],
            Some(&[0_u8, 1, 2, 3][..]),
            false,
        );

        let text_detail =
            get_conflict_file_detail(fixture.repo_path.clone(), "notes.txt".to_string(), None)
                .expect("text conflict detail should resolve");
        assert_eq!(text_detail.status_label, "Both Modified");
        assert_eq!(
            text_detail.merged.content.as_deref(),
            Some("<<<<<<< ours\nours\n=======\ntheirs\n>>>>>>> theirs\n")
        );
        assert_eq!(text_detail.base.content.as_deref(), Some("base\n"));
        assert_eq!(text_detail.ours.content.as_deref(), Some("ours\n"));
        assert_eq!(text_detail.theirs.content.as_deref(), Some("theirs\n"));

        let delete_detail = get_conflict_file_detail(
            fixture.repo_path.clone(),
            "delete-side.txt".to_string(),
            None,
        )
        .expect("delete-side conflict detail should resolve");
        assert_eq!(delete_detail.status_label, "Deleted by Theirs");
        assert_eq!(delete_detail.merged.content, None);
        assert_eq!(delete_detail.base.content.as_deref(), Some("base\n"));
        assert_eq!(delete_detail.ours.content.as_deref(), Some("ours\n"));
        assert_eq!(delete_detail.theirs.content, None);

        let binary_detail =
            get_conflict_file_detail(fixture.repo_path.clone(), "binary.dat".to_string(), None)
                .expect("binary conflict detail should resolve");
        assert!(binary_detail.merged.is_binary);
        assert!(binary_detail.ours.is_binary);
        assert!(binary_detail.theirs.is_binary);
        assert_eq!(binary_detail.base.content, None);
    }

    #[test]
    fn resolve_conflict_version_handles_side_and_manual_resolutions() {
        let fixture = create_conflict_fixture();
        stage_conflict_entries(
            &fixture.repo_path,
            "resolve.txt",
            &[(1, b"base\n"), (2, b"ours\n"), (3, b"theirs\n")],
            Some(b"<<<<<<< ours\nours\n=======\ntheirs\n>>>>>>> theirs\n"),
            true,
        );
        resolve_conflict_version(
            fixture.repo_path.clone(),
            "resolve.txt".to_string(),
            ConflictResolutionSide::Ours,
            None,
        )
        .expect("ours resolution should succeed");
        assert_eq!(
            fs::read_to_string(Path::new(&fixture.repo_path).join("resolve.txt"))
                .expect("resolved file should be readable"),
            "ours\n"
        );
        assert!(get_conflict_summary(fixture.repo_path.clone(), None)
            .expect("conflict summary should resolve")
            .files
            .is_empty());

        stage_conflict_entries(
            &fixture.repo_path,
            "manual.txt",
            &[(1, b"base\n"), (2, b"ours\n"), (3, b"theirs\n")],
            Some(b"manual resolution\n"),
            true,
        );
        resolve_conflict_version(
            fixture.repo_path.clone(),
            "manual.txt".to_string(),
            ConflictResolutionSide::Merged,
            None,
        )
        .expect("manual resolution should stage the current file");
        assert_eq!(
            fs::read_to_string(Path::new(&fixture.repo_path).join("manual.txt"))
                .expect("manual file should be readable"),
            "manual resolution\n"
        );
        assert!(get_conflict_summary(fixture.repo_path.clone(), None)
            .expect("conflict summary should resolve")
            .files
            .is_empty());

        stage_conflict_entries(
            &fixture.repo_path,
            "removed.txt",
            &[(1, b"base\n"), (2, b"ours\n")],
            None,
            true,
        );
        resolve_conflict_version(
            fixture.repo_path.clone(),
            "removed.txt".to_string(),
            ConflictResolutionSide::Merged,
            None,
        )
        .expect("manual delete resolution should stage removal");
        assert!(!Path::new(&fixture.repo_path).join("removed.txt").exists());
        assert!(get_conflict_summary(fixture.repo_path.clone(), None)
            .expect("conflict summary should resolve")
            .files
            .is_empty());

        stage_conflict_entries(
            &fixture.repo_path,
            "removed.txt",
            &[(1, b"base\n"), (2, b"ours\n")],
            None,
            true,
        );
        resolve_conflict_version(
            fixture.repo_path.clone(),
            "removed.txt".to_string(),
            ConflictResolutionSide::Theirs,
            None,
        )
        .expect("delete-side resolution should succeed");
        assert!(!Path::new(&fixture.repo_path).join("removed.txt").exists());
        assert!(get_conflict_summary(fixture.repo_path.clone(), None)
            .expect("conflict summary should resolve")
            .files
            .is_empty());
    }

    #[test]
    fn merge_sessions_require_explicit_completion_or_abort() {
        let fixture = create_merge_conflict_session_fixture();
        let main_before = run_command("git", &["rev-parse", "main"], &fixture.repo_path)
            .expect("main sha should resolve");

        let result = merge_branches(
            fixture.repo_path.clone(),
            "feature/conflict".to_string(),
            "main".to_string(),
        )
        .expect("conflicted merge should return a session result");
        assert!(!result.ok);
        let conflict = result.conflict.expect("conflict summary should be present");
        assert_eq!(conflict.context_type, ConflictContextType::MergeSession);
        assert_eq!(conflict.operation, ConflictOperation::Merge);
        assert_eq!(conflict.source_branch.as_deref(), Some("feature/conflict"));
        assert_eq!(conflict.target_branch.as_deref(), Some("main"));
        assert_eq!(
            run_command("git", &["branch", "--show-current"], &fixture.repo_path)
                .expect("current branch should resolve"),
            "feature/conflict"
        );

        let session_id = conflict.session_id.expect("session id should be present");
        resolve_conflict_version(
            fixture.repo_path.clone(),
            "conflict.txt".to_string(),
            ConflictResolutionSide::Theirs,
            Some(session_id.clone()),
        )
        .expect("session conflict resolution should succeed");
        complete_merge_session(fixture.repo_path.clone(), session_id.clone())
            .expect("merge session completion should succeed");

        assert_eq!(
            run_command("git", &["branch", "--show-current"], &fixture.repo_path)
                .expect("current branch should resolve"),
            "feature/conflict"
        );
        assert_ne!(
            run_command("git", &["rev-parse", "main"], &fixture.repo_path)
                .expect("updated main sha should resolve"),
            main_before
        );
        assert_eq!(
            run_command("git", &["show", "main:conflict.txt"], &fixture.repo_path)
                .expect("merged file should resolve"),
            "feature"
        );
        assert!(get_conflict_summary(fixture.repo_path.clone(), Some(session_id)).is_err());
    }

    #[test]
    fn abort_merge_session_leaves_the_target_branch_unchanged() {
        let fixture = create_merge_conflict_session_fixture();
        let main_before = run_command("git", &["rev-parse", "main"], &fixture.repo_path)
            .expect("main sha should resolve");

        let result = merge_branches(
            fixture.repo_path.clone(),
            "feature/conflict".to_string(),
            "main".to_string(),
        )
        .expect("conflicted merge should return a session result");
        let session_id = result
            .conflict
            .expect("conflict summary should be present")
            .session_id
            .expect("session id should be present");

        abort_merge_session(fixture.repo_path.clone(), session_id.clone())
            .expect("merge session abort should succeed");

        assert_eq!(
            run_command("git", &["branch", "--show-current"], &fixture.repo_path)
                .expect("current branch should resolve"),
            "feature/conflict"
        );
        assert_eq!(
            run_command("git", &["rev-parse", "main"], &fixture.repo_path)
                .expect("main sha should resolve"),
            main_before
        );
        assert!(get_conflict_summary(fixture.repo_path.clone(), Some(session_id)).is_err());
    }

    #[test]
    fn get_pull_status_reports_behind_tracking_branch() {
        let (fixture, collaborator_path) = create_pull_fixture();

        fs::write(
            Path::new(&collaborator_path).join("README.md"),
            "root\nremote update\n",
        )
        .expect("remote update should be written");
        run_command(
            "git",
            &["commit", "-am", "remote update"],
            &collaborator_path,
        )
        .expect("remote commit should succeed");
        run_command("git", &["push", "origin", "main"], &collaborator_path)
            .expect("remote push should succeed");
        run_command("git", &["fetch", "origin"], &fixture.repo_path)
            .expect("local fetch should succeed");

        let status =
            get_pull_status(fixture.repo_path.clone(), None).expect("pull status should resolve");

        assert_eq!(status.branch_name.as_deref(), Some("main"));
        assert_eq!(status.upstream_name.as_deref(), Some("origin/main"));
        assert_eq!(status.remote_name.as_deref(), Some("origin"));
        assert_eq!(status.remote_branch_name.as_deref(), Some("main"));
        assert_eq!(status.ahead_count, 0);
        assert_eq!(status.behind_count, 1);
        assert!(status.can_pull);
        assert_eq!(status.state, "behind");
    }

    #[test]
    fn get_pull_status_can_target_a_non_current_local_branch() {
        let (fixture, collaborator_path) = create_pull_fixture();

        run_command(
            "git",
            &["checkout", "-b", "feature/current"],
            &fixture.repo_path,
        )
        .expect("feature branch should be created");
        fs::write(
            Path::new(&collaborator_path).join("README.md"),
            "root\nremote update\n",
        )
        .expect("remote update should be written");
        run_command(
            "git",
            &["commit", "-am", "remote update"],
            &collaborator_path,
        )
        .expect("remote commit should succeed");
        run_command("git", &["push", "origin", "main"], &collaborator_path)
            .expect("remote push should succeed");
        run_command("git", &["fetch", "origin"], &fixture.repo_path)
            .expect("local fetch should succeed");

        let status = get_pull_status(fixture.repo_path.clone(), Some("main".to_string()))
            .expect("targeted pull status should resolve");

        assert_eq!(status.branch_name.as_deref(), Some("main"));
        assert_eq!(status.upstream_name.as_deref(), Some("origin/main"));
        assert_eq!(status.remote_name.as_deref(), Some("origin"));
        assert_eq!(status.remote_branch_name.as_deref(), Some("main"));
        assert_eq!(status.ahead_count, 0);
        assert_eq!(status.behind_count, 1);
        assert!(status.can_pull);
        assert_eq!(status.state, "behind");
    }

    #[test]
    fn pull_current_branch_fast_forwards_to_upstream() {
        let (fixture, collaborator_path) = create_pull_fixture();

        fs::write(
            Path::new(&collaborator_path).join("README.md"),
            "root\nremote update\n",
        )
        .expect("remote update should be written");
        run_command(
            "git",
            &["commit", "-am", "remote update"],
            &collaborator_path,
        )
        .expect("remote commit should succeed");
        run_command("git", &["push", "origin", "main"], &collaborator_path)
            .expect("remote push should succeed");

        pull_current_branch(fixture.repo_path.clone(), None).expect("pull should succeed");

        let current_branch = run_command("git", &["branch", "--show-current"], &fixture.repo_path)
            .expect("current branch should resolve");
        let head = run_command("git", &["rev-parse", "HEAD"], &fixture.repo_path)
            .expect("head should resolve");
        let upstream_head = run_command("git", &["rev-parse", "origin/main"], &fixture.repo_path)
            .expect("upstream head should resolve");
        let readme = fs::read_to_string(Path::new(&fixture.repo_path).join("README.md"))
            .expect("README should be readable");
        let status =
            get_pull_status(fixture.repo_path.clone(), None).expect("pull status should resolve");

        assert_eq!(current_branch, "main");
        assert_eq!(head, upstream_head);
        assert!(readme.contains("remote update"));
        assert_eq!(status.behind_count, 0);
        assert!(!status.can_pull);
        assert_eq!(status.state, "upToDate");
    }

    #[test]
    fn pull_current_branch_can_fast_forward_a_non_current_branch() {
        let (fixture, collaborator_path) = create_pull_fixture();

        run_command(
            "git",
            &["checkout", "-b", "feature/current"],
            &fixture.repo_path,
        )
        .expect("feature branch should be created");
        fs::write(
            Path::new(&collaborator_path).join("README.md"),
            "root\nremote update\n",
        )
        .expect("remote update should be written");
        run_command(
            "git",
            &["commit", "-am", "remote update"],
            &collaborator_path,
        )
        .expect("remote commit should succeed");
        run_command("git", &["push", "origin", "main"], &collaborator_path)
            .expect("remote push should succeed");

        pull_current_branch(fixture.repo_path.clone(), Some("main".to_string()))
            .expect("targeted pull should succeed");

        let current_branch = run_command("git", &["branch", "--show-current"], &fixture.repo_path)
            .expect("current branch should resolve");
        let local_main_head =
            run_command("git", &["rev-parse", "refs/heads/main"], &fixture.repo_path)
                .expect("main head should resolve");
        let upstream_head = run_command("git", &["rev-parse", "origin/main"], &fixture.repo_path)
            .expect("upstream head should resolve");
        let worktree_readme = fs::read_to_string(Path::new(&fixture.repo_path).join("README.md"))
            .expect("README should be readable");
        let main_readme = run_command("git", &["show", "main:README.md"], &fixture.repo_path)
            .expect("main README should resolve");
        let status = get_pull_status(fixture.repo_path.clone(), Some("main".to_string()))
            .expect("pull status should resolve");

        assert_eq!(current_branch, "feature/current");
        assert_eq!(local_main_head, upstream_head);
        assert_eq!(worktree_readme, "root\n");
        assert!(main_readme.contains("remote update"));
        assert_eq!(status.behind_count, 0);
        assert!(!status.can_pull);
        assert_eq!(status.state, "upToDate");
    }
}
