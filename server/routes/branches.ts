import { Router } from "express";

import {
  checkoutRef,
  createBranch,
  deleteBranch,
  getBranches,
  getOpenPullRequests,
  getPullStatus,
  mergeBranches,
  pullCurrentBranch,
} from "../gitService.js";

import { getRepoPathFromQuery, getRequiredString } from "./helpers.js";

const router = Router();

router.get("/api/branches", async (request, response, next) => {
  try {
    const repoPath = getRepoPathFromQuery(request);
    const branches = await getBranches(repoPath);
    response.json(branches);
  } catch (error) {
    next(error);
  }
});

router.get("/api/branches/pull-requests", async (request, response, next) => {
  try {
    const repoPath = getRepoPathFromQuery(request);
    const pullRequests = await getOpenPullRequests(repoPath);
    response.json({ pullRequests });
  } catch (error) {
    next(error);
  }
});

router.post("/api/checkout", async (request, response, next) => {
  try {
    const repoPath = getRequiredString(request.body.repoPath, "repoPath");
    const ref = getRequiredString(request.body.ref, "ref");
    await checkoutRef(repoPath, ref);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.post("/api/branches/create", async (request, response, next) => {
  try {
    const repoPath = getRequiredString(request.body.repoPath, "repoPath");
    const baseBranch = getRequiredString(request.body.baseBranch, "baseBranch");
    const newBranch = getRequiredString(request.body.newBranch, "newBranch");
    await createBranch(repoPath, baseBranch, newBranch);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.post("/api/branches/merge", async (request, response, next) => {
  try {
    const repoPath = getRequiredString(request.body.repoPath, "repoPath");
    const sourceBranch = getRequiredString(request.body.sourceBranch, "sourceBranch");
    const targetBranch = getRequiredString(request.body.targetBranch, "targetBranch");
    const result = await mergeBranches(repoPath, sourceBranch, targetBranch);
    response.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/api/branches/delete", async (request, response, next) => {
  try {
    const repoPath = getRequiredString(request.body.repoPath, "repoPath");
    const branchName = getRequiredString(request.body.branchName, "branchName");
    const branchType = getRequiredString(request.body.branchType, "branchType");
    const forceDelete = request.body.forceDelete === true;
    if (branchType !== "local" && branchType !== "remote") {
      throw new Error("branchType must be local or remote.");
    }

    await deleteBranch(repoPath, branchName, branchType, forceDelete);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.get("/api/pull/status", async (request, response, next) => {
  try {
    const repoPath = getRepoPathFromQuery(request);
    const branchName =
      typeof request.query.branchName === "string" && request.query.branchName.trim()
        ? request.query.branchName
        : undefined;
    const status = await getPullStatus(repoPath, branchName);
    response.json(status);
  } catch (error) {
    next(error);
  }
});

router.post("/api/pull", async (request, response, next) => {
  try {
    const repoPath = getRequiredString(request.body.repoPath, "repoPath");
    const branchName =
      typeof request.body.branchName === "string" && request.body.branchName.trim()
        ? request.body.branchName
        : undefined;
    await pullCurrentBranch(repoPath, branchName);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export default router;
