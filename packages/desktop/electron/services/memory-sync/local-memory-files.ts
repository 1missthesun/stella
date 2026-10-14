import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  MEMORY_LIST_MAX_FILES,
  isSyncedMemoryPath,
} from "@stella/runtime/kernel/memory/memory-client.js";
import {
  MEMORIES_DIR,
  PERSONALITY_FILE,
} from "@stella/runtime/kernel/memory/memory-layout.js";

const MAX_WALK_ENTRIES = 5_000;

export const sha256Hex = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const errorCode = (error: unknown): string | undefined =>
  error && typeof error === "object" && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;

type CachedHash = { mtimeMs: number; size: number; ino: number; sha: string };

/**
 * `moved`: the file was not at the expected sha and nothing changed.
 * `displaced`: another version was taken off the path and given to `preserve`.
 */
export type LocalMutation =
  | { status: "done" }
  | { status: "moved" }
  | { status: "displaced" };

/** Keeps bytes another writer put at `relative`; must be durable on return. */
export type PreserveDisplaced = (
  relative: string,
  bytes: Uint8Array,
) => Promise<void>;

/**
 * This computer's side of the memory sync: the synced files under
 * `~/.stella` (`isSyncedMemoryPath`).
 *
 * Other programs edit these files with ordinary writes, so no check can
 * promise the file is unchanged at the instant of a rename. Instead nothing
 * here destroys bytes it has not inspected: a new file is published with
 * link(), which fails rather than replace one; a replaced or deleted file is
 * first held under a hidden sibling and read, and any version other than the
 * expected one goes to `preserve`.
 */
export class LocalMemoryFiles {
  private readonly hashes = new Map<string, CachedHash>();

  constructor(
    private readonly stellaDataDir: string,
    private readonly preserve: PreserveDisplaced,
  ) {}

  absolute(relative: string): string {
    return path.join(this.stellaDataDir, ...relative.split("/"));
  }

  async scan(): Promise<Map<string, string>> {
    const relatives = [PERSONALITY_FILE];
    let visited = 0;
    const walk = async (relativeDir: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(this.absolute(relativeDir), {
          withFileTypes: true,
        });
      } catch (error) {
        if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") {
          return;
        }
        throw error;
      }
      for (const entry of entries) {
        visited += 1;
        if (visited > MAX_WALK_ENTRIES) {
          throw new Error("memories/ holds more entries than sync handles.");
        }
        if (entry.name.startsWith(".")) continue;
        const relative = `${relativeDir}/${entry.name}`;
        if (entry.isDirectory()) await walk(relative);
        else if (entry.isFile() && isSyncedMemoryPath(relative)) {
          relatives.push(relative);
        }
      }
    };
    await walk(MEMORIES_DIR);
    if (relatives.length > MEMORY_LIST_MAX_FILES + 1) {
      throw new Error("memories/ holds more files than sync handles.");
    }
    const files = new Map<string, string>();
    for (const relative of relatives) {
      const sha = await this.sha(relative);
      if (sha !== null) files.set(relative, sha);
    }
    for (const relative of this.hashes.keys()) {
      if (!files.has(relative)) this.hashes.delete(relative);
    }
    return files;
  }

  private async sha(relative: string): Promise<string | null> {
    const file = this.absolute(relative);
    const stat = await fs.stat(file).catch(() => null);
    if (!stat?.isFile()) return null;
    const cached = this.hashes.get(relative);
    if (
      cached &&
      cached.mtimeMs === stat.mtimeMs &&
      cached.size === stat.size &&
      cached.ino === stat.ino
    ) {
      return cached.sha;
    }
    const bytes = await this.read(relative);
    if (bytes === null) return null;
    const sha = sha256Hex(bytes);
    this.hashes.set(relative, {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      ino: stat.ino,
      sha,
    });
    return sha;
  }

  async read(relative: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await fs.readFile(this.absolute(relative)));
    } catch (error) {
      if (errorCode(error) === "ENOENT" || errorCode(error) === "EISDIR") {
        return null;
      }
      throw error;
    }
  }

  private async currentSha(relative: string): Promise<string | null> {
    const bytes = await this.read(relative);
    return bytes === null ? null : sha256Hex(bytes);
  }

  private sibling(relative: string, suffix: string): string {
    const file = this.absolute(relative);
    return path.join(
      path.dirname(file),
      `.${path.basename(file)}.${randomUUID()}.${suffix}`,
    );
  }

  private async release(
    relative: string,
    held: string,
    expectSha: string,
  ): Promise<boolean> {
    const bytes = await fs.readFile(held).then(
      (buffer) => new Uint8Array(buffer),
      () => null,
    );
    const displaced = bytes !== null && sha256Hex(bytes) !== expectSha;
    if (displaced) await this.preserve(relative, bytes);
    await fs.rm(held, { force: true });
    return displaced;
  }

  /** Put `bytes` at `relative` if its sha is `expectSha` (`null`: absent). */
  async write(
    relative: string,
    bytes: Uint8Array,
    expectSha: string | null,
  ): Promise<LocalMutation> {
    if ((await this.currentSha(relative)) !== expectSha) {
      return { status: "moved" };
    }
    const file = this.absolute(relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const mode =
      expectSha === null
        ? 0o644
        : ((await fs.stat(file).catch(() => null))?.mode ?? 0o644) & 0o777;
    const temporary = this.sibling(relative, "tmp");
    try {
      await fs.writeFile(temporary, bytes, { mode });
      if (expectSha === null) {
        try {
          await fs.link(temporary, file);
        } catch (error) {
          if (errorCode(error) === "EEXIST") return { status: "moved" };
          throw error;
        }
        this.hashes.delete(relative);
        return { status: "done" };
      }
      const held = this.sibling(relative, "replaced");
      try {
        await fs.link(file, held);
      } catch (error) {
        if (errorCode(error) === "ENOENT") return { status: "moved" };
        throw error;
      }
      try {
        await fs.rename(temporary, file);
      } catch (error) {
        await fs.rm(held, { force: true }).catch(() => undefined);
        throw error;
      }
      this.hashes.delete(relative);
      return (await this.release(relative, held, expectSha))
        ? { status: "displaced" }
        : { status: "done" };
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  /** Delete `relative` if its sha is `expectSha`; done when it is gone. */
  async remove(relative: string, expectSha: string): Promise<LocalMutation> {
    const current = await this.currentSha(relative);
    if (current === null) return { status: "done" };
    if (current !== expectSha) return { status: "moved" };
    const file = this.absolute(relative);
    const held = this.sibling(relative, "deleting");
    try {
      await fs.rename(file, held);
    } catch (error) {
      if (errorCode(error) === "ENOENT") return { status: "done" };
      throw error;
    }
    this.hashes.delete(relative);
    const moved = await fs.readFile(held).then(
      (buffer) => sha256Hex(new Uint8Array(buffer)) !== expectSha,
      () => false,
    );
    if (!moved) {
      await fs.rm(held, { force: true });
      return { status: "done" };
    }
    try {
      await fs.link(held, file);
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      await this.release(relative, held, expectSha);
      return { status: "displaced" };
    }
    await fs.rm(held, { force: true });
    return { status: "moved" };
  }
}
