import type { AiProvider, OpenAiReasoningEffort } from "./ai.js";
import { DEFAULT_COMMIT_TITLE_PROMPT, DEFAULT_OPENAI_MODEL } from "./ai.js";
import type { RepositoryAssistantPolicies } from "./repositoryAssistant.js";

export type CommitGraphStyle = "standard" | "japaneseExpress";
export type CommitMergeAnimation =
  | "none"
  | "pulse"
  | "ripple"
  | "orbit"
  | "shimmer"
  | "metaball"
  | "morph"
  | "dissolve"
  | "particle";
export type DiffViewerMode = "builtin" | "pierre";

export const COMMIT_MERGE_ANIMATIONS: readonly CommitMergeAnimation[] = [
  "none",
  "pulse",
  "ripple",
  "orbit",
  "shimmer",
  "metaball",
  "morph",
  "dissolve",
  "particle",
];

export interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

/** コミットログ一覧のページサイズ（この範囲にクランプ） */
export const COMMIT_LOG_PAGE_SIZE_MIN = 100;
export const COMMIT_LOG_PAGE_SIZE_MAX = 200;
export const DEFAULT_COMMIT_LOG_PAGE_SIZE = COMMIT_LOG_PAGE_SIZE_MIN;

export function clampCommitLogPageSize(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_COMMIT_LOG_PAGE_SIZE;
  }
  const rounded = Math.trunc(value);
  return Math.min(
    Math.max(rounded, COMMIT_LOG_PAGE_SIZE_MIN),
    COMMIT_LOG_PAGE_SIZE_MAX,
  );
}

export interface AppConfig {
  openAiToken: string;
  openAiModel: string;
  repositoryAssistantOpenAiModel: string;
  repositoryAssistantReasoningEffort: OpenAiReasoningEffort;
  claudeCodeToken: string;
  selectedAiProvider: AiProvider;
  commitTitlePrompt: string;
  commitGraphStyle: CommitGraphStyle;
  commitMergeAnimation: CommitMergeAnimation;
  diffViewerMode: DiffViewerMode;
  /** UI / API が一度に読み込むコミット数（100–200） */
  commitLogPageSize: number;
  repositoryScanDepth: number;
  repositoryAssistantPolicies: RepositoryAssistantPolicies;
  recentlyUsed: Array<{
    path: string;
    usedAt: string;
  }>;
  windowState?: WindowState | null;
}

export type AiGenerationConfig = Pick<
  AppConfig,
  "openAiToken" | "openAiModel" | "claudeCodeToken" | "selectedAiProvider" | "commitTitlePrompt"
>;

export const DEFAULT_APP_CONFIG: AppConfig = {
  openAiToken: "",
  openAiModel: DEFAULT_OPENAI_MODEL,
  repositoryAssistantOpenAiModel: DEFAULT_OPENAI_MODEL,
  repositoryAssistantReasoningEffort: "default",
  claudeCodeToken: "",
  selectedAiProvider: "openAi",
  commitTitlePrompt: DEFAULT_COMMIT_TITLE_PROMPT,
  commitGraphStyle: "standard",
  commitMergeAnimation: "none",
  diffViewerMode: "builtin",
  commitLogPageSize: DEFAULT_COMMIT_LOG_PAGE_SIZE,
  repositoryScanDepth: 4,
  repositoryAssistantPolicies: {},
  recentlyUsed: [],
  windowState: null,
};
