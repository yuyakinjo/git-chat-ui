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
