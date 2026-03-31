import { describe, expect, test } from "bun:test";

import {
  canDiscardWorkingFile,
  getWorkingTreeDiscardConfirmMessage,
  resolveWorkingTreeDiscardTarget,
} from "../../../src/lib/workingTreeDiscard";

describe("workingTreeDiscard", () => {
  test("treats pure untracked paths as delete targets", () => {
    expect(
      canDiscardWorkingFile({
        x: "?",
        y: "?",
      }),
    ).toBe(true);

    expect(
      resolveWorkingTreeDiscardTarget(
        {
          file: "repo/",
          x: "?",
          y: "?",
        },
        "unstaged",
      ),
    ).toEqual({
      file: "repo/",
      mode: "delete",
    });
  });

  test("uses delete copy for staged-added files", () => {
    const target = resolveWorkingTreeDiscardTarget(
      {
        file: "src/new-file.ts",
        x: "A",
        y: " ",
      },
      "staged",
    );

    expect(target).toEqual({
      file: "src/new-file.ts",
      mode: "delete",
    });
    expect(getWorkingTreeDiscardConfirmMessage(target!)).toContain(
      "ファイルまたはディレクトリ自体が削除されます。",
    );
  });

  test("treats partial-stage files as file-level discard regardless of list source", () => {
    const stagedTarget = resolveWorkingTreeDiscardTarget(
      {
        file: "src/new-file.ts",
        x: "A",
        y: "M",
      },
      "staged",
    );
    const unstagedTarget = resolveWorkingTreeDiscardTarget(
      {
        file: "src/new-file.ts",
        x: "A",
        y: "M",
      },
      "unstaged",
    );

    expect(stagedTarget).toEqual(unstagedTarget);
    expect(stagedTarget).toEqual({
      file: "src/new-file.ts",
      mode: "delete",
    });
  });
});
