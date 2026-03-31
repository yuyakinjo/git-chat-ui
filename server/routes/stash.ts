import { Router } from 'express';

import {
  applyStash,
  getStashDiffDetail,
  getStashes,
  popStash,
  renameStash,
  stashFile
} from '../gitService.js';

import { getRepoPathFromQuery, getRequiredString } from './helpers.js';

const router = Router();

router.post('/api/stash', async (request, response, next) => {
  try {
    const repoPath = getRequiredString(request.body.repoPath, 'repoPath');
    const file = getRequiredString(request.body.file, 'file');
    await stashFile(repoPath, file);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.get('/api/stashes', async (request, response, next) => {
  try {
    const repoPath = getRepoPathFromQuery(request);
    const stashes = await getStashes(repoPath);
    response.json({ stashes });
  } catch (error) {
    next(error);
  }
});

router.get('/api/stashes/diff', async (request, response, next) => {
  try {
    const repoPath = getRepoPathFromQuery(request);
    const stashId = getRequiredString(request.query.stashId, 'stashId');
    const detail = await getStashDiffDetail(repoPath, stashId);
    response.json(detail);
  } catch (error) {
    next(error);
  }
});

router.post('/api/stashes/rename', async (request, response, next) => {
  try {
    const repoPath = getRequiredString(request.body.repoPath, 'repoPath');
    const stashId = getRequiredString(request.body.stashId, 'stashId');
    const message = getRequiredString(request.body.message, 'message');
    await renameStash(repoPath, stashId, message);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.post('/api/stashes/apply', async (request, response, next) => {
  try {
    const repoPath = getRequiredString(request.body.repoPath, 'repoPath');
    const stashId = getRequiredString(request.body.stashId, 'stashId');
    await applyStash(repoPath, stashId);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.post('/api/stashes/pop', async (request, response, next) => {
  try {
    const repoPath = getRequiredString(request.body.repoPath, 'repoPath');
    const stashId = getRequiredString(request.body.stashId, 'stashId');
    await popStash(repoPath, stashId);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export default router;
