import { describe, expect, test } from 'bun:test';

import { buildIntralineSegments } from './intralineDiff';

describe('buildIntralineSegments', () => {
  test('emphasizes the changed middle section while keeping common prefix and suffix', () => {
    const result = buildIntralineSegments(
      '<div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-2 pb-2">',
      '<div className="min-h-0 flex flex-1 flex-col gap-3 overflow-hidden px-2 pb-2">'
    );

    expect(result.left).toEqual([
      { text: '<div className="min-h-0 flex', emphasized: false },
      { text: '-1 space-y-3 overflow-y-auto', emphasized: true },
      { text: ' px-2 pb-2">', emphasized: false }
    ]);
    expect(result.right).toEqual([
      { text: '<div className="min-h-0 flex', emphasized: false },
      { text: ' flex-1 flex-col gap-3 overflow-hidden', emphasized: true },
      { text: ' px-2 pb-2">', emphasized: false }
    ]);
  });

  test('handles single character substitutions', () => {
    const result = buildIntralineSegments('const count = 1;', 'const count = 2;');

    expect(result.left).toEqual([
      { text: 'const count = ', emphasized: false },
      { text: '1', emphasized: true },
      { text: ';', emphasized: false }
    ]);
    expect(result.right).toEqual([
      { text: 'const count = ', emphasized: false },
      { text: '2', emphasized: true },
      { text: ';', emphasized: false }
    ]);
  });

  test('handles pure insertions without losing the unchanged prefix', () => {
    const result = buildIntralineSegments('return ready;', 'return isReady;');

    expect(result.left).toEqual([
      { text: 'return ', emphasized: false },
      { text: 'r', emphasized: true },
      { text: 'eady;', emphasized: false }
    ]);
    expect(result.right).toEqual([
      { text: 'return ', emphasized: false },
      { text: 'isR', emphasized: true },
      { text: 'eady;', emphasized: false }
    ]);
  });
});
