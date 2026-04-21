import { lazy, Suspense, useMemo, type JSX } from "react";

import type { DiffViewerMode } from "../types";
import {
  SplitDiffViewer,
  type SplitDiffRenderFileBodyArgs,
} from "./SplitDiffViewer";

const PierreDiffBody = lazy(() =>
  import("./PierreDiffViewer").then((module) => ({ default: module.PierreDiffBody })),
);

type SplitDiffViewerProps = Parameters<typeof SplitDiffViewer>[0];

export interface DiffViewerProps extends SplitDiffViewerProps {
  mode?: DiffViewerMode;
}

export function DiffViewer({ mode = "builtin", ...rest }: DiffViewerProps): JSX.Element {
  const renderFileBody = useMemo(() => {
    if (mode !== "pierre") {
      return undefined;
    }

    return (args: SplitDiffRenderFileBodyArgs) => (
      <Suspense fallback={<div className="diff-empty-state">Loading Pierre diff viewer...</div>}>
        <PierreDiffBody {...args} />
      </Suspense>
    );
  }, [mode]);

  return <SplitDiffViewer {...rest} renderFileBody={renderFileBody} />;
}
