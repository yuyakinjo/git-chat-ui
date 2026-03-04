export function formatRelativeDate(iso: string): string {
  const normalizedIsoDate = iso.trim().match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (normalizedIsoDate) {
    return normalizedIsoDate;
  }

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export function compactPath(fullPath: string): string {
  if (fullPath.length <= 65) {
    return fullPath;
  }

  return `${fullPath.slice(0, 24)}...${fullPath.slice(-34)}`;
}
