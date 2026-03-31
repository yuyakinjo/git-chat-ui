import { afterEach, describe, expect, mock, test } from 'bun:test';

import { copyTextToClipboard } from '../../../src/lib/clipboard';

const originalClipboard = navigator.clipboard;
const originalDocument = globalThis.document;

afterEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: originalClipboard,
    configurable: true
  });
  Object.defineProperty(globalThis, 'document', {
    value: originalDocument,
    configurable: true
  });
});

describe('copyTextToClipboard', () => {
  test('uses navigator.clipboard.writeText when available', async () => {
    const writeText = mock(async (_text: string) => {});

    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true
    });

    await copyTextToClipboard('abc1234');

    expect(writeText).toHaveBeenCalledWith('abc1234');
  });

  test('falls back to document.execCommand when clipboard api is unavailable', async () => {
    const textarea = {
      value: '',
      style: {},
      setAttribute: mock(() => {}),
      focus: mock(() => {}),
      select: mock(() => {}),
      setSelectionRange: mock((_start: number, _end: number) => {})
    };
    const appendChild = mock((_node: unknown) => {});
    const removeChild = mock((_node: unknown) => {});
    const execCommand = mock((_command: string) => true);

    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true
    });
    Object.defineProperty(globalThis, 'document', {
      value: {
        body: {
          appendChild,
          removeChild
        },
        createElement: mock((_tagName: string) => textarea),
        execCommand
      },
      configurable: true
    });

    await copyTextToClipboard('def5678');

    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(appendChild).toHaveBeenCalledWith(textarea);
    expect(removeChild).toHaveBeenCalledWith(textarea);
    expect(textarea.value).toBe('def5678');
  });

  test('throws when clipboard api and fallback are both unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true
    });
    Object.defineProperty(globalThis, 'document', {
      value: undefined,
      configurable: true
    });

    await expect(copyTextToClipboard('ghi9012')).rejects.toThrow('Clipboard API is not available.');
  });
});
