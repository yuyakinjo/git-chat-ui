import { Router } from "express";

import {
  abortMergeSession,
  completeMergeSession,
  getConflictFileDetail,
  getConflictSummary,
  resolveConflictVersion,
} from "../gitService.js";

import {
  getRepoPathFromQuery,
  getRequiredString,
  parseConflictResolutionSide,
} from "./helpers.js";

const router = Router();

router.get("/api/conflicts", async (request, response, next) => {
  try {
    const repoPath = getRepoPathFromQuery(request);
    const sessionId =
      typeof request.query.sessionId === "string" && request.query.sessionId.trim()
        ? request.query.sessionId
        : null;
    const summary = await getConflictSummary(repoPath, sessionId);
    response.json(summary);
  } catch (error) {
    next(error);
  }
});

router.get("/api/conflicts/file", async (request, response, next) => {
  try {
    const repoPath = getRepoPathFromQuery(request);
    const file = getRequiredString(request.query.file, "file");
    const sessionId =
      typeof request.query.sessionId === "string" && request.query.sessionId.trim()
        ? request.query.sessionId
        : null;
    const detail = await getConflictFileDetail(repoPath, file, sessionId);
    response.json(detail);
  } catch (error) {
    next(error);
  }
});

router.post("/api/conflicts/resolve", async (request, response, next) => {
  try {
    const repoPath = getRequiredString(request.body.repoPath, "repoPath");
    const file = getRequiredString(request.body.file, "file");
    const side = parseConflictResolutionSide(request.body.side);
    const sessionId =
      typeof request.body.sessionId === "string" && request.body.sessionId.trim()
        ? request.body.sessionId
        : null;
    await resolveConflictVersion({ repoPath, file, side, sessionId });
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.post("/api/conflicts/complete-merge-session", async (request, response, next) => {
  try {
    const repoPath = getRequiredString(request.body.repoPath, "repoPath");
    const sessionId = getRequiredString(request.body.sessionId, "sessionId");
    await completeMergeSession(repoPath, sessionId);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.post("/api/conflicts/abort-merge-session", async (request, response, next) => {
  try {
    const repoPath = getRequiredString(request.body.repoPath, "repoPath");
    const sessionId = getRequiredString(request.body.sessionId, "sessionId");
    await abortMergeSession(repoPath, sessionId);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export default router;
