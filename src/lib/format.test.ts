import { describe, expect, test } from 'bun:test';

import { formatRelativeDate } from './format';

describe('formatRelativeDate', () => {
  test('returns yyyy-mm-dd for iso datetime strings', () => {
    expect(formatRelativeDate('2026-02-11T21:50:37+09:00')).toBe('2026-02-11');
  });

  test('returns input when value is not a date', () => {
    expect(formatRelativeDate('not-a-date')).toBe('not-a-date');
  });
});
