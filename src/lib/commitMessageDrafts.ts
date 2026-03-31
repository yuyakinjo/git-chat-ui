export interface CommitMessageDraftInput {
  title: string;
  description: string;
}

export interface CommitMessageDraft extends CommitMessageDraftInput {
  updatedAt: string;
}

export type PersistedCommitMessageDrafts = Record<string, CommitMessageDraft>;

export const COMMIT_MESSAGE_DRAFTS_STORAGE_KEY = "git-chat-ui.commit-message-drafts";
export const MAX_PERSISTED_COMMIT_MESSAGE_DRAFTS = 30;

type DraftStorage = Pick<Storage, "getItem" | "setItem">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeRepoPath(repoPath: string): string {
  return repoPath.trim();
}

function isEmptyDraft(draft: CommitMessageDraftInput): boolean {
  return draft.title.trim().length === 0 && draft.description.trim().length === 0;
}

function normalizeDraft(value: unknown): CommitMessageDraft | null {
  if (!isRecord(value)) {
    return null;
  }

  const title = typeof value.title === "string" ? value.title : "";
  const description = typeof value.description === "string" ? value.description : "";

  if (isEmptyDraft({ title, description })) {
    return null;
  }

  return {
    title,
    description,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
  };
}

function getDraftTimestamp(draft: CommitMessageDraft): number {
  const parsed = Date.parse(draft.updatedAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function finalizeDrafts(
  entries: Array<[string, CommitMessageDraft]>,
): PersistedCommitMessageDrafts {
  return Object.fromEntries(
    entries
      .filter(([repoPath]) => normalizeRepoPath(repoPath).length > 0)
      .sort((left, right) => {
        const timestampDelta = getDraftTimestamp(right[1]) - getDraftTimestamp(left[1]);
        return timestampDelta !== 0 ? timestampDelta : left[0].localeCompare(right[0]);
      })
      .slice(0, MAX_PERSISTED_COMMIT_MESSAGE_DRAFTS),
  );
}

export function parsePersistedCommitMessageDrafts(
  rawValue: string | null,
): PersistedCommitMessageDrafts {
  if (!rawValue) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!isRecord(parsed)) {
      return {};
    }

    const entries: Array<[string, CommitMessageDraft]> = [];
    for (const [repoPath, value] of Object.entries(parsed)) {
      const normalizedRepoPath = normalizeRepoPath(repoPath);
      const normalizedDraft = normalizeDraft(value);
      if (!normalizedRepoPath || !normalizedDraft) {
        continue;
      }

      entries.push([normalizedRepoPath, normalizedDraft]);
    }

    return finalizeDrafts(entries);
  } catch {
    return {};
  }
}

export function serializePersistedCommitMessageDrafts(
  drafts: PersistedCommitMessageDrafts,
): string {
  return JSON.stringify(finalizeDrafts(Object.entries(drafts)));
}

export function getPersistedCommitMessageDraft(
  drafts: PersistedCommitMessageDrafts,
  repoPath: string,
): CommitMessageDraft | null {
  const normalizedRepoPath = normalizeRepoPath(repoPath);
  if (!normalizedRepoPath) {
    return null;
  }

  return drafts[normalizedRepoPath] ?? null;
}

export function upsertPersistedCommitMessageDraft(
  drafts: PersistedCommitMessageDrafts,
  repoPath: string,
  draft: CommitMessageDraftInput,
  updatedAt: string = new Date().toISOString(),
): PersistedCommitMessageDrafts {
  const normalizedRepoPath = normalizeRepoPath(repoPath);
  if (!normalizedRepoPath) {
    return drafts;
  }

  const existingDraft = drafts[normalizedRepoPath] ?? null;

  if (isEmptyDraft(draft)) {
    if (!existingDraft) {
      return drafts;
    }

    const nextDrafts = { ...drafts };
    delete nextDrafts[normalizedRepoPath];
    return finalizeDrafts(Object.entries(nextDrafts));
  }

  if (
    existingDraft &&
    existingDraft.title === draft.title &&
    existingDraft.description === draft.description
  ) {
    return drafts;
  }

  return finalizeDrafts(
    Object.entries({
      ...drafts,
      [normalizedRepoPath]: {
        title: draft.title,
        description: draft.description,
        updatedAt,
      },
    }),
  );
}

export function readCommitMessageDraftFromStorage(
  storage: DraftStorage,
  repoPath: string,
): CommitMessageDraft | null {
  return getPersistedCommitMessageDraft(
    parsePersistedCommitMessageDrafts(storage.getItem(COMMIT_MESSAGE_DRAFTS_STORAGE_KEY)),
    repoPath,
  );
}

export function writeCommitMessageDraftToStorage(
  storage: DraftStorage,
  repoPath: string,
  draft: CommitMessageDraftInput,
  updatedAt?: string,
): PersistedCommitMessageDrafts {
  const nextDrafts = upsertPersistedCommitMessageDraft(
    parsePersistedCommitMessageDrafts(storage.getItem(COMMIT_MESSAGE_DRAFTS_STORAGE_KEY)),
    repoPath,
    draft,
    updatedAt,
  );
  storage.setItem(
    COMMIT_MESSAGE_DRAFTS_STORAGE_KEY,
    serializePersistedCommitMessageDrafts(nextDrafts),
  );
  return nextDrafts;
}
