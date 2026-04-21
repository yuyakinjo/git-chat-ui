import { lazy, Suspense, type JSX } from "react";

import type { DiffViewerMode } from "../types";
import {
  SplitDiffViewer,
  type SplitDiffRenderFileBodyArgs,
  type SplitDiffViewerProps,
} from "./SplitDiffViewer";

const PierreDiffBody = lazy(() =>
  import("./PierreDiffViewer").then((module) => ({ default: module.PierreDiffBody })),
);

export interface DiffViewerProps extends SplitDiffViewerProps {
  mode?: DiffViewerMode;
}

function renderPierreFileBody(args: SplitDiffRenderFileBodyArgs): JSX.Element {
  return (
    <Suspense fallback={<div className="diff-empty-state">Loading Pierre diff viewer...</div>}>
      <PierreDiffBody {...args} />
    </Suspense>
  );
}

export function DiffViewer({ mode = "builtin", ...rest }: DiffViewerProps): JSX.Element {
  return (
    <SplitDiffViewer
      {...rest}
      renderFileBody={mode === "pierre" ? renderPierreFileBody : undefined}
    />
  );
}
