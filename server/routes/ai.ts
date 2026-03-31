import { Router } from "express";

import { generateCommitTitle } from "../aiService.js";
import { readConfig } from "../configStore.js";
import { getDiffSnippet } from "../gitService.js";

import { getRequiredString, parseSelectedAiProvider } from "./helpers.js";

const router = Router();

router.post("/api/generate-title", async (request, response, next) => {
  try {
    const repoPath = getRequiredString(request.body.repoPath, "repoPath");
    const changedFiles = Array.isArray(request.body.changedFiles)
      ? request.body.changedFiles.filter(
          (value: unknown): value is string => typeof value === "string",
        )
      : [];

    const config = await readConfig();
    const openAiToken =
      typeof request.body.openAiToken === "string" ? request.body.openAiToken : config.openAiToken;
    const openAiModel =
      typeof request.body.openAiModel === "string" ? request.body.openAiModel : config.openAiModel;
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
    const diffSnippet = await getDiffSnippet(repoPath, changedFiles);
    const commitMessage = await generateCommitTitle({
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

export default router;
