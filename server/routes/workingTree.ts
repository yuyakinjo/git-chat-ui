import { Router } from 'express';

import {
  getWorkingTreeDiffDetail,
  getWorkingTreeStatus,
  stageFile,
  unstageFile
} from '../gitService.js';

import { getRepoPathFromQuery, getRequiredString, parseWorkingTreeDiffArea } from './helpers.js';

const router = Router();

router.get('/api/status', async (request, response, next) => {
  try {
    const repoPath = getRepoPathFromQuery(request);
    const status = await getWorkingTreeStatus(repoPath);
    response.json(status);
  } catch (error) {
    next(error);
  }
});

router.get('/api/working-tree/diff', async (request, response, next) => {
  try {
    const repoPath = getRepoPathFromQuery(request);
    const file = getRequiredString(request.query.file, 'file');
    const area = parseWorkingTreeDiffArea(request.query.area);
    const detail = await getWorkingTreeDiffDetail({
      repoPath,
      file,
      area
    });
    response.json(detail);
  } catch (error) {
    next(error);
  }
});

router.post('/api/stage', async (request, response, next) => {
  try {
    const repoPath = getRequiredString(request.body.repoPath, 'repoPath');
    const file = getRequiredString(request.body.file, 'file');
    await stageFile(repoPath, file);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.post('/api/unstage', async (request, response, next) => {
  try {
    const repoPath = getRequiredString(request.body.repoPath, 'repoPath');
    const file = getRequiredString(request.body.file, 'file');
    await unstageFile(repoPath, file);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export default router;
