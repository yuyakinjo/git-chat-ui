import type { AiProvider, OpenAiReasoningEffort } from "./ai.js";
import { DEFAULT_COMMIT_TITLE_PROMPT, DEFAULT_OPENAI_MODEL } from "./ai.js";
import type { RepositoryAssistantPolicies } from "./repositoryAssistant.js";

export type CommitGraphMode = "simple" | "detailed";
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

export interface AppConfig {
  openAiToken: string;
  openAiModel: string;
  repositoryAssistantOpenAiModel: string;
  repositoryAssistantReasoningEffort: OpenAiReasoningEffort;
  claudeCodeToken: string;
  selectedAiProvider: AiProvider;
  commitTitlePrompt: string;
  commitGraphMode: CommitGraphMode;
  commitGraphStyle: CommitGraphStyle;
  commitMergeAnimation: CommitMergeAnimation;
  diffViewerMode: DiffViewerMode;
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
  commitGraphMode: "detailed",
  commitGraphStyle: "standard",
  commitMergeAnimation: "none",
  diffViewerMode: "builtin",
  repositoryScanDepth: 4,
  repositoryAssistantPolicies: {},
  recentlyUsed: [],
  windowState: null,
};
