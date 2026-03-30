import { describe, expect, test } from 'bun:test';

import type { Repository } from '../types';

import {
  DASHBOARD_TAB_ID,
  CONFIG_TAB_ID,
  closeRepositoryTab,
  createRepositoryStub,
  getRepositoryTabBranchLabel,
  findRepositoryForTab,
  getRepositoryTabId,
  getRepositoryTabPath,
  parsePersistedAppSession,
  resolveRestoredActiveTabId,
  serializeAppSession,
  upsertRepositoryTab
} from './appTabs';

const alphaRepository: Repository = {
  name: 'alpha',
  path: '/repos/alpha'
};

const betaRepository: Repository = {
  name: 'beta',
  path: '/repos/beta'
};

describe('appTabs', () => {
  test('upsertRepositoryTab appends unopened repositories and replaces existing entries', () => {
    const appended = upsertRepositoryTab([alphaRepository], betaRepository);
    expect(appended).toEqual([alphaRepository, betaRepository]);

    const renamedAlpha = {
      ...alphaRepository,
      name: 'alpha-renamed'
    };
    const replaced = upsertRepositoryTab([alphaRepository, betaRepository], renamedAlpha);
    expect(replaced).toEqual([renamedAlpha, betaRepository]);
  });

  test('findRepositoryForTab resolves repository tabs and ignores fixed tabs', () => {
    expect(findRepositoryForTab([alphaRepository, betaRepository], getRepositoryTabId(betaRepository.path))).toEqual(
      betaRepository
    );
    expect(findRepositoryForTab([alphaRepository], DASHBOARD_TAB_ID)).toBeNull();
    expect(getRepositoryTabPath(getRepositoryTabId(alphaRepository.path))).toBe(alphaRepository.path);
  });

  test('getRepositoryTabBranchLabel normalizes missing and detached states', () => {
    expect(getRepositoryTabBranchLabel(' main ')).toBe('main');
    expect(getRepositoryTabBranchLabel('HEAD')).toBe('detached');
    expect(getRepositoryTabBranchLabel('   ')).toBeNull();
    expect(getRepositoryTabBranchLabel(null)).toBeNull();
  });

  test('serializes and parses app sessions with deduplicated repository paths', () => {
    const serialized = serializeAppSession(
      [alphaRepository, betaRepository, alphaRepository],
      getRepositoryTabId(betaRepository.path),
      'default-dark'
    );

    expect(serialized).toEqual({
      openRepositoryPaths: [alphaRepository.path, betaRepository.path],
      activeTabId: getRepositoryTabId(betaRepository.path),
      appThemeId: 'default-dark'
    });

    expect(
      parsePersistedAppSession(
        JSON.stringify({
          openRepositoryPaths: [alphaRepository.path, '  ', betaRepository.path, alphaRepository.path],
          activeTabId: getRepositoryTabId('/repos/missing')
        }),
        'default-dark'
      )
    ).toEqual({
      openRepositoryPaths: [alphaRepository.path, betaRepository.path],
      activeTabId: getRepositoryTabId(alphaRepository.path),
      appThemeId: 'default-dark'
    });

    expect(parsePersistedAppSession('not-json', 'default-dark')).toEqual({
      openRepositoryPaths: [],
      activeTabId: DASHBOARD_TAB_ID,
      appThemeId: 'default-dark'
    });
  });

  test('prefers persisted theme ids and falls back to migrated theme ids', () => {
    expect(
      parsePersistedAppSession(
        JSON.stringify({
          openRepositoryPaths: [alphaRepository.path],
          activeTabId: getRepositoryTabId(alphaRepository.path),
          appThemeId: 'default-dark'
        }),
        'default-light'
      )
    ).toEqual({
      openRepositoryPaths: [alphaRepository.path],
      activeTabId: getRepositoryTabId(alphaRepository.path),
      appThemeId: 'default-dark'
    });

    expect(
      parsePersistedAppSession(
        JSON.stringify({
          openRepositoryPaths: [alphaRepository.path],
          activeTabId: getRepositoryTabId(alphaRepository.path),
          appThemeId: 'midnight'
        }),
        'default-dark'
      )
    ).toEqual({
      openRepositoryPaths: [alphaRepository.path],
      activeTabId: getRepositoryTabId(alphaRepository.path),
      appThemeId: 'default-dark'
    });
  });

  test('restores active tabs against available repositories and derives stub names from paths', () => {
    expect(createRepositoryStub('/Users/example/work/beta')).toEqual({
      name: 'beta',
      path: '/Users/example/work/beta'
    });
    expect(createRepositoryStub('C:\\work\\alpha')).toEqual({
      name: 'alpha',
      path: 'C:\\work\\alpha'
    });

    expect(resolveRestoredActiveTabId([alphaRepository, betaRepository], CONFIG_TAB_ID)).toBe(CONFIG_TAB_ID);
    expect(resolveRestoredActiveTabId([alphaRepository, betaRepository], getRepositoryTabId(betaRepository.path))).toBe(
      getRepositoryTabId(betaRepository.path)
    );
    expect(resolveRestoredActiveTabId([alphaRepository], getRepositoryTabId(betaRepository.path))).toBe(
      getRepositoryTabId(alphaRepository.path)
    );
  });

  test('closeRepositoryTab activates the previous repository tab when the active repository closes', () => {
    const result = closeRepositoryTab(
      [alphaRepository, betaRepository],
      betaRepository.path,
      getRepositoryTabId(betaRepository.path)
    );

    expect(result.repositories).toEqual([alphaRepository]);
    expect(result.activeTabId).toBe(getRepositoryTabId(alphaRepository.path));
  });

  test('closeRepositoryTab falls back to dashboard when the left neighbor is absent', () => {
    const result = closeRepositoryTab(
      [alphaRepository, betaRepository],
      alphaRepository.path,
      getRepositoryTabId(alphaRepository.path)
    );

    expect(result.repositories).toEqual([betaRepository]);
    expect(result.activeTabId).toBe(DASHBOARD_TAB_ID);
  });
});
