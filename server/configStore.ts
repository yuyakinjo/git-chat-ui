import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { AppConfig, CommitGraphMode } from './types.js';

const execFileAsync = promisify(execFile);

const CONFIG_DIR = path.join(os.homedir(), '.git-chat-ui');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

const MIN_REPOSITORY_SCAN_DEPTH = 1;
const MAX_REPOSITORY_SCAN_DEPTH = 8;
const KEYCHAIN_ACCOUNT = 'git-chat-ui';
const KEYCHAIN_SERVICE_OPENAI = 'git-chat-ui.openai-token';
const KEYCHAIN_SERVICE_CLAUDE = 'git-chat-ui.claudecode-token';

const DEFAULT_CONFIG: AppConfig = {
  openAiToken: '',
  claudeCodeToken: '',
  commitGraphMode: 'detailed',
  repositoryScanDepth: 4,
  recentlyUsed: []
};

function normalizeCommitGraphMode(value: unknown): CommitGraphMode {
  if (value === 'simple' || value === 'detailed') {
    return value;
  }

  return DEFAULT_CONFIG.commitGraphMode;
}

function normalizeRepositoryScanDepth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_CONFIG.repositoryScanDepth;
  }

  const rounded = Math.round(value);
  return Math.min(Math.max(rounded, MIN_REPOSITORY_SCAN_DEPTH), MAX_REPOSITORY_SCAN_DEPTH);
}

function normalizeRecentlyUsed(
  value: unknown
): Array<{
  path: string;
  usedAt: string;
}> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is { path: unknown; usedAt: unknown } => typeof item === 'object' && item !== null)
    .filter(
      (item): item is { path: string; usedAt: string } =>
        typeof item.path === 'string' && typeof item.usedAt === 'string'
    )
    .map((item) => ({
      path: item.path,
      usedAt: item.usedAt
    }));
}

function normalizeConfig(value: Partial<AppConfig>): AppConfig {
  return {
    openAiToken: typeof value.openAiToken === 'string' ? value.openAiToken : DEFAULT_CONFIG.openAiToken,
    claudeCodeToken:
      typeof value.claudeCodeToken === 'string' ? value.claudeCodeToken : DEFAULT_CONFIG.claudeCodeToken,
    commitGraphMode: normalizeCommitGraphMode(value.commitGraphMode),
    repositoryScanDepth: normalizeRepositoryScanDepth(value.repositoryScanDepth),
    recentlyUsed: normalizeRecentlyUsed(value.recentlyUsed)
  };
}

function isMacos(): boolean {
  return process.platform === 'darwin';
}

async function readTokenFromKeychain(service: string): Promise<string | undefined> {
  if (!isMacos()) {
    return undefined;
  }

  try {
    const { stdout } = await execFileAsync('security', [
      'find-generic-password',
      '-a',
      KEYCHAIN_ACCOUNT,
      '-s',
      service,
      '-w'
    ]);

    const token = stdout.trim();
    return token.length > 0 ? token : undefined;
  } catch {
    return undefined;
  }
}

async function setTokenToKeychain(service: string, token: string): Promise<boolean> {
  if (!isMacos()) {
    return false;
  }

  try {
    await execFileAsync('security', [
      'add-generic-password',
      '-a',
      KEYCHAIN_ACCOUNT,
      '-s',
      service,
      '-w',
      token,
      '-U'
    ]);
    return true;
  } catch {
    return false;
  }
}

async function deleteTokenFromKeychain(service: string): Promise<void> {
  if (!isMacos()) {
    return;
  }

  try {
    await execFileAsync('security', ['delete-generic-password', '-a', KEYCHAIN_ACCOUNT, '-s', service]);
  } catch {
    // ignore if not found
  }
}

export async function readConfig(): Promise<AppConfig> {
  let config: AppConfig;

  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    config = normalizeConfig(parsed);
  } catch {
    config = {
      ...DEFAULT_CONFIG,
      recentlyUsed: []
    };
  }

  if (isMacos()) {
    const [openAiToken, claudeCodeToken] = await Promise.all([
      readTokenFromKeychain(KEYCHAIN_SERVICE_OPENAI),
      readTokenFromKeychain(KEYCHAIN_SERVICE_CLAUDE)
    ]);

    if (openAiToken) {
      config.openAiToken = openAiToken;
    }

    if (claudeCodeToken) {
      config.claudeCodeToken = claudeCodeToken;
    }
  }

  return config;
}

export async function writeConfig(nextConfig: AppConfig): Promise<void> {
  const normalized = normalizeConfig(nextConfig);
  const persisted = { ...normalized };

  if (isMacos()) {
    if (normalized.openAiToken.trim().length === 0) {
      await deleteTokenFromKeychain(KEYCHAIN_SERVICE_OPENAI);
      persisted.openAiToken = '';
    } else if (await setTokenToKeychain(KEYCHAIN_SERVICE_OPENAI, normalized.openAiToken)) {
      persisted.openAiToken = '';
    }

    if (normalized.claudeCodeToken.trim().length === 0) {
      await deleteTokenFromKeychain(KEYCHAIN_SERVICE_CLAUDE);
      persisted.claudeCodeToken = '';
    } else if (await setTokenToKeychain(KEYCHAIN_SERVICE_CLAUDE, normalized.claudeCodeToken)) {
      persisted.claudeCodeToken = '';
    }
  }

  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(persisted, null, 2), 'utf8');
}

export async function setRecentlyUsedRepository(repoPath: string): Promise<void> {
  const current = await readConfig();
  const now = new Date().toISOString();
  const filtered = current.recentlyUsed.filter((item) => item.path !== repoPath);

  filtered.unshift({ path: repoPath, usedAt: now });

  const updated: AppConfig = {
    ...current,
    recentlyUsed: filtered.slice(0, 30)
  };

  await writeConfig(updated);
}
