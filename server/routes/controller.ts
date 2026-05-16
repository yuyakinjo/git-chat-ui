import { Router } from "express";

import { clampCommitLogPageSize } from "../../shared/config.js";
import { getControllerSnapshot } from "../gitService.js";
import { readConfig } from "../configStore.js";

import { getRepoPathFromQuery } from "./helpers.js";

interface ControllerRouterDependencies {
  getControllerSnapshot?: typeof getControllerSnapshot;
  readConfig?: typeof readConfig;
}

function parseNumberQuery(value: unknown, fallback: number): number {
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function parseBooleanQuery(value: unknown, fallback: boolean): boolean {
  if (typeof value === "string" && value.trim()) {
    if (value === "true") {
      return true;
    }

    if (value === "false") {
      return false;
    }
  }

  return fallback;
}

export function createControllerRouter({
  getControllerSnapshot: getControllerSnapshotImpl = getControllerSnapshot,
  readConfig: readConfigImpl = readConfig,
}: ControllerRouterDependencies = {}): Router {
  const router = Router();

  router.get("/api/controller/snapshot", async (request, response, next) => {
    try {
      const appConfig = await readConfigImpl();
      const defaultLimit = clampCommitLogPageSize(appConfig.commitLogPageSize);
      const repoPath = getRepoPathFromQuery(request);
      const ref = typeof request.query.ref === "string" ? request.query.ref : undefined;
      const compareRefQuery = request.query.compareRef;
      const compareRefs = Array.isArray(compareRefQuery)
        ? compareRefQuery.filter((value): value is string => typeof value === "string")
        : typeof compareRefQuery === "string"
          ? [compareRefQuery]
          : undefined;
      const snapshot = await getControllerSnapshotImpl({
        repoPath,
        ref,
        compareRefs,
        offset: parseNumberQuery(request.query.offset, 0),
        limit: clampCommitLogPageSize(parseNumberQuery(request.query.limit, defaultLimit)),
        includeCommits: parseBooleanQuery(request.query.includeCommits, true),
      });

      response.json(snapshot);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export default createControllerRouter();
