import { matchesParsedDiffFilePath } from "./diff";
import type { ParsedDiffFile } from "./diff";

export interface SplitDiffFilePatch {
  headerPath: string;
  patch: string;
}

export function splitUnifiedDiffByFile(diff: string): SplitDiffFilePatch[] {
  if (!diff.trim()) {
    return [];
  }

  const matches = Array.from(diff.matchAll(/^diff --git a\/(.+?) b\/(.+?)$/gm));
  if (matches.length === 0) {
    return [];
  }

  const results: SplitDiffFilePatch[] = [];
  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    const start = match.index ?? 0;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? diff.length) : diff.length;
    const patch = diff.slice(start, end);
    const headerPath = match[2] ?? match[1] ?? "";
    results.push({ headerPath, patch });
  }

  return results;
}

export function findSingleFilePatch(
  diff: string,
  file: Pick<ParsedDiffFile, "displayPath" | "newPath" | "oldPath">,
): string | null {
  for (const chunk of splitUnifiedDiffByFile(diff)) {
    if (matchesParsedDiffFilePath(file, chunk.headerPath)) {
      return chunk.patch;
    }
  }

  return null;
}
