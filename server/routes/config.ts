import { Router } from "express";

import { listOpenAiModels, validateClaudeCodeToken, validateOpenAiToken } from "../aiService.js";
import { readConfig, writeConfig } from "../configStore.js";
import type { AppConfig } from "../types.js";

import {
  parseCommitGraphMode,
  parseRepositoryScanDepth,
  parseSelectedAiProvider,
} from "./helpers.js";

const router = Router();

router.get("/api/config", async (_request, response, next) => {
  try {
    const config = await readConfig();
    response.json(config);
  } catch (error) {
    next(error);
  }
});

router.put("/api/config", async (request, response, next) => {
  try {
    const current = await readConfig();
    const parsedGraphMode = parseCommitGraphMode(request.body.commitGraphMode);
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
      repositoryScanDepth: parsedRepositoryScanDepth ?? current.repositoryScanDepth,
    };

    await writeConfig(nextConfig);

    response.json({ ok: true, config: await readConfig() });
  } catch (error) {
    next(error);
  }
});

router.post("/api/config/validate-openai-token", async (request, response, next) => {
  try {
    const token = typeof request.body.token === "string" ? request.body.token : "";
    const valid = await validateOpenAiToken(token);
    response.json({ valid });
  } catch (error) {
    next(error);
  }
});

router.post("/api/config/openai-models", async (request, response, next) => {
  try {
    const config = await readConfig();
    const token = typeof request.body.token === "string" ? request.body.token : config.openAiToken;
    const models = await listOpenAiModels(token);
    response.json({ models });
  } catch (error) {
    next(error);
  }
});

router.post("/api/config/validate-claude-code-token", async (request, response, next) => {
  try {
    const token = typeof request.body.token === "string" ? request.body.token : "";
    const valid = await validateClaudeCodeToken(token);
    response.json({ valid });
  } catch (error) {
    next(error);
  }
});

export default router;
