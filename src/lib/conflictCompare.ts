import { buildIntralineSegments, type IntralineSegment } from "./intralineDiff";

type ConflictCompareCellKind = "context" | "add" | "delete";
type ConflictCompareRowKind = "context" | "change" | "add" | "delete";
type AlignmentOp =
  | { kind: "context"; leftIndex: number; rightIndex: number }
  | { kind: "delete"; leftIndex: number }
  | { kind: "add"; rightIndex: number };

export interface ConflictCompareCell {
  kind: ConflictCompareCellKind;
  lineNumber: number | null;
  content: string;
  segments: IntralineSegment[] | null;
}

export interface ConflictCompareRow {
  kind: ConflictCompareRowKind;
  left: ConflictCompareCell | null;
  right: ConflictCompareCell | null;
}

export interface ConflictCompareResult {
  rows: ConflictCompareRow[];
  leftLineCount: number;
  rightLineCount: number;
  changedRows: number;
}

const MAX_ALIGNMENT_CELLS = 400_000;

function splitLines(content: string | null): string[] {
  if (content === null) {
    return [];
  }

  return content.split("\n");
}

function createCell(
  kind: ConflictCompareCellKind,
  lineNumber: number | null,
  content: string,
  segments: IntralineSegment[] | null = null,
): ConflictCompareCell {
  return {
    kind,
    lineNumber,
    content,
    segments,
  };
}

function buildIndexAlignedOperations(leftLines: string[], rightLines: string[]): AlignmentOp[] {
  const rows: AlignmentOp[] = [];
  const maxLength = Math.max(leftLines.length, rightLines.length);

  for (let index = 0; index < maxLength; index += 1) {
    const hasLeft = index < leftLines.length;
    const hasRight = index < rightLines.length;

    if (hasLeft && hasRight && leftLines[index] === rightLines[index]) {
      rows.push({ kind: "context", leftIndex: index, rightIndex: index });
      continue;
    }

    if (hasLeft) {
      rows.push({ kind: "delete", leftIndex: index });
    }

    if (hasRight) {
      rows.push({ kind: "add", rightIndex: index });
    }
  }

  return rows;
}

function buildAlignmentOperations(leftLines: string[], rightLines: string[]): AlignmentOp[] {
  const alignmentCells = leftLines.length * rightLines.length;
  if (alignmentCells > MAX_ALIGNMENT_CELLS) {
    return buildIndexAlignedOperations(leftLines, rightLines);
  }

  const matrix = Array.from(
    { length: leftLines.length + 1 },
    () => new Uint32Array(rightLines.length + 1),
  );

  for (let leftIndex = leftLines.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = rightLines.length - 1; rightIndex >= 0; rightIndex -= 1) {
      if (leftLines[leftIndex] === rightLines[rightIndex]) {
        matrix[leftIndex][rightIndex] = matrix[leftIndex + 1][rightIndex + 1] + 1;
      } else {
        matrix[leftIndex][rightIndex] = Math.max(
          matrix[leftIndex + 1][rightIndex],
          matrix[leftIndex][rightIndex + 1],
        );
      }
    }
  }

  const operations: AlignmentOp[] = [];
  let leftIndex = 0;
  let rightIndex = 0;

  while (leftIndex < leftLines.length && rightIndex < rightLines.length) {
    if (leftLines[leftIndex] === rightLines[rightIndex]) {
      operations.push({ kind: "context", leftIndex, rightIndex });
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }

    if (matrix[leftIndex + 1][rightIndex] >= matrix[leftIndex][rightIndex + 1]) {
      operations.push({ kind: "delete", leftIndex });
      leftIndex += 1;
      continue;
    }

    operations.push({ kind: "add", rightIndex });
    rightIndex += 1;
  }

  while (leftIndex < leftLines.length) {
    operations.push({ kind: "delete", leftIndex });
    leftIndex += 1;
  }

  while (rightIndex < rightLines.length) {
    operations.push({ kind: "add", rightIndex });
    rightIndex += 1;
  }

  return operations;
}

function flushPendingChanges(
  rows: ConflictCompareRow[],
  leftLines: string[],
  rightLines: string[],
  pendingDeletes: number[],
  pendingAdds: number[],
): void {
  const rowCount = Math.max(pendingDeletes.length, pendingAdds.length);
  if (rowCount === 0) {
    return;
  }

  for (let index = 0; index < rowCount; index += 1) {
    const leftIndex = pendingDeletes[index];
    const rightIndex = pendingAdds[index];

    if (leftIndex !== undefined && rightIndex !== undefined) {
      const leftContent = leftLines[leftIndex] ?? "";
      const rightContent = rightLines[rightIndex] ?? "";
      const segments = buildIntralineSegments(leftContent, rightContent);

      rows.push({
        kind: "change",
        left: createCell("delete", leftIndex + 1, leftContent, segments.left),
        right: createCell("add", rightIndex + 1, rightContent, segments.right),
      });
      continue;
    }

    if (leftIndex !== undefined) {
      rows.push({
        kind: "delete",
        left: createCell("delete", leftIndex + 1, leftLines[leftIndex] ?? ""),
        right: null,
      });
      continue;
    }

    if (rightIndex !== undefined) {
      rows.push({
        kind: "add",
        left: null,
        right: createCell("add", rightIndex + 1, rightLines[rightIndex] ?? ""),
      });
    }
  }

  pendingDeletes.length = 0;
  pendingAdds.length = 0;
}

export function buildConflictCompareRows(
  leftContent: string | null,
  rightContent: string | null,
): ConflictCompareResult {
  const leftLines = splitLines(leftContent);
  const rightLines = splitLines(rightContent);
  const operations = buildAlignmentOperations(leftLines, rightLines);
  const rows: ConflictCompareRow[] = [];
  const pendingDeletes: number[] = [];
  const pendingAdds: number[] = [];

  for (const operation of operations) {
    if (operation.kind === "context") {
      flushPendingChanges(rows, leftLines, rightLines, pendingDeletes, pendingAdds);
      rows.push({
        kind: "context",
        left: createCell("context", operation.leftIndex + 1, leftLines[operation.leftIndex] ?? ""),
        right: createCell(
          "context",
          operation.rightIndex + 1,
          rightLines[operation.rightIndex] ?? "",
        ),
      });
      continue;
    }

    if (operation.kind === "delete") {
      pendingDeletes.push(operation.leftIndex);
      continue;
    }

    pendingAdds.push(operation.rightIndex);
  }

  flushPendingChanges(rows, leftLines, rightLines, pendingDeletes, pendingAdds);

  return {
    rows,
    leftLineCount: leftLines.length,
    rightLineCount: rightLines.length,
    changedRows: rows.filter((row) => row.kind !== "context").length,
  };
}
