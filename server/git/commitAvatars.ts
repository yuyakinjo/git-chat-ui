import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ensureRepoPath, runGh, runGit } from "./command.js";
import { normalizeGithubRemoteUrl } from "./pullRequest.js";

const COMMIT_AVATAR_HISTORY_LIMIT = 100;
const COMMIT_AVATAR_SIZE = 72;

interface CommitAvatarManifest {
  version: 1;
  commits: Record<string, { imageKey: string }>;
  images: Record<string, { fileName: string; mimeType: string }>;
}

interface GithubCommitAvatarGraphQlResponse {
  data?: {
    repository?: {
      object?: {
        history?: {
          nodes?: Array<{
            oid?: string | null;
            author?: {
              user?: {
                avatarUrl?: string | null;
              } | null;
            } | null;
          } | null>;
        } | null;
      } | null;
    } | null;
  } | null;
}

const EMPTY_COMMIT_AVATAR_MANIFEST: CommitAvatarManifest = {
  version: 1,
  commits: {},
  images: {},
};

function hashText(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

function avatarCacheRoot(): string {
  return path.join(os.homedir(), ".git-chat-ui", "commit-author-avatars");
}

function manifestPath(repoKey: string): string {
  return path.join(avatarCacheRoot(), "manifests", `${hashText(repoKey)}.json`);
}

function imagePath(fileName: string): string {
  return path.join(avatarCacheRoot(), "images", fileName);
}

function normalizeMimeType(value: string | null | undefined): string {
  const normalized = value?.split(";")[0]?.trim().toLowerCase();
  if (!normalized?.startsWith("image/")) {
    return "image/png";
  }

  return normalized;
}

function imageExtensionForMimeType(mimeType: string): string {
  switch (normalizeMimeType(mimeType)) {
    case "image/jpeg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    case "image/svg+xml":
      return "svg";
    default:
      return "png";
  }
}

async function readCommitAvatarManifest(repoKey: string): Promise<CommitAvatarManifest> {
  try {
    const raw = await fs.readFile(manifestPath(repoKey), "utf8");
    const parsed = JSON.parse(raw) as Partial<CommitAvatarManifest> | null;

    return {
      version: 1,
      commits: parsed?.commits ?? {},
      images: parsed?.images ?? {},
    };
  } catch {
    return {
      ...EMPTY_COMMIT_AVATAR_MANIFEST,
      commits: {},
      images: {},
    };
  }
}

async function writeCommitAvatarManifest(
  repoKey: string,
  manifest: CommitAvatarManifest,
): Promise<void> {
  const targetPath = manifestPath(repoKey);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, JSON.stringify(manifest, null, 2));
}

async function resolveGithubRepositoryUrl(repoPath: string): Promise<string | null> {
  try {
    const remoteUrl = await runGit(["remote", "get-url", "origin"], repoPath);
    return normalizeGithubRemoteUrl(remoteUrl);
  } catch {
    return null;
  }
}

function parseGithubRepositorySlug(repositoryUrl: string): {
  owner: string;
  name: string;
} | null {
  try {
    const parsed = new URL(repositoryUrl);
    const segments = parsed.pathname
      .replace(/^\/+/, "")
      .replace(/\/+$/, "")
      .split("/")
      .filter(Boolean);

    if (segments.length !== 2) {
      return null;
    }

    return {
      owner: segments[0] ?? "",
      name: segments[1] ?? "",
    };
  } catch {
    return null;
  }
}

export function normalizeGithubHistoryRef(ref: string): string {
  const trimmed = ref.trim();
  if (!trimmed) {
    return "HEAD";
  }

  if (trimmed.startsWith("refs/heads/")) {
    return trimmed.slice("refs/heads/".length);
  }

  if (trimmed.startsWith("refs/remotes/")) {
    const segments = trimmed.slice("refs/remotes/".length).split("/").filter(Boolean);
    if (segments.length > 1) {
      return segments.slice(1).join("/");
    }
  }

  if (trimmed.startsWith("origin/")) {
    return trimmed.slice("origin/".length);
  }

  return trimmed;
}

async function resolveGithubHistoryRef(repoPath: string, ref: string | undefined): Promise<string> {
  const normalized = normalizeGithubHistoryRef(ref ?? "HEAD");
  if (normalized !== "HEAD") {
    return normalized;
  }

  return await runGit(["rev-parse", "HEAD"], repoPath);
}

export function parseGithubCommitAvatarGraphQlResponse(raw: string): Map<string, string> {
  const parsed = JSON.parse(raw) as GithubCommitAvatarGraphQlResponse;
  const nodes = parsed.data?.repository?.object?.history?.nodes ?? [];
  const result = new Map<string, string>();

  for (const node of nodes) {
    const sha = node?.oid?.trim();
    const avatarUrl = node?.author?.user?.avatarUrl?.trim();
    if (!sha || !avatarUrl) {
      continue;
    }

    result.set(sha, avatarUrl);
  }

  return result;
}

async function fetchGithubCommitAvatarUrls(options: {
  repoPath: string;
  owner: string;
  name: string;
  ref: string;
}): Promise<Map<string, string>> {
  const query = [
    "query($owner: String!, $name: String!, $ref: String!, $limit: Int!, $avatarSize: Int!) {",
    "  repository(owner: $owner, name: $name) {",
    "    object(expression: $ref) {",
    "      ... on Commit {",
    "        history(first: $limit) {",
    "          nodes {",
    "            oid",
    "            author {",
    "              user {",
    "                avatarUrl(size: $avatarSize)",
    "              }",
    "            }",
    "          }",
    "        }",
    "      }",
    "    }",
    "  }",
    "}",
  ].join("\n");

  const output = await runGh(
    [
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      "-F",
      `owner=${options.owner}`,
      "-F",
      `name=${options.name}`,
      "-F",
      `ref=${options.ref}`,
      "-F",
      `limit=${COMMIT_AVATAR_HISTORY_LIMIT}`,
      "-F",
      `avatarSize=${COMMIT_AVATAR_SIZE}`,
    ],
    options.repoPath,
  );

  return parseGithubCommitAvatarGraphQlResponse(output);
}

async function downloadAvatarImage(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const response = await fetch(url, {
    headers: {
      Accept: "image/*",
      "User-Agent": "git-chat-ui",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download avatar image: ${response.status}`);
  }

  const mimeType = normalizeMimeType(response.headers.get("content-type"));
  const buffer = Buffer.from(await response.arrayBuffer());

  return {
    buffer,
    mimeType,
  };
}

async function persistAvatarImage(
  imageKey: string,
  avatarUrl: string,
  manifest: CommitAvatarManifest,
): Promise<void> {
  const current = manifest.images[imageKey];
  if (current) {
    try {
      await fs.access(imagePath(current.fileName));
      return;
    } catch {
      // Fall through and re-download if the cache file is missing.
    }
  }

  const { buffer, mimeType } = await downloadAvatarImage(avatarUrl);
  const fileName = `${imageKey}.${imageExtensionForMimeType(mimeType)}`;
  const targetPath = imagePath(fileName);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, buffer);
  manifest.images[imageKey] = { fileName, mimeType };
}

async function buildAvatarSourceMap(
  manifest: CommitAvatarManifest,
  shas: string[],
): Promise<Record<string, string>> {
  const avatars: Record<string, string> = {};

  for (const sha of shas) {
    const commitEntry = manifest.commits[sha];
    if (!commitEntry) {
      continue;
    }

    const imageEntry = manifest.images[commitEntry.imageKey];
    if (!imageEntry) {
      continue;
    }

    try {
      const buffer = await fs.readFile(imagePath(imageEntry.fileName));
      avatars[sha] = `data:${imageEntry.mimeType};base64,${buffer.toString("base64")}`;
    } catch {
      // Ignore missing cache files and keep the fallback node.
    }
  }

  return avatars;
}

export async function getCommitAuthorAvatars(options: {
  repoPath: string;
  ref?: string;
  shas: string[];
  allowRemoteFetch?: boolean;
}): Promise<{ avatars: Record<string, string> }> {
  await ensureRepoPath(options.repoPath);

  const shas = [...new Set(options.shas.map((value) => value.trim()).filter(Boolean))];
  if (shas.length === 0) {
    return { avatars: {} };
  }

  const repositoryUrl = await resolveGithubRepositoryUrl(options.repoPath);
  const repoKey = repositoryUrl ?? options.repoPath;
  let manifest = await readCommitAvatarManifest(repoKey);

  if (options.allowRemoteFetch !== false && repositoryUrl) {
    const repoSlug = parseGithubRepositorySlug(repositoryUrl);

    if (repoSlug) {
      try {
        await runGh(["auth", "status", "-h", "github.com"], options.repoPath);
        const ref = await resolveGithubHistoryRef(options.repoPath, options.ref);
        const commitAvatarUrls = await fetchGithubCommitAvatarUrls({
          repoPath: options.repoPath,
          owner: repoSlug.owner,
          name: repoSlug.name,
          ref,
        });

        let changed = false;
        for (const [sha, avatarUrl] of commitAvatarUrls) {
          const imageKey = hashText(avatarUrl);
          try {
            await persistAvatarImage(imageKey, avatarUrl, manifest);
            manifest.commits[sha] = { imageKey };
            changed = true;
          } catch {
            // Ignore individual image download failures and keep other cached avatars.
          }
        }

        if (changed) {
          await writeCommitAvatarManifest(repoKey, manifest);
        }
      } catch {
        // Avatar hydration is opportunistic. Missing auth or GitHub failures keep the graph usable.
      }
    }
  }

  return {
    avatars: await buildAvatarSourceMap(manifest, shas),
  };
}
