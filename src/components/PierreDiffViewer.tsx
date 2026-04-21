import { PatchDiff } from "@pierre/diffs/react";
import { useMemo, type JSX } from "react";

import { getAppThemeMode } from "../lib/appTheme";
import { findSingleFilePatch } from "../lib/diffSplit";
import type { SplitDiffRenderFileBodyArgs } from "./SplitDiffViewer";

export function PierreDiffBody({
  diff,
  activeFile,
  appThemeId,
}: SplitDiffRenderFileBodyArgs): JSX.Element {
  const patch = useMemo(
    () => findSingleFilePatch(diff, activeFile),
    [diff, activeFile.key],
  );
  const theme = getAppThemeMode(appThemeId) === "light" ? "light-plus" : "dark-plus";

  if (!patch) {
    return <div className="diff-empty-state">Pierre: could not extract single-file patch.</div>;
  }

  return (
    <div className="diff-workbench__pierre" data-theme={theme}>
      <PatchDiff patch={patch} disableWorkerPool />
    </div>
  );
}
