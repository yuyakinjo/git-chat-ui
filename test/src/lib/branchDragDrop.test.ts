import { describe, expect, test } from "bun:test";

import type { Branch } from "../../../src/types";

import {
  canDropBranchOnBranch,
  parseBranchDragPayload,
  serializeBranchDragPayload,
} from "../../../src/lib/branchDragDrop";

const localTarget: Branch = {
  name: "main",
  fullRef: "refs/heads/main",
  type: "local",
  commit: "1111111",
};

const remoteTarget: Branch = {
  name: "origin/main",
  fullRef: "refs/remotes/origin/main",
  type: "remote",
  commit: "2222222",
};

describe("branchDragDrop", () => {
  test("serializes and parses a local branch payload", () => {
    const payload = parseBranchDragPayload(
      serializeBranchDragPayload({
        branchName: "feature/dnd",
        branchType: "local",
      }),
    );

    expect(payload).toEqual({
      branchName: "feature/dnd",
      branchType: "local",
    });
  });

  test("rejects drops while busy", () => {
    expect(
      canDropBranchOnBranch({
        busy: true,
        source: { branchName: "feature/dnd", branchType: "local" },
        target: localTarget,
      }),
    ).toBe(false);
  });

  test("rejects self-drop and remote targets", () => {
    expect(
      canDropBranchOnBranch({
        busy: false,
        source: { branchName: "main", branchType: "local" },
        target: localTarget,
      }),
    ).toBe(false);

    expect(
      canDropBranchOnBranch({
        busy: false,
        source: { branchName: "feature/dnd", branchType: "local" },
        target: remoteTarget,
      }),
    ).toBe(false);
  });

  test("rejects remote payloads even when target is local", () => {
    expect(
      canDropBranchOnBranch({
        busy: false,
        source: { branchName: "origin/feature/dnd", branchType: "remote" },
        target: localTarget,
      }),
    ).toBe(false);
  });
});
