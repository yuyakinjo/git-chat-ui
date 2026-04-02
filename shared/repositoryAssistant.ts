import type { OpenAiReasoningEffort } from "./ai.js";

export type RepositoryAssistantMessageRole = "user" | "assistant";

export interface RepositoryAssistantMessage {
  id: string;
  role: RepositoryAssistantMessageRole;
  content: string;
  createdAt: string;
}

export interface RepositoryAssistantResponse {
  message: RepositoryAssistantMessage;
}

export interface RepositoryAssistantSettings {
  openAiModel: string;
  reasoningEffort: OpenAiReasoningEffort;
}
