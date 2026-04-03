import { describe, expect, test } from "bun:test";

import { parseCommitFileStats } from "../../server/git/command";

describe("parseCommitFileStats", () => {
  test("preserves stable file kinds from name-status output", () => {
    const result = parseCommitFileStats(
      ["5\t1\tsrc/app.ts", "3\t0\tsrc/old.ts => src/new.ts"].join("\n"),
      ["M\tsrc/app.ts", "R100\tsrc/old.ts\tsrc/new.ts"].join("\n"),
    );

    expect(result).toEqual([
      {
        file: "src/app.ts",
        additions: 5,
        deletions: 1,
        kind: "modified",
      },
      {
        file: "src/new.ts",
        additions: 3,
        deletions: 0,
        kind: "renamed",
      },
    ]);
  });

  test("falls back to changed when no file kind metadata is available", () => {
    const result = parseCommitFileStats("2\t4\tsrc/app.ts");

    expect(result).toEqual([
      {
        file: "src/app.ts",
        additions: 2,
        deletions: 4,
        kind: "changed",
      },
    ]);
  });
});
