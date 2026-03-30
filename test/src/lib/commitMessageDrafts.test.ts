import { describe, expect, test } from 'bun:test';

import {
  COMMIT_MESSAGE_DRAFTS_STORAGE_KEY,
  MAX_PERSISTED_COMMIT_MESSAGE_DRAFTS,
  parsePersistedCommitMessageDrafts,
  type PersistedCommitMessageDrafts,
  readCommitMessageDraftFromStorage,
  upsertPersistedCommitMessageDraft,
  writeCommitMessageDraftToStorage
} from '../../../src/lib/commitMessageDrafts';

function createStorage(seed: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map(Object.entries(seed));

  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    }
  };
}

describe('parsePersistedCommitMessageDrafts', () => {
  test('ignores invalid payloads and empty drafts', () => {
    expect(parsePersistedCommitMessageDrafts('{')).toEqual({});

    expect(
      parsePersistedCommitMessageDrafts(
        JSON.stringify({
          '   ': { title: 'feat: invalid path', description: '' },
          '/tmp/repo-a': { title: '   ', description: '   ' },
          '/tmp/repo-b': { title: 'feat: restore draft', description: 'keep this' }
        })
      )
    ).toEqual({
      '/tmp/repo-b': {
        title: 'feat: restore draft',
        description: 'keep this',
        updatedAt: ''
      }
    });
  });
});

describe('commit draft storage helpers', () => {
  test('persists and restores repo-specific commit drafts', () => {
    const storage = createStorage();

    writeCommitMessageDraftToStorage(
      storage,
      '/tmp/repo-a',
      {
        title: 'feat: persist commit draft',
        description: '- keep title\n- keep description'
      },
      '2026-03-31T10:00:00.000Z'
    );

    expect(readCommitMessageDraftFromStorage(storage, '/tmp/repo-a')).toEqual({
      title: 'feat: persist commit draft',
      description: '- keep title\n- keep description',
      updatedAt: '2026-03-31T10:00:00.000Z'
    });
    expect(readCommitMessageDraftFromStorage(storage, '/tmp/repo-b')).toBeNull();
    expect(storage.getItem(COMMIT_MESSAGE_DRAFTS_STORAGE_KEY)).toContain('persist commit draft');
  });

  test('removes the stored draft when both title and description are empty', () => {
    const storage = createStorage({
      [COMMIT_MESSAGE_DRAFTS_STORAGE_KEY]: JSON.stringify({
        '/tmp/repo-a': {
          title: 'feat: clear me',
          description: '',
          updatedAt: '2026-03-31T10:00:00.000Z'
        },
        '/tmp/repo-b': {
          title: 'fix: keep me',
          description: 'still here',
          updatedAt: '2026-03-31T11:00:00.000Z'
        }
      })
    });

    writeCommitMessageDraftToStorage(
      storage,
      '/tmp/repo-a',
      {
        title: '',
        description: '   '
      },
      '2026-03-31T12:00:00.000Z'
    );

    expect(readCommitMessageDraftFromStorage(storage, '/tmp/repo-a')).toBeNull();
    expect(readCommitMessageDraftFromStorage(storage, '/tmp/repo-b')).toEqual({
      title: 'fix: keep me',
      description: 'still here',
      updatedAt: '2026-03-31T11:00:00.000Z'
    });
  });
});

describe('upsertPersistedCommitMessageDraft', () => {
  test('keeps only the most recent drafts within the storage limit', () => {
    let drafts: PersistedCommitMessageDrafts = {};

    for (let index = 0; index <= MAX_PERSISTED_COMMIT_MESSAGE_DRAFTS; index += 1) {
      drafts = upsertPersistedCommitMessageDraft(
        drafts,
        `/tmp/repo-${index}`,
        {
          title: `feat: draft ${index}`,
          description: ''
        },
        `2026-03-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`
      );
    }

    expect(Object.keys(drafts)).toHaveLength(MAX_PERSISTED_COMMIT_MESSAGE_DRAFTS);
    expect(drafts['/tmp/repo-0']).toBeUndefined();
    expect(Object.keys(drafts)[0]).toBe(`/tmp/repo-${MAX_PERSISTED_COMMIT_MESSAGE_DRAFTS}`);
  });
});
