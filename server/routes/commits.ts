import { Router } from 'express';

import {
  commitChanges,
  getBranchDiffDetail,
  getCommitDetail,
  getCommits,
  getRepositoryFingerprint,
  pushChanges
} from '../gitService.js';

import { getRepoPathFromQuery, getRequiredString } from './helpers.js';

const router = Router();

router.get('/api/commits', async (request, response, next) => {
  try {
    const repoPath = getRepoPathFromQuery(request);
    const ref = typeof request.query.ref === 'string' ? request.query.ref : undefined;
    const compareRefQuery = request.query.compareRef;
    const compareRefs = Array.isArray(compareRefQuery)
      ? compareRefQuery.filter((value): value is string => typeof value === 'string')
      : typeof compareRefQuery === 'string'
        ? [compareRefQuery]
        : undefined;
    const offset = Number(request.query.offset ?? 0);
    const limit = Number(request.query.limit ?? 50);

    const result = await getCommits({
      repoPath,
      ref,
      compareRefs,
      offset: Number.isFinite(offset) ? offset : 0,
      limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 50
    });

    response.json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/api/commits/detail', async (request, response, next) => {
  try {
    const repoPath = getRepoPathFromQuery(request);
    const sha = getRequiredString(request.query.sha, 'sha');
    const detail = await getCommitDetail(repoPath, sha);
    response.json(detail);
  } catch (error) {
    next(error);
  }
});

router.get('/api/branches/diff', async (request, response, next) => {
  try {
    const repoPath = getRepoPathFromQuery(request);
    const baseRef = getRequiredString(request.query.baseRef, 'baseRef');
    const targetRef = getRequiredString(request.query.targetRef, 'targetRef');
    const detail = await getBranchDiffDetail({
      repoPath,
      baseRef,
      targetRef
    });
    response.json(detail);
  } catch (error) {
    next(error);
  }
});

router.post('/api/commit', async (request, response, next) => {
  try {
    const repoPath = getRequiredString(request.body.repoPath, 'repoPath');
    const title = getRequiredString(request.body.title, 'title');
    const description = typeof request.body.description === 'string' ? request.body.description : '';
    await commitChanges(repoPath, title, description);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.post('/api/push', async (request, response, next) => {
  try {
    const repoPath = getRequiredString(request.body.repoPath, 'repoPath');
    await pushChanges(repoPath);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.get('/api/updates', async (request, response, next) => {
  try {
    const repoPath = getRepoPathFromQuery(request);
    const fingerprint = await getRepositoryFingerprint(repoPath);
    response.json({ fingerprint });
  } catch (error) {
    next(error);
  }
});

export default router;
