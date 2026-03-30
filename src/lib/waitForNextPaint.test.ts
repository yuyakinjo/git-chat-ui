import { afterEach, describe, expect, test } from 'bun:test';

import { waitForNextPaint } from './waitForNextPaint';

const originalRequestAnimationFrame = globalThis.requestAnimationFrame;

afterEach(() => {
  globalThis.requestAnimationFrame = originalRequestAnimationFrame;
});

describe('waitForNextPaint', () => {
  test('uses requestAnimationFrame when available', async () => {
    let called = false;

    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      called = true;
      callback(0);
      return 1;
    }) as typeof requestAnimationFrame;

    await waitForNextPaint();

    expect(called).toBe(true);
  });

  test('falls back to setTimeout when requestAnimationFrame is unavailable', async () => {
    globalThis.requestAnimationFrame = undefined as unknown as typeof requestAnimationFrame;

    await expect(waitForNextPaint()).resolves.toBeUndefined();
  });
});
