import { describe, expect, test } from "bun:test";

import { buildConflictCompareRows } from "../../../src/lib/conflictCompare";

describe("buildConflictCompareRows", () => {
  test("keeps shared lines as context and pairs changed lines for inline emphasis", () => {
    const result = buildConflictCompareRows(
      ["@import 'tailwindcss';", "", "@theme {", "  --color-accent: blue;", "}"].join("\n"),
      ["@import 'tailwindcss';", "", "@theme {", "  --color-accent: green;", "}"].join("\n"),
    );

    expect(result.leftLineCount).toBe(5);
    expect(result.rightLineCount).toBe(5);
    expect(result.changedRows).toBe(1);
    expect(result.rows).toEqual([
      {
        kind: "context",
        left: {
          kind: "context",
          lineNumber: 1,
          content: "@import 'tailwindcss';",
          segments: null,
        },
        right: {
          kind: "context",
          lineNumber: 1,
          content: "@import 'tailwindcss';",
          segments: null,
        },
      },
      {
        kind: "context",
        left: { kind: "context", lineNumber: 2, content: "", segments: null },
        right: { kind: "context", lineNumber: 2, content: "", segments: null },
      },
      {
        kind: "context",
        left: { kind: "context", lineNumber: 3, content: "@theme {", segments: null },
        right: { kind: "context", lineNumber: 3, content: "@theme {", segments: null },
      },
      {
        kind: "change",
        left: {
          kind: "delete",
          lineNumber: 4,
          content: "  --color-accent: blue;",
          segments: [
            { text: "  --color-accent: ", emphasized: false },
            { text: "blue", emphasized: true },
            { text: ";", emphasized: false },
          ],
        },
        right: {
          kind: "add",
          lineNumber: 4,
          content: "  --color-accent: green;",
          segments: [
            { text: "  --color-accent: ", emphasized: false },
            { text: "green", emphasized: true },
            { text: ";", emphasized: false },
          ],
        },
      },
      {
        kind: "context",
        left: { kind: "context", lineNumber: 5, content: "}", segments: null },
        right: { kind: "context", lineNumber: 5, content: "}", segments: null },
      },
    ]);
  });

  test("renders missing-side rows as add or delete blocks", () => {
    const result = buildConflictCompareRows(null, "line one\nline two\n");

    expect(result.leftLineCount).toBe(0);
    expect(result.rightLineCount).toBe(3);
    expect(result.changedRows).toBe(3);
    expect(result.rows).toEqual([
      {
        kind: "add",
        left: null,
        right: { kind: "add", lineNumber: 1, content: "line one", segments: null },
      },
      {
        kind: "add",
        left: null,
        right: { kind: "add", lineNumber: 2, content: "line two", segments: null },
      },
      {
        kind: "add",
        left: null,
        right: { kind: "add", lineNumber: 3, content: "", segments: null },
      },
    ]);
  });
});
