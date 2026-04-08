export function formatRelativeDate(iso: string): string {
  const date = new Date(iso.trim());
  if (Number.isNaN(date.getTime())) {
    // Fallback: try extracting bare date string
    const bare = iso.trim().match(/^\d{4}-\d{2}-\d{2}/)?.[0];
    return bare ?? iso;
  }

  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}/${month}/${day} @ ${hours}:${minutes}`;
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export function formatFileCountLabel(count: number): string {
  return `${count} file${count === 1 ? "" : "s"}`;
}

export function compactPath(fullPath: string): string {
  if (fullPath.length <= 65) {
    return fullPath;
  }

  return `${fullPath.slice(0, 24)}...${fullPath.slice(-34)}`;
}
