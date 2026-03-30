import { describe, expect, test } from 'bun:test';

import { DEFAULT_APP_THEME, getAppThemeLabel, normalizeAppTheme } from './appTheme';

describe('appTheme', () => {
  test('falls back to Default Light for unknown values', () => {
    expect(normalizeAppTheme('')).toBe(DEFAULT_APP_THEME);
    expect(normalizeAppTheme('midnight')).toBe(DEFAULT_APP_THEME);
    expect(normalizeAppTheme(null)).toBe(DEFAULT_APP_THEME);
  });

  test('returns labels for known theme ids', () => {
    expect(getAppThemeLabel('default-light')).toBe('Default Light');
    expect(getAppThemeLabel('default-dark')).toBe('Default Dark');
  });
});
