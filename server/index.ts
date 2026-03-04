import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';

import { generateCommitTitle } from './aiService.js';
import { readConfig, setRecentlyUsedRepository, writeConfig } from './configStore.js';
import {
  checkoutRef,
  commitChanges,
  discoverRepositories,
  getBranches,
  getCommitDetail,
  getCommits,
  getDiffSnippet,
  getRepositoryFingerprint,
  getStashes,
  getWorkingTreeStatus,
  pushChanges,
  stageFile,
  stashFile,
  unstageFile
} from './gitService.js';
import type { AppConfig } from './types.js';

const app = express();
const port = Number(process.env.GIT_CHAT_UI_API_PORT || 4141);

app.use(cors());
app.use(express.json({ limit: '4mb' }));

function getRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} is required.`);
  }

  return value;
}

function getRepoPathFromQuery(request: Request): string {
  return getRequiredString(request.query.repoPath, 'repoPath');
}

function parseCommitGraphMode(value: unknown): AppConfig['commitGraphMode'] | null {
  if (value === 'simple' || value === 'detailed') {
    return value;
  }

  return null;
}

function parseRepositoryScanDepth(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

app.get('/api/health', (_request, response) => {
  response.json({ ok: true });
});

app.get('/api/repositories', async (request, response, next) => {
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

app.post('/api/repositories/recent', async (request, response, next) => {
  try {
    const repoPath = getRequiredString(request.body.repoPath, 'repoPath');
    await setRecentlyUsedRepository(repoPath);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/branches', async (request, response, next) => {
  try {
    const repoPath = getRepoPathFromQuery(request);
    const branches = await getBranches(repoPath);
    response.json(branches);
  } catch (error) {
    next(error);
  }
});

app.get('/api/commits', async (request, response, next) => {
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

app.get('/api/commits/detail', async (request, response, next) => {
  try {
    const repoPath = getRepoPathFromQuery(request);
    const sha = getRequiredString(request.query.sha, 'sha');
    const detail = await getCommitDetail(repoPath, sha);
    response.json(detail);
  } catch (error) {
    next(error);
  }
});

app.get('/api/status', async (request, response, next) => {
  try {
    const repoPath = getRepoPathFromQuery(request);
    const status = await getWorkingTreeStatus(repoPath);
    response.json(status);
  } catch (error) {
    next(error);
  }
});

app.post('/api/stage', async (request, response, next) => {
  try {
    const repoPath = getRequiredString(request.body.repoPath, 'repoPath');
    const file = getRequiredString(request.body.file, 'file');
    await stageFile(repoPath, file);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/unstage', async (request, response, next) => {
  try {
    const repoPath = getRequiredString(request.body.repoPath, 'repoPath');
    const file = getRequiredString(request.body.file, 'file');
    await unstageFile(repoPath, file);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/stash', async (request, response, next) => {
  try {
    const repoPath = getRequiredString(request.body.repoPath, 'repoPath');
    const file = getRequiredString(request.body.file, 'file');
    await stashFile(repoPath, file);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/stashes', async (request, response, next) => {
  try {
    const repoPath = getRepoPathFromQuery(request);
    const stashes = await getStashes(repoPath);
    response.json({ stashes });
  } catch (error) {
    next(error);
  }
});

app.post('/api/checkout', async (request, response, next) => {
  try {
    const repoPath = getRequiredString(request.body.repoPath, 'repoPath');
    const ref = getRequiredString(request.body.ref, 'ref');
    await checkoutRef(repoPath, ref);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/commit', async (request, response, next) => {
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

app.post('/api/push', async (request, response, next) => {
  try {
    const repoPath = getRequiredString(request.body.repoPath, 'repoPath');
    await pushChanges(repoPath);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/updates', async (request, response, next) => {
  try {
    const repoPath = getRepoPathFromQuery(request);
    const fingerprint = await getRepositoryFingerprint(repoPath);
    response.json({ fingerprint });
  } catch (error) {
    next(error);
  }
});

app.get('/api/config', async (_request, response, next) => {
  try {
    const config = await readConfig();
    response.json(config);
  } catch (error) {
    next(error);
  }
});

app.put('/api/config', async (request, response, next) => {
  try {
    const current = await readConfig();
    const parsedGraphMode = parseCommitGraphMode(request.body.commitGraphMode);
    const parsedRepositoryScanDepth = parseRepositoryScanDepth(request.body.repositoryScanDepth);

    const nextConfig: AppConfig = {
      ...current,
      openAiToken: typeof request.body.openAiToken === 'string' ? request.body.openAiToken : current.openAiToken,
      claudeCodeToken:
        typeof request.body.claudeCodeToken === 'string'
          ? request.body.claudeCodeToken
          : current.claudeCodeToken,
      commitGraphMode: parsedGraphMode ?? current.commitGraphMode,
      repositoryScanDepth: parsedRepositoryScanDepth ?? current.repositoryScanDepth
    };

    await writeConfig(nextConfig);

    response.json({ ok: true, config: await readConfig() });
  } catch (error) {
    next(error);
  }
});

app.post('/api/generate-title', async (request, response, next) => {
  try {
    const repoPath = getRequiredString(request.body.repoPath, 'repoPath');
    const changedFiles = Array.isArray(request.body.changedFiles)
      ? request.body.changedFiles.filter((value: unknown): value is string => typeof value === 'string')
      : [];

    const config = await readConfig();
    const diffSnippet = await getDiffSnippet(repoPath, changedFiles);
    const title = await generateCommitTitle({
      openAiToken: config.openAiToken,
      claudeCodeToken: config.claudeCodeToken,
      changedFiles,
      diffSnippet
    });

    response.json({ title });
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : 'Unexpected server error.';
  response.status(400).json({ error: message });
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[git-chat-ui/api] listening on http://localhost:${port}`);
});
