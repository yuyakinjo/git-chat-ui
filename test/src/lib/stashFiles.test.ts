import { describe, expect, mock, test } from "bun:test";

import { stashFilesAsSingleEntry } from "../../../src/lib/stashFiles";

describe("stashFilesAsSingleEntry", () => {
  test("creates one stash and appends the remaining files to it", async () => {
    const stashFile = mock(async () => ({ ok: true }));
    const appendFileToStash = mock(async () => ({ ok: true }));
    const getStashes = mock(async () => ({
      stashes: [{ id: "stash@{0}" }],
    }));

    await stashFilesAsSingleEntry("/tmp/repo", ["alpha.txt", "beta.txt", "gamma.txt"], {
      stashFile,
      appendFileToStash,
      getStashes,
    });

    expect(stashFile).toHaveBeenCalledTimes(1);
    expect(stashFile).toHaveBeenCalledWith("/tmp/repo", "alpha.txt");
    expect(getStashes).toHaveBeenCalledTimes(1);
    expect(getStashes).toHaveBeenCalledWith("/tmp/repo");
    expect(appendFileToStash).toHaveBeenCalledTimes(2);
    expect(appendFileToStash).toHaveBeenNthCalledWith(1, "/tmp/repo", "stash@{0}", "beta.txt");
    expect(appendFileToStash).toHaveBeenNthCalledWith(2, "/tmp/repo", "stash@{0}", "gamma.txt");
  });

  test("skips append lookup when only one file is selected", async () => {
    const stashFile = mock(async () => ({ ok: true }));
    const appendFileToStash = mock(async () => ({ ok: true }));
    const getStashes = mock(async () => ({
      stashes: [{ id: "stash@{0}" }],
    }));

    await stashFilesAsSingleEntry("/tmp/repo", ["alpha.txt"], {
      stashFile,
      appendFileToStash,
      getStashes,
    });

    expect(stashFile).toHaveBeenCalledTimes(1);
    expect(getStashes).not.toHaveBeenCalled();
    expect(appendFileToStash).not.toHaveBeenCalled();
  });

  test("deduplicates blank and repeated file inputs before stashing", async () => {
    const stashFile = mock(async () => ({ ok: true }));
    const appendFileToStash = mock(async () => ({ ok: true }));
    const getStashes = mock(async () => ({
      stashes: [{ id: "stash@{0}" }],
    }));

    await stashFilesAsSingleEntry("/tmp/repo", ["", "alpha.txt", " alpha.txt ", "beta.txt"], {
      stashFile,
      appendFileToStash,
      getStashes,
    });

    expect(stashFile).toHaveBeenCalledTimes(1);
    expect(stashFile).toHaveBeenCalledWith("/tmp/repo", "alpha.txt");
    expect(appendFileToStash).toHaveBeenCalledTimes(1);
    expect(appendFileToStash).toHaveBeenCalledWith("/tmp/repo", "stash@{0}", "beta.txt");
  });

  test("throws when the created stash cannot be resolved", async () => {
    const stashFile = mock(async () => ({ ok: true }));
    const appendFileToStash = mock(async () => ({ ok: true }));
    const getStashes = mock(async () => ({ stashes: [] }));

    await expect(
      stashFilesAsSingleEntry("/tmp/repo", ["alpha.txt", "beta.txt"], {
        stashFile,
        appendFileToStash,
        getStashes,
      }),
    ).rejects.toThrow("Failed to resolve the newly created stash.");

    expect(appendFileToStash).not.toHaveBeenCalled();
  });
});
