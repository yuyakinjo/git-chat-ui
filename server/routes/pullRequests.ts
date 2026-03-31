import { Router } from "express";

import { createPullRequest, preparePullRequest } from "../gitService.js";

import { getRequiredString } from "./helpers.js";

const router = Router();

router.post("/api/pull-request/prepare", async (request, response, next) => {
  try {
    const repoPath = getRequiredString(request.body.repoPath, "repoPath");
    const sourceBranch = getRequiredString(request.body.sourceBranch, "sourceBranch");
    const targetBranch = getRequiredString(request.body.targetBranch, "targetBranch");
    const result = await preparePullRequest(repoPath, sourceBranch, targetBranch);
    response.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/api/pull-request", async (request, response, next) => {
  try {
    const repoPath = getRequiredString(request.body.repoPath, "repoPath");
    const sourceBranch = getRequiredString(request.body.sourceBranch, "sourceBranch");
    const targetBranch = getRequiredString(request.body.targetBranch, "targetBranch");
    const pushSourceBranch = Boolean(request.body.pushSourceBranch);
    const result = await createPullRequest(repoPath, sourceBranch, targetBranch, pushSourceBranch);
    response.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
