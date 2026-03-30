import { describe, expect, test } from 'bun:test';

import { canDropWorkingTreeFile, getWorkingTreeDropZoneLabel } from './workingTreeDragDrop';

describe('workingTreeDragDrop', () => {
  test('allows staging when dragging from unstaged into staged', () => {
    expect(
      canDropWorkingTreeFile({
        busy: false,
        payload: { file: 'src/App.tsx', source: 'unstaged' },
        target: 'staged'
      })
    ).toBe(true);
  });

  test('allows unstaging when dragging from staged into unstaged', () => {
    expect(
      canDropWorkingTreeFile({
        busy: false,
        payload: { file: 'src/App.tsx', source: 'staged' },
        target: 'unstaged'
      })
    ).toBe(true);
  });

  test('allows stashing from either change bucket', () => {
    expect(
      canDropWorkingTreeFile({
        busy: false,
        payload: { file: 'src/App.tsx', source: 'unstaged' },
        target: 'stash'
      })
    ).toBe(true);

    expect(
      canDropWorkingTreeFile({
        busy: false,
        payload: { file: 'src/App.tsx', source: 'staged' },
        target: 'stash'
      })
    ).toBe(true);
  });

  test('rejects busy drops, same-bucket drops, and blank payloads', () => {
    expect(
      canDropWorkingTreeFile({
        busy: true,
        payload: { file: 'src/App.tsx', source: 'unstaged' },
        target: 'staged'
      })
    ).toBe(false);

    expect(
      canDropWorkingTreeFile({
        busy: false,
        payload: { file: 'src/App.tsx', source: 'unstaged' },
        target: 'unstaged'
      })
    ).toBe(false);

    expect(
      canDropWorkingTreeFile({
        busy: false,
        payload: { file: '   ', source: 'staged' },
        target: 'unstaged'
      })
    ).toBe(false);
  });

  test('returns stable labels for target zone copy', () => {
    expect(getWorkingTreeDropZoneLabel('staged')).toBe('Staged Files');
    expect(getWorkingTreeDropZoneLabel('unstaged')).toBe('Unstaged Files');
    expect(getWorkingTreeDropZoneLabel('stash')).toBe('Stash Area');
  });
});
