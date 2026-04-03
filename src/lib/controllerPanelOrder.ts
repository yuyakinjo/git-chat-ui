export const DEFAULT_CONTROLLER_PANEL_ORDER = [
  "commitGraph",
  "gitOperations",
  "commitDetail",
] as const;

export type ControllerPanelId = (typeof DEFAULT_CONTROLLER_PANEL_ORDER)[number];
export type ControllerPanelVisibility = Record<ControllerPanelId, boolean>;

export const DEFAULT_CONTROLLER_PANEL_VISIBILITY: ControllerPanelVisibility = {
  commitGraph: true,
  gitOperations: true,
  commitDetail: true,
};

const CONTROLLER_PANEL_ID_SET = new Set<string>(DEFAULT_CONTROLLER_PANEL_ORDER);

export function isControllerPanelId(value: string): value is ControllerPanelId {
  return CONTROLLER_PANEL_ID_SET.has(value);
}

export function normalizeControllerPanelOrder(
  input: readonly string[] | null | undefined,
): ControllerPanelId[] {
  const seen = new Set<ControllerPanelId>();
  const normalized: ControllerPanelId[] = [];

  for (const value of input ?? []) {
    if (!isControllerPanelId(value) || seen.has(value)) {
      continue;
    }

    seen.add(value);
    normalized.push(value);
  }

  for (const value of DEFAULT_CONTROLLER_PANEL_ORDER) {
    if (!seen.has(value)) {
      normalized.push(value);
    }
  }

  return normalized;
}

export function normalizeControllerPanelVisibility(
  input: Record<string, unknown> | null | undefined,
): ControllerPanelVisibility {
  const normalized: ControllerPanelVisibility = { ...DEFAULT_CONTROLLER_PANEL_VISIBILITY };

  if (!input) {
    return normalized;
  }

  for (const panelId of DEFAULT_CONTROLLER_PANEL_ORDER) {
    const value = input[panelId];
    if (typeof value === "boolean") {
      normalized[panelId] = value;
    }
  }

  return normalized;
}

export function getVisibleControllerPanelOrder(
  order: readonly ControllerPanelId[],
  visibility: ControllerPanelVisibility,
): ControllerPanelId[] {
  return order.filter((panelId) => visibility[panelId]);
}

export function toggleControllerPanelVisibility(
  visibility: ControllerPanelVisibility,
  panelId: ControllerPanelId,
): ControllerPanelVisibility {
  return {
    ...visibility,
    [panelId]: !visibility[panelId],
  };
}

export function canSwapControllerPanel(options: {
  busy: boolean;
  sourceId: ControllerPanelId | null;
  targetId: ControllerPanelId | null;
}): boolean {
  const { busy, sourceId, targetId } = options;
  if (busy || !sourceId || !targetId) {
    return false;
  }

  return sourceId !== targetId;
}

export function swapControllerPanels(
  order: readonly ControllerPanelId[],
  sourceId: ControllerPanelId,
  targetId: ControllerPanelId,
): ControllerPanelId[] {
  if (sourceId === targetId) {
    return [...order];
  }

  const sourceIndex = order.indexOf(sourceId);
  const targetIndex = order.indexOf(targetId);

  if (sourceIndex < 0 || targetIndex < 0) {
    return [...order];
  }

  const next = [...order];
  next[sourceIndex] = targetId;
  next[targetIndex] = sourceId;
  return next;
}
