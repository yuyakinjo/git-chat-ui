import { describe, expect, test } from "bun:test";

import { resolveCommitGraphColumnLayout } from "../../../src/lib/commitGraphColumns";

describe("resolveCommitGraphColumnLayout", () => {
  test("keeps full column layout when the panel is wide enough", () => {
    expect(
      resolveCommitGraphColumnLayout({
        containerWidth: 980,
        graphColumnWidth: 72,
        refsColumnWidth: 230,
      }),
    ).toEqual({
      isCompact: false,
      displayedRefsColumnWidth: 230,
      templateColumns: "72px 230px 140px minmax(0,1fr) 130px 96px",
    });
  });

  test("switches to compact columns and caps refs width in narrow panels", () => {
    expect(
      resolveCommitGraphColumnLayout({
        containerWidth: 820,
        graphColumnWidth: 72,
        refsColumnWidth: 230,
      }),
    ).toEqual({
      isCompact: true,
      displayedRefsColumnWidth: 112,
      templateColumns: "72px 112px minmax(0,1fr) 96px",
    });
  });
});
