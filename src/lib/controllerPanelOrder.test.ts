import { describe, expect, test } from 'bun:test';

import {
  canSwapControllerPanel,
  normalizeControllerPanelOrder,
  swapControllerPanels
} from './controllerPanelOrder';

describe('controllerPanelOrder', () => {
  test('normalizes invalid, duplicate, and missing panel ids', () => {
    expect(normalizeControllerPanelOrder(['gitOperations', 'invalid', 'gitOperations'])).toEqual([
      'gitOperations',
      'commitGraph',
      'commitDetail'
    ]);
  });

  test('rejects swaps while busy or when source/target are missing', () => {
    expect(
      canSwapControllerPanel({
        busy: true,
        sourceId: 'commitGraph',
        targetId: 'gitOperations'
      })
    ).toBe(false);

    expect(
      canSwapControllerPanel({
        busy: false,
        sourceId: 'commitGraph',
        targetId: null
      })
    ).toBe(false);
  });

  test('rejects swapping the same panel id', () => {
    expect(
      canSwapControllerPanel({
        busy: false,
        sourceId: 'commitGraph',
        targetId: 'commitGraph'
      })
    ).toBe(false);
  });

  test('swaps source and target positions in the current order', () => {
    expect(
      swapControllerPanels(
        ['commitGraph', 'gitOperations', 'commitDetail'],
        'commitGraph',
        'commitDetail'
      )
    ).toEqual(['commitDetail', 'gitOperations', 'commitGraph']);
  });
});
