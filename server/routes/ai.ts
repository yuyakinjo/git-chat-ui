import { Router } from "express";

import { normalizeOpenAiReasoningEffort } from "../../shared/ai.js";
import { readConfig } from "../configStore.js";
import { getDiffSnippet } from "../gitService.js";
import { getAiService, type AiService } from "../ai/service.js";
import { generateRepositoryAssistantReply } from "../ai/repositoryAssistant.js";
import type { RepositoryAssistantMessage, RepositoryAssistantResponse } from "../types.js";

import { getRequiredString, parseSelectedAiProvider } from "./helpers.js";

interface AiRouterDependencies {
  aiService?: Pick<AiService, "generateCommitTitle">;
  readConfig?: typeof readConfig;
  getDiffSnippet?: typeof getDiffSnippet;
  generateRepositoryAssistantReply?: typeof generateRepositoryAssistantReply;
}

export function createAiRouter({
  aiService = getAiService(),
  readConfig: readConfigImpl = readConfig,
  getDiffSnippet: getDiffSnippetImpl = getDiffSnippet,
  generateRepositoryAssistantReply:
    generateRepositoryAssistantReplyImpl = generateRepositoryAssistantReply,
}: AiRouterDependencies = {}): Router {
  const router = Router();

  router.post("/api/generate-title", async (request, response, next) => {
    try {
      const repoPath = getRequiredString(request.body.repoPath, "repoPath");
      const changedFiles = Array.isArray(request.body.changedFiles)
        ? request.body.changedFiles.filter(
            (value: unknown): value is string => typeof value === "string",
          )
        : [];

      const config = await readConfigImpl();
      const openAiToken =
        typeof request.body.openAiToken === "string"
          ? request.body.openAiToken
          : config.openAiToken;
      const openAiModel =
        typeof request.body.openAiModel === "string"
          ? request.body.openAiModel
          : config.openAiModel;
      const claudeCodeToken =
        typeof request.body.claudeCodeToken === "string"
          ? request.body.claudeCodeToken
          : config.claudeCodeToken;
      const selectedAiProvider =
        parseSelectedAiProvider(request.body.selectedAiProvider) ?? config.selectedAiProvider;
      const commitTitlePrompt =
        typeof request.body.commitTitlePrompt === "string"
          ? request.body.commitTitlePrompt
          : config.commitTitlePrompt;
      const diffSnippet = await getDiffSnippetImpl(repoPath, changedFiles);
      const commitMessage = await aiService.generateCommitTitle({
        openAiToken,
        openAiModel,
        claudeCodeToken,
        selectedAiProvider,
        commitTitlePrompt,
        changedFiles,
        diffSnippet,
      });

      response.json(commitMessage);
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/ai/chat", async (request, response, next) => {
    try {
      const repoPath = getRequiredString(request.body.repoPath, "repoPath");
      const messages = Array.isArray(request.body.messages)
        ? request.body.messages.filter(
            (value: unknown): value is RepositoryAssistantMessage =>
              Boolean(value) &&
              typeof value === "object" &&
              typeof (value as RepositoryAssistantMessage).id === "string" &&
              ((value as RepositoryAssistantMessage).role === "user" ||
                (value as RepositoryAssistantMessage).role === "assistant") &&
              typeof (value as RepositoryAssistantMessage).content === "string" &&
              typeof (value as RepositoryAssistantMessage).createdAt === "string",
          )
        : [];
      const config = await readConfigImpl();
      const openAiModel =
        typeof request.body.openAiModel === "string"
          ? request.body.openAiModel
          : config.openAiModel;
      const reasoningEffort = normalizeOpenAiReasoningEffort(request.body.reasoningEffort);
      const assistantMessage = await generateRepositoryAssistantReplyImpl({
        repoPath,
        messages,
        openAiToken: config.openAiToken,
        openAiModel,
        reasoningEffort,
      });

      const payload: RepositoryAssistantResponse = {
        message: {
          id:
            globalThis.crypto?.randomUUID?.() ??
            `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          role: "assistant",
          content: assistantMessage,
          createdAt: new Date().toISOString(),
        },
      };

      response.json(payload);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export default createAiRouter();
