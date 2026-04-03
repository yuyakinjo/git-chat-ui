import { Router } from "express";

import { normalizeOpenAiReasoningEffort } from "../../shared/ai.js";
import {
  isRepositoryAssistantActionAllowed,
  normalizeRepositoryAssistantAction,
  type RepositoryAssistantActionExecutionResponse,
  type RepositoryAssistantResponse,
} from "../../shared/repositoryAssistant.js";
import { readConfig } from "../configStore.js";
import { getDiffSnippet } from "../gitService.js";
import { getAiService, type AiService } from "../ai/service.js";
import { generateRepositoryAssistantReply } from "../ai/repositoryAssistant.js";
import { getRepositoryAssistantUserProfile } from "../ai/repositoryAssistantUserProfile.js";
import {
  assertRepositoryAssistantActionSafe,
  executeRepositoryAssistantAction,
} from "../ai/repositoryAssistantActions.js";
import type { RepositoryAssistantMessage } from "../types.js";

import { getRepoPathFromQuery, getRequiredString, parseSelectedAiProvider } from "./helpers.js";

interface AiRouterDependencies {
  aiService?: Pick<AiService, "generateCommitTitle">;
  readConfig?: typeof readConfig;
  getDiffSnippet?: typeof getDiffSnippet;
  generateRepositoryAssistantReply?: typeof generateRepositoryAssistantReply;
  getRepositoryAssistantUserProfile?: typeof getRepositoryAssistantUserProfile;
  assertRepositoryAssistantActionSafe?: typeof assertRepositoryAssistantActionSafe;
  executeRepositoryAssistantAction?: typeof executeRepositoryAssistantAction;
}

export function createAiRouter({
  aiService = getAiService(),
  readConfig: readConfigImpl = readConfig,
  getDiffSnippet: getDiffSnippetImpl = getDiffSnippet,
  generateRepositoryAssistantReply:
    generateRepositoryAssistantReplyImpl = generateRepositoryAssistantReply,
  getRepositoryAssistantUserProfile:
    getRepositoryAssistantUserProfileImpl = getRepositoryAssistantUserProfile,
  assertRepositoryAssistantActionSafe:
    assertRepositoryAssistantActionSafeImpl = assertRepositoryAssistantActionSafe,
  executeRepositoryAssistantAction:
    executeRepositoryAssistantActionImpl = executeRepositoryAssistantAction,
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
          : config.repositoryAssistantOpenAiModel;
      const reasoningEffort =
        request.body.reasoningEffort === undefined
          ? config.repositoryAssistantReasoningEffort
          : normalizeOpenAiReasoningEffort(request.body.reasoningEffort);
      const assistantMessage = await generateRepositoryAssistantReplyImpl({
        repoPath,
        messages,
        openAiToken: config.openAiToken,
        openAiModel,
        reasoningEffort,
      });

      response.json(assistantMessage satisfies RepositoryAssistantResponse);
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/ai/user-profile", async (request, response, next) => {
    try {
      const repoPath = getRepoPathFromQuery(request);
      response.json(await getRepositoryAssistantUserProfileImpl(repoPath));
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/ai/execute", async (request, response, next) => {
    try {
      const repoPath = getRequiredString(request.body.repoPath, "repoPath");
      const action = normalizeRepositoryAssistantAction(request.body.action);
      if (!action) {
        throw new Error("action is invalid.");
      }

      const config = await readConfigImpl();
      if (
        !isRepositoryAssistantActionAllowed(config.repositoryAssistantPolicies, repoPath, action)
      ) {
        throw new Error(`${action.id} is not allowlisted for this repository.`);
      }

      await assertRepositoryAssistantActionSafeImpl(repoPath, action, {
        allowSelfRepositoryCurrentTargetMerge:
          request.body.allowSelfRepositoryCurrentTargetMerge === true,
        allowSelfRepositoryConflictResolution:
          request.body.allowSelfRepositoryConflictResolution === true,
      });
      const payload: RepositoryAssistantActionExecutionResponse = {
        result: await executeRepositoryAssistantActionImpl(repoPath, action),
      };
      response.json(payload);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export default createAiRouter();
