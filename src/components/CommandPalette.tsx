import { Search, type LucideIcon } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState, type JSX } from "react";

import {
  filterCommandPaletteItems,
  getDefaultActiveCommandPaletteItemId,
  getNextActiveCommandPaletteItemId,
  type SearchableCommandPaletteItem,
} from "../lib/commandPalette";

export interface CommandPaletteCommand extends SearchableCommandPaletteItem {
  icon: LucideIcon;
  onSelect: () => void | Promise<void>;
}

interface CommandPaletteProps {
  open: boolean;
  commands: readonly CommandPaletteCommand[];
  onClose: () => void;
}

export function CommandPalette({
  open,
  commands,
  onClose,
}: CommandPaletteProps): JSX.Element | ReturnType<typeof createPortal> | null {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const [query, setQuery] = useState("");
  const [activeCommandId, setActiveCommandId] = useState<string | null>(null);
  const [pointerSelectionEnabled, setPointerSelectionEnabled] = useState(false);

  const filteredCommands = useMemo(
    () => filterCommandPaletteItems(commands, query),
    [commands, query],
  );

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveCommandId(null);
      setPointerSelectionEnabled(false);
      return;
    }

    setQuery("");
    setActiveCommandId(null);
    setPointerSelectionEnabled(false);
    inputRef.current?.focus();
  }, [commands, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setActiveCommandId((current) => {
      if (filteredCommands.length === 0) {
        return null;
      }

      return filteredCommands.some((command) => command.id === current)
        ? current
        : getDefaultActiveCommandPaletteItemId(filteredCommands, query);
    });
  }, [filteredCommands, open, query]);

  useEffect(() => {
    if (!open || !activeCommandId) {
      return;
    }

    optionRefs.current.get(activeCommandId)?.scrollIntoView({
      block: "nearest",
    });
  }, [activeCommandId, open]);

  if (!open) {
    return null;
  }

  const executeCommand = (command: CommandPaletteCommand): void => {
    if (command.disabledReason) {
      return;
    }

    onClose();
    void command.onSelect();
  };

  const moveActiveCommand = (direction: 1 | -1): void => {
    setActiveCommandId((current) =>
      getNextActiveCommandPaletteItemId(filteredCommands, current, direction),
    );
  };

  const handleCommandPointerMove = (commandId: string): void => {
    setPointerSelectionEnabled(true);
    setActiveCommandId((current) => (current === commandId ? current : commandId));
  };

  const content = (
    <div
      className="command-palette"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="panel command-palette__panel"
        role="dialog"
        aria-modal="true"
        aria-label="Command Palette"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="command-palette__search">
          <Search size={16} aria-hidden="true" />
          <input
            ref={inputRef}
            className="command-palette__search-input"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                moveActiveCommand(1);
                return;
              }

              if (event.key === "ArrowUp") {
                event.preventDefault();
                moveActiveCommand(-1);
                return;
              }

              if (event.key !== "Enter") {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  onClose();
                }
                return;
              }

              const activeCommand = filteredCommands.find(
                (command) => command.id === activeCommandId,
              );
              if (!activeCommand) {
                return;
              }

              event.preventDefault();
              executeCommand(activeCommand);
            }}
            placeholder="Search commands"
            autoFocus
            spellCheck={false}
          />
        </div>

        <div
          className={`command-palette__results ${pointerSelectionEnabled ? "is-pointer-active" : ""}`}
          role="listbox"
          aria-label="Available commands"
        >
          {filteredCommands.length > 0 ? (
            filteredCommands.map((command) => {
              const Icon = command.icon;
              const isActive = command.id === activeCommandId;
              const detail = command.disabledReason ?? command.description ?? "";

              return (
                <button
                  key={command.id}
                  ref={(node) => {
                    if (node) {
                      optionRefs.current.set(command.id, node);
                    } else {
                      optionRefs.current.delete(command.id);
                    }
                  }}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  className={`command-palette__item ${isActive ? "is-active" : ""}`}
                  disabled={Boolean(command.disabledReason)}
                  onMouseDown={(event) => event.preventDefault()}
                  onPointerMove={() => handleCommandPointerMove(command.id)}
                  onClick={() => executeCommand(command)}
                >
                  <span className="command-palette__item-icon" aria-hidden="true">
                    <Icon size={16} />
                  </span>
                  <span className="command-palette__item-copy">
                    <span className="command-palette__item-title">{command.title}</span>
                    {detail ? (
                      <span className="command-palette__item-description">{detail}</span>
                    ) : null}
                  </span>
                </button>
              );
            })
          ) : (
            <div className="command-palette__empty">No commands match your search.</div>
          )}
        </div>
      </section>
    </div>
  );

  if (typeof document === "undefined") {
    return content;
  }

  return createPortal(content, document.body);
}
