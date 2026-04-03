export interface StashFilesTransport {
  stashFile(repoPath: string, file: string): Promise<unknown>;
  appendFileToStash(repoPath: string, stashId: string, file: string): Promise<unknown>;
  getStashes(repoPath: string): Promise<{ stashes: Array<{ id: string }> }>;
}

function normalizeFiles(files: string[]): string[] {
  return Array.from(new Set(files.map((file) => file.trim()).filter((file) => file.length > 0)));
}

export async function stashFilesAsSingleEntry(
  repoPath: string,
  files: string[],
  transport: StashFilesTransport,
): Promise<void> {
  const normalizedFiles = normalizeFiles(files);
  const [firstFile, ...remainingFiles] = normalizedFiles;

  if (!firstFile) {
    return;
  }

  await transport.stashFile(repoPath, firstFile);

  if (remainingFiles.length === 0) {
    return;
  }

  const { stashes } = await transport.getStashes(repoPath);
  const createdStashId = stashes[0]?.id.trim();

  if (!createdStashId) {
    throw new Error("Failed to resolve the newly created stash.");
  }

  for (const file of remainingFiles) {
    await transport.appendFileToStash(repoPath, createdStashId, file);
  }
}
