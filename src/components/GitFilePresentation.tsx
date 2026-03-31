import { Circle, Minus, Pencil, Plus } from "lucide-react";

import type { WorkingFile } from "../types";

import type { JSX } from "react";

export type WorkingFileStatusTone = "modified" | "added" | "deleted" | "changed";

function splitGitFilePath(filePath: string): { directory: string | null; fileName: string } {
  const lastSlashIndex = filePath.lastIndexOf("/");
  if (lastSlashIndex < 0) {
    return {
      directory: null,
      fileName: filePath,
    };
  }

  return {
    directory: filePath.slice(0, lastSlashIndex + 1),
    fileName: filePath.slice(lastSlashIndex + 1),
  };
}

export function GitFilePathLabel({ path }: { path: string }): JSX.Element {
  const { directory, fileName } = splitGitFilePath(path);

  return (
    <span className="git-file-path-label" title={path}>
      {directory ? <span className="git-file-path-label__directory">{directory}</span> : null}
      <span className="git-file-path-label__name">{fileName}</span>
    </span>
  );
}

export function getWorkingFileStatusPresentation(
  item: Pick<WorkingFile, "x" | "y" | "statusLabel">,
): {
  tone: WorkingFileStatusTone;
  label: string;
  icon: JSX.Element;
} {
  const code = item.x !== " " && item.x !== "?" ? item.x : item.y;

  switch (code) {
    case "M":
      return {
        tone: "modified",
        label: item.statusLabel,
        icon: <Pencil size={12} />,
      };
    case "A":
    case "?":
      return {
        tone: "added",
        label: item.statusLabel,
        icon: <Plus size={13} strokeWidth={2.4} />,
      };
    case "D":
      return {
        tone: "deleted",
        label: item.statusLabel,
        icon: <Minus size={13} strokeWidth={2.4} />,
      };
    default:
      return {
        tone: "changed",
        label: item.statusLabel,
        icon: <Circle size={11} />,
      };
  }
}
