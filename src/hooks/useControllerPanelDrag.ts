import { useCallback, useEffect, useRef, useState } from "react";

import {
  canSwapControllerPanel,
  DEFAULT_CONTROLLER_PANEL_ORDER,
  isControllerPanelId,
  normalizeControllerPanelOrder,
  swapControllerPanels,
  type ControllerPanelId,
} from "../lib/controllerPanelOrder";
import {
  CONTROLLER_PANEL_ORDER_STORAGE_KEY,
  controllerPanelLabels,
  PANEL_DRAG_THRESHOLD_PX,
  shouldIgnoreControllerPanelPointerDown,
} from "../lib/controllerViewUtils";

interface UseControllerPanelDragParams {
  repoPath: string;
  operationBusy: boolean;
}

interface UseControllerPanelDragResult {
  panelOrder: ControllerPanelId[];
  draggedPanelId: ControllerPanelId | null;
  dropTargetPanelId: ControllerPanelId | null;
  panelDragPreviewPosition: { x: number; y: number } | null;
  panelDragHint: string | null;
  handlePanelPointerDown: (
    event: React.PointerEvent<HTMLDivElement>,
    panelId: ControllerPanelId,
  ) => void;
}

export function useControllerPanelDrag({
  repoPath,
  operationBusy,
}: UseControllerPanelDragParams): UseControllerPanelDragResult {
  const [panelOrder, setPanelOrder] = useState<ControllerPanelId[]>(() => {
    if (typeof window === "undefined") {
      return [...DEFAULT_CONTROLLER_PANEL_ORDER];
    }

    try {
      const raw = window.localStorage.getItem(CONTROLLER_PANEL_ORDER_STORAGE_KEY);
      if (!raw) {
        return [...DEFAULT_CONTROLLER_PANEL_ORDER];
      }

      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? normalizeControllerPanelOrder(
            parsed.filter((value): value is string => typeof value === "string"),
          )
        : [...DEFAULT_CONTROLLER_PANEL_ORDER];
    } catch {
      return [...DEFAULT_CONTROLLER_PANEL_ORDER];
    }
  });
  const [draggedPanelId, setDraggedPanelId] = useState<ControllerPanelId | null>(null);
  const [dropTargetPanelId, setDropTargetPanelId] = useState<ControllerPanelId | null>(null);
  const [panelDragPreviewPosition, setPanelDragPreviewPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const panelDragPointerRef = useRef<{
    panelId: ControllerPanelId;
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);
  const draggedPanelIdRef = useRef<ControllerPanelId | null>(null);
  const dropTargetPanelIdRef = useRef<ControllerPanelId | null>(null);

  const panelDragHint = draggedPanelId
    ? dropTargetPanelId
      ? `${controllerPanelLabels[dropTargetPanelId]} にドロップして位置を入れ替え`
      : "別のパネルにドロップして位置を入れ替え"
    : null;

  const updateDraggedPanelId = useCallback((value: ControllerPanelId | null): void => {
    draggedPanelIdRef.current = value;
    setDraggedPanelId(value);
  }, []);

  const updateDropTargetPanelId = useCallback((value: ControllerPanelId | null): void => {
    dropTargetPanelIdRef.current = value;
    setDropTargetPanelId(value);
  }, []);

  const clearPanelDragState = useCallback((): void => {
    panelDragPointerRef.current = null;
    updateDraggedPanelId(null);
    updateDropTargetPanelId(null);
    setPanelDragPreviewPosition(null);
  }, [updateDraggedPanelId, updateDropTargetPanelId]);

  const handlePanelPointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
    panelId: ControllerPanelId,
  ): void => {
    if (event.button !== 0 || operationBusy) {
      return;
    }

    if (shouldIgnoreControllerPanelPointerDown(event.target)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    window.getSelection()?.removeAllRanges();
    panelDragPointerRef.current = {
      panelId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
    updateDropTargetPanelId(null);
  };

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(CONTROLLER_PANEL_ORDER_STORAGE_KEY, JSON.stringify(panelOrder));
  }, [panelOrder]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    document.body.classList.toggle("is-controller-panel-dragging", Boolean(draggedPanelId));
    return () => {
      document.body.classList.remove("is-controller-panel-dragging");
    };
  }, [draggedPanelId]);

  useEffect(() => {
    clearPanelDragState();
  }, [clearPanelDragState, repoPath]);

  useEffect(() => {
    if (!operationBusy) {
      return;
    }

    clearPanelDragState();
  }, [clearPanelDragState, operationBusy]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent): void => {
      const dragPointer = panelDragPointerRef.current;
      if (!dragPointer || dragPointer.pointerId !== event.pointerId) {
        return;
      }

      const offsetX = event.clientX - dragPointer.startX;
      const offsetY = event.clientY - dragPointer.startY;
      const distance = Math.hypot(offsetX, offsetY);

      if (!draggedPanelIdRef.current && distance < PANEL_DRAG_THRESHOLD_PX) {
        return;
      }

      if (!draggedPanelIdRef.current) {
        updateDraggedPanelId(dragPointer.panelId);
      }

      setPanelDragPreviewPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const element = document.elementFromPoint(event.clientX, event.clientY);
      const targetId = element?.closest<HTMLElement>("[data-controller-panel-drop-id]")?.dataset
        .controllerPanelDropId;

      if (
        targetId &&
        isControllerPanelId(targetId) &&
        canSwapControllerPanel({
          busy: operationBusy,
          sourceId: dragPointer.panelId,
          targetId,
        })
      ) {
        updateDropTargetPanelId(targetId);
        return;
      }

      updateDropTargetPanelId(null);
    };

    const handlePointerUp = (event: PointerEvent): void => {
      const dragPointer = panelDragPointerRef.current;
      if (!dragPointer || dragPointer.pointerId !== event.pointerId) {
        return;
      }

      const sourceId = dragPointer.panelId;
      const targetId = dropTargetPanelIdRef.current;
      const didDrag = draggedPanelIdRef.current === sourceId;

      if (
        didDrag &&
        targetId &&
        canSwapControllerPanel({
          busy: operationBusy,
          sourceId,
          targetId,
        })
      ) {
        setPanelOrder((current) => swapControllerPanels(current, sourceId, targetId));
      }

      clearPanelDragState();
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [clearPanelDragState, operationBusy, updateDraggedPanelId, updateDropTargetPanelId]);

  return {
    panelOrder,
    draggedPanelId,
    dropTargetPanelId,
    panelDragPreviewPosition,
    panelDragHint,
    handlePanelPointerDown,
  };
}
