import { PatchDiff } from "@pierre/diffs/react";
import { useMemo, type JSX } from "react";

import { findSingleFilePatch } from "../lib/diffSplit";
import type { AppThemeId } from "../lib/appTheme";
import type { SplitDiffRenderFileBodyArgs } from "./SplitDiffViewer";

type PierreTheme = "dark-plus" | "light-plus";

function resolvePierreTheme(appThemeId: AppThemeId | null): PierreTheme {
  if (!appThemeId) {
    return "dark-plus";
  }

  const normalized = appThemeId.toLowerCase();
  if (normalized.includes("light")) {
    return "light-plus";
  }

  return "dark-plus";
}

export function PierreDiffBody({
  diff,
  activeFile,
  appThemeId,
}: SplitDiffRenderFileBodyArgs): JSX.Element {
  const patch = useMemo(() => findSingleFilePatch(diff, activeFile), [diff, activeFile]);
  const theme = resolvePierreTheme(appThemeId);

  if (!patch) {
    return <div className="diff-empty-state">Pierre: could not extract single-file patch.</div>;
  }

  return (
    <div className="diff-workbench__pierre" data-theme={theme}>
      <PatchDiff patch={patch} disableWorkerPool />
    </div>
  );
}
