import { describe, expect, test } from "bun:test";

import { formatRelativeDate } from "../../../src/lib/format";

describe("formatRelativeDate", () => {
  test("returns yyyy/mm/dd @ HH:mm for iso datetime strings", () => {
    const result = formatRelativeDate("2026-02-11T21:50:37+09:00");
    expect(result).toMatch(/^\d{4}\/\d{2}\/\d{2} @ \d{2}:\d{2}$/);
  });

  test("returns input when value is not a date", () => {
    expect(formatRelativeDate("not-a-date")).toBe("not-a-date");
  });
});
