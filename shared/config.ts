import type { AiProvider, OpenAiReasoningEffort } from "./ai.js";
import { DEFAULT_COMMIT_TITLE_PROMPT, DEFAULT_OPENAI_MODEL } from "./ai.js";

export type CommitGraphMode = "simple" | "detailed";

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
  repositoryScanDepth: number;
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
  repositoryScanDepth: 4,
  recentlyUsed: [],
  windowState: null,
};
