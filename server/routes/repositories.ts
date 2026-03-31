import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';

import { readConfig, setRecentlyUsedRepository } from '../configStore.js';
import { discoverRepositories, getRepositoryGithubUrl, resolveRepositories } from '../gitService.js';

import { getRepoPathFromQuery, getRequiredString } from './helpers.js';

const router = Router();

router.get('/api/health', (_request, response) => {
  response.json({ ok: true });
});

router.get('/api/repositories', async (request, response, next) => {
  try {
    const query = typeof request.query.query === 'string' ? request.query.query : '';
    const config = await readConfig();
    const recentMap = new Map(config.recentlyUsed.map((item) => [item.path, item.usedAt]));
    const repositories = await discoverRepositories({
      query,
      recentMap,
      maxDepth: config.repositoryScanDepth
    });
    response.json({ repositories });
  } catch (error) {
    next(error);
  }
});

router.post('/api/repositories/resolve', async (request, response, next) => {
  try {
    const repoPaths = Array.isArray(request.body.repoPaths)
      ? request.body.repoPaths.filter((value: unknown): value is string => typeof value === 'string')
      : [];
    const repositories = await resolveRepositories(repoPaths);
    response.json({ repositories });
  } catch (error) {
    next(error);
  }
});

router.post('/api/repositories/recent', async (request, response, next) => {
  try {
    const repoPath = getRequiredString(request.body.repoPath, 'repoPath');
    await setRecentlyUsedRepository(repoPath);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.get('/api/repositories/mutation-safety', async (request, response, next) => {
  try {
    const repoPath = getRepoPathFromQuery(request);
    const [resolvedRepoPath, resolvedAppRootPath] = await Promise.all([
      fs.realpath(repoPath).catch(() => path.resolve(repoPath)),
      fs.realpath(process.cwd()).catch(() => path.resolve(process.cwd()))
    ]);

    response.json({
      isSelfRepository: resolvedRepoPath === resolvedAppRootPath
    });
  } catch (error) {
    next(error);
  }
});

router.get('/api/repositories/github-url', async (request, response, next) => {
  try {
    const repoPath = getRepoPathFromQuery(request);
    const url = await getRepositoryGithubUrl(repoPath);
    response.json({ url });
  } catch (error) {
    next(error);
  }
});

export default router;
