export interface IntralineSegment {
  text: string;
  emphasized: boolean;
}

function pushSegment(segments: IntralineSegment[], text: string, emphasized: boolean): void {
  if (!text) {
    return;
  }

  const previous = segments.at(-1);
  if (previous && previous.emphasized === emphasized) {
    previous.text += text;
    return;
  }

  segments.push({ text, emphasized });
}

function buildSegments(source: string, prefixLength: number, suffixStart: number): IntralineSegment[] {
  const segments: IntralineSegment[] = [];

  pushSegment(segments, source.slice(0, prefixLength), false);
  pushSegment(segments, source.slice(prefixLength, suffixStart), true);
  pushSegment(segments, source.slice(suffixStart), false);

  return segments;
}

export function buildIntralineSegments(
  left: string,
  right: string
): {
  left: IntralineSegment[];
  right: IntralineSegment[];
} {
  if (left === right) {
    return {
      left: [{ text: left, emphasized: false }],
      right: [{ text: right, emphasized: false }]
    };
  }

  let prefixLength = 0;
  const limit = Math.min(left.length, right.length);
  while (prefixLength < limit && left[prefixLength] === right[prefixLength]) {
    prefixLength += 1;
  }

  let leftSuffixStart = left.length;
  let rightSuffixStart = right.length;
  while (
    leftSuffixStart > prefixLength &&
    rightSuffixStart > prefixLength &&
    left[leftSuffixStart - 1] === right[rightSuffixStart - 1]
  ) {
    leftSuffixStart -= 1;
    rightSuffixStart -= 1;
  }

  return {
    left: buildSegments(left, prefixLength, leftSuffixStart),
    right: buildSegments(right, prefixLength, rightSuffixStart)
  };
}
