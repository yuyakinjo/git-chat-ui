import type { AiProvider, GeneratedCommitMessage } from "../../shared/ai.js";
import { createDirectAiService } from "./directService.js";

export interface GenerateCommitTitleInput {
  openAiToken: string;
  openAiModel: string;
  claudeCodeToken: string;
  selectedAiProvider: AiProvider;
  commitTitlePrompt: string;
  changedFiles: string[];
  diffSnippet: string;
}

export interface AiService {
  generateCommitTitle(input: GenerateCommitTitleInput): Promise<GeneratedCommitMessage>;
  listOpenAiModels(token: string): Promise<string[]>;
  validateOpenAiToken(token: string): Promise<boolean>;
  validateClaudeCodeToken(token: string): Promise<boolean>;
}

const defaultAiService: AiService = createDirectAiService();

export function getAiService(): AiService {
  return defaultAiService;
}

export async function generateCommitTitle(
  input: GenerateCommitTitleInput,
): Promise<GeneratedCommitMessage> {
  return defaultAiService.generateCommitTitle(input);
}

export async function listOpenAiModels(token: string): Promise<string[]> {
  return defaultAiService.listOpenAiModels(token);
}

export async function validateOpenAiToken(token: string): Promise<boolean> {
  return defaultAiService.validateOpenAiToken(token);
}

export async function validateClaudeCodeToken(token: string): Promise<boolean> {
  return defaultAiService.validateClaudeCodeToken(token);
}
