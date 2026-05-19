import { lazy, Suspense, useCallback, useEffect, useState, type JSX } from "react";

import {
  addOpenCommandPaletteRequestListener,
  isCommandPaletteShortcut,
} from "../lib/commandPalette";
import type { CommandPaletteCommand } from "./CommandPalette";

const CommandPalette = lazy(() =>
  import("./CommandPalette").then((module) => ({ default: module.CommandPalette })),
);

interface ControllerCommandPaletteHostProps {
  active: boolean;
  commands: readonly CommandPaletteCommand[];
  onBeforeOpen?: () => void;
  onExecuteCommand?: (commandId: string) => void;
}

export function ControllerCommandPaletteHost({
  active,
  commands,
  onBeforeOpen,
  onExecuteCommand,
}: ControllerCommandPaletteHostProps): JSX.Element | null {
  const [open, setOpen] = useState(false);

  const openPalette = useCallback((): void => {
    if (!active) {
      return;
    }

    onBeforeOpen?.();
    setOpen(true);
  }, [active, onBeforeOpen]);

  const togglePalette = useCallback((): void => {
    if (!active) {
      return;
    }

    setOpen((current) => {
      if (current) {
        return false;
      }

      onBeforeOpen?.();
      return true;
    });
  }, [active, onBeforeOpen]);

  const closePalette = useCallback((): void => {
    setOpen(false);
  }, []);

  useEffect(() => {
    if (active) {
      return;
    }

    setOpen(false);
  }, [active]);

  useEffect(() => {
    if (!active) {
      return;
    }

    return addOpenCommandPaletteRequestListener(() => {
      openPalette();
    });
  }, [active, openPalette]);

  useEffect(() => {
    if (!active || typeof window === "undefined") {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || !isCommandPaletteShortcut(event)) {
        return;
      }

      event.preventDefault();
      togglePalette();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [active, togglePalette]);

  return open ? (
    <Suspense fallback={null}>
      <CommandPalette
        open={open}
        commands={commands}
        onClose={closePalette}
        onExecuteCommand={onExecuteCommand}
      />
    </Suspense>
  ) : null;
}
