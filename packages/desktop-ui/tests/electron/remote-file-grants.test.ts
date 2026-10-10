import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isLinkedOrInsideLinked,
  linkedPathsGrant,
} from "@stella/desktop/electron/services/remote-file-grants.js";

describe("remote file grants", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "grants-")));
    await fs.mkdir(path.join(root, "compare", "nested"), { recursive: true });
    await fs.writeFile(path.join(root, "compare", "home.png"), "png");
    await fs.writeFile(path.join(root, "compare", "nested", "deep.png"), "png");
    await fs.writeFile(path.join(root, "secret.txt"), "secret");
    await fs.writeFile(path.join(root, "report.pdf"), "pdf");
    await fs.symlink(path.join(root, "secret.txt"), path.join(root, "compare", "escape.txt"));
    await fs.symlink(path.join(root, "secret.txt"), path.join(root, "link-to-secret.txt"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("grants a linked file and nothing beside it", async () => {
    const linked = [path.join(root, "report.pdf")];
    expect(await linkedPathsGrant(path.join(root, "report.pdf"), linked)).toBe(true);
    expect(await linkedPathsGrant(path.join(root, "secret.txt"), linked)).toBe(false);
  });

  it("grants a linked folder and everything inside it", async () => {
    const linked = [path.join(root, "compare")];
    expect(await linkedPathsGrant(path.join(root, "compare"), linked)).toBe(true);
    expect(await linkedPathsGrant(path.join(root, "compare", "home.png"), linked)).toBe(true);
    expect(
      await linkedPathsGrant(path.join(root, "compare", "nested", "deep.png"), linked),
    ).toBe(true);
    expect(await linkedPathsGrant(path.join(root, "secret.txt"), linked)).toBe(false);
  });

  it("never follows a symlink out of a linked folder", async () => {
    const linked = [path.join(root, "compare")];
    expect(await linkedPathsGrant(path.join(root, "compare", "escape.txt"), linked)).toBe(
      false,
    );
  });

  it("grants nothing through a linked symlink", async () => {
    const linked = [path.join(root, "link-to-secret.txt")];
    expect(await linkedPathsGrant(path.join(root, "link-to-secret.txt"), linked)).toBe(false);
    expect(await linkedPathsGrant(path.join(root, "secret.txt"), linked)).toBe(false);
  });

  it("grants nothing for a path that isn't on this computer", async () => {
    const missing = path.join(root, "gone.png");
    expect(await linkedPathsGrant(missing, [missing])).toBe(false);
  });

  it("knows a path linked directly or through its folder", () => {
    const linked = ["/home/alex/work/compare"];
    expect(isLinkedOrInsideLinked("/home/alex/work/compare/a.png", linked)).toBe(true);
    expect(isLinkedOrInsideLinked("/home/alex/work/other.png", linked)).toBe(false);
  });
});
