import { Router } from "express";

import { normalizeOpenAiReasoningEffort } from "../../shared/ai.js";
import { normalizeRepositoryAssistantPolicies } from "../../shared/repositoryAssistant.js";
import { readConfig, writeConfig } from "../configStore.js";
import { getAiService, type AiService } from "../ai/service.js";
import type { AppConfig } from "../types.js";

import {
  parseCommitGraphMode,
  parseCommitGraphStyle,
  parseRepositoryScanDepth,
  parseSelectedAiProvider,
} from "./helpers.js";

interface ConfigRouterDependencies {
  aiService?: Pick<
    AiService,
    "listOpenAiModels" | "validateClaudeCodeToken" | "validateOpenAiToken"
  >;
  readConfig?: typeof readConfig;
  writeConfig?: typeof writeConfig;
}

export function createConfigRouter({
  aiService = getAiService(),
  readConfig: readConfigImpl = readConfig,
  writeConfig: writeConfigImpl = writeConfig,
}: ConfigRouterDependencies = {}): Router {
  const router = Router();

  router.get("/api/config", async (_request, response, next) => {
    try {
      const config = await readConfigImpl();
      response.json(config);
    } catch (error) {
      next(error);
    }
  });

  router.put("/api/config", async (request, response, next) => {
    try {
      const current = await readConfigImpl();
      const parsedGraphMode = parseCommitGraphMode(request.body.commitGraphMode);
      const parsedGraphStyle = parseCommitGraphStyle(request.body.commitGraphStyle);
      const parsedSelectedAiProvider = parseSelectedAiProvider(request.body.selectedAiProvider);
      const parsedRepositoryScanDepth = parseRepositoryScanDepth(request.body.repositoryScanDepth);

      const nextConfig: AppConfig = {
        ...current,
        openAiToken:
          typeof request.body.openAiToken === "string"
            ? request.body.openAiToken
            : current.openAiToken,
        openAiModel:
          typeof request.body.openAiModel === "string"
            ? request.body.openAiModel
            : current.openAiModel,
        repositoryAssistantOpenAiModel:
          typeof request.body.repositoryAssistantOpenAiModel === "string"
            ? request.body.repositoryAssistantOpenAiModel
            : current.repositoryAssistantOpenAiModel,
        repositoryAssistantReasoningEffort:
          request.body.repositoryAssistantReasoningEffort === undefined
            ? current.repositoryAssistantReasoningEffort
            : normalizeOpenAiReasoningEffort(request.body.repositoryAssistantReasoningEffort),
        claudeCodeToken:
          typeof request.body.claudeCodeToken === "string"
            ? request.body.claudeCodeToken
            : current.claudeCodeToken,
        selectedAiProvider: parsedSelectedAiProvider ?? current.selectedAiProvider,
        commitTitlePrompt:
          typeof request.body.commitTitlePrompt === "string"
            ? request.body.commitTitlePrompt
            : current.commitTitlePrompt,
        commitGraphMode: parsedGraphMode ?? current.commitGraphMode,
        commitGraphStyle: parsedGraphStyle ?? current.commitGraphStyle,
        repositoryScanDepth: parsedRepositoryScanDepth ?? current.repositoryScanDepth,
        repositoryAssistantPolicies:
          request.body.repositoryAssistantPolicies === undefined
            ? current.repositoryAssistantPolicies
            : normalizeRepositoryAssistantPolicies(request.body.repositoryAssistantPolicies),
      };

      await writeConfigImpl(nextConfig);

      response.json({ ok: true, config: await readConfigImpl() });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/config/validate-openai-token", async (request, response, next) => {
    try {
      const token = typeof request.body.token === "string" ? request.body.token : "";
      const valid = await aiService.validateOpenAiToken(token);
      response.json({ valid });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/config/openai-models", async (request, response, next) => {
    try {
      const config = await readConfigImpl();
      const token =
        typeof request.body.token === "string" ? request.body.token : config.openAiToken;
      const models = await aiService.listOpenAiModels(token);
      response.json({ models });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/config/validate-claude-code-token", async (request, response, next) => {
    try {
      const token = typeof request.body.token === "string" ? request.body.token : "";
      const valid = await aiService.validateClaudeCodeToken(token);
      response.json({ valid });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export default createConfigRouter();
