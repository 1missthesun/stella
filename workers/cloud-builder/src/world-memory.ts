/**
 * The owner's cloud memory: plain Markdown files in their world, laid out and
 * named exactly as the desktop keeps them under `~/.stella`.
 *
 *   /workspace/world/.stella/memories/main.md
 *   /workspace/world/.stella/memories/areas/<area>.md
 *   /workspace/world/.stella/memories/**.md
 *   /workspace/world/.stella/PERSONALITY.md
 *
 * They are ordinary world files: General agents edit them with their file
 * tools and shell, the orchestrator through `memory.*` inside `code`
 * (`createWorldMemory`, whose path rules, redaction and caps are the shared
 * ones in `memory-client.ts`), and the turn reads the resident ones fresh
 * every time (`AgentHome.readDocuments`). The world has no locks, so the last
 * write wins; `memory.write`'s `expectSha` is the one compare-and-set. A wipe
 * erases them with `erasePaths`, after which the world refuses any memory
 * write based on a revision from before it.
 *
 * Each of the owner's computers keeps its `~/.stella` copy the same as these
 * through `createWorldMemorySync` (the `memory.files.*` calls), which writes
 * and deletes only by compare-and-set, so a sync never loses a cloud edit.
 */

import {
  MEMORY_LIST_MAX_FILES,
  createMemoryClient,
  isSyncedMemoryPath,
  memorySha,
  prepareMemoryWrite,
  type MemoryClient,
  type MemoryFileInfo,
  type MemoryFileStore,
} from "@stella/runtime/kernel/memory/memory-client.js";
import {
  MEMORIES_DIR,
  PERSONALITY_FILE,
} from "@stella/runtime/kernel/memory/memory-layout.js";
import { releasingStub } from "./rpc-release.js";
import { worldName } from "./workspace.js";
import type { WorldEntry, WorldListingEntry } from "./world/types.js";

export const WORLD_STELLA_DIR = ".stella";
export const WORLD_PERSONALITY_FILE = PERSONALITY_FILE;

export type MemoryWorld = Readonly<{
  head(): Promise<{ revision: number }>;
  stat(path: string): Promise<WorldEntry | null>;
  list(
    prefix: string,
    options: { limit: number },
  ): Promise<{ entries: WorldEntry[]; cursor?: string }>;
  readFile(path: string): Promise<Uint8Array | null>;
  putBlob(
    stream: ReadableStream<Uint8Array>,
    input: { sha256: string; size: number },
  ): Promise<unknown>;
  commitShell(input: {
    baseRevision: number;
    reads: { paths: string[]; children: string[] };
    entries: WorldListingEntry[];
    deleted: string[];
  }): Promise<{ status: string }>;
  erasePaths(paths: readonly string[]): Promise<number>;
}>;

export const ownerMemoryWorld = async (
  worlds: Cloudflare.Env["WORLDS"],
  ownerId: string,
): Promise<MemoryWorld> => {
  // Every result is plain data, so each is released as it arrives. An
  // unreleased RPC result holds its call open until GC, and the owner object's
  // `memory.files.list` polls (about one a minute per desktop) kept it awake.
  const stub = releasingStub(worlds.getByName(await worldName(ownerId)));
  return {
    head: () => stub.head(),
    stat: (path) => stub.stat(path),
    list: (prefix, options) => stub.list(prefix, options),
    readFile: (path) => stub.readFile(path),
    putBlob: (stream, input) => stub.putBlob(stream, input),
    commitShell: (input) => stub.commitShell(input),
    erasePaths: (paths) => stub.erasePaths(paths),
  };
};

export const worldStellaPath = (relative: string): string =>
  `${WORLD_STELLA_DIR}/${relative}`;

const decoder = new TextDecoder();

export const readWorldStellaText = async (
  world: MemoryWorld,
  relative: string,
): Promise<string | null> => {
  const bytes = await world.readFile(worldStellaPath(relative));
  return bytes === null ? null : decoder.decode(bytes);
};

const COMMIT_ATTEMPTS = 3;

export type MemoryEpochFence = () => Promise<string>;

const ERASED_WHILE_WRITING =
  "memory: Stella's memory was erased while this was being written; nothing was written.";

const removeIfUnchanged = async (
  target: MemoryWorld,
  fence: MemoryEpochFence,
  path: string,
  expectSha: string,
): Promise<
  | { status: "deleted" | "missing" }
  | { status: "conflict"; actualSha: string | null }
  | { status: "busy" }
> => {
  for (let attempt = 0; attempt < COMMIT_ATTEMPTS; attempt += 1) {
    const { revision } = await target.head();
    await fence();
    const current = await target.stat(path);
    if (!current) return { status: "missing" };
    if (current.kind !== "file" || current.sha256 !== expectSha) {
      return { status: "conflict", actualSha: current.sha256 ?? null };
    }
    const committed = await target.commitShell({
      baseRevision: revision,
      reads: { paths: [path], children: [] },
      entries: [],
      deleted: [path],
    });
    if (committed.status === "committed") return { status: "deleted" };
  }
  return { status: "busy" };
};

const createWorldMemoryStore = (
  world: () => Promise<MemoryWorld>,
  fence?: MemoryEpochFence,
): MemoryFileStore => ({
  read: async (relative) => (await world()).readFile(worldStellaPath(relative)),
  write: async (relative, bytes, sha, expectSha) => {
    const store = await world();
    const path = worldStellaPath(relative);
    let epoch: string | undefined;
    for (let attempt = 0; attempt < COMMIT_ATTEMPTS; attempt += 1) {
      const { revision } = await store.head();
      if (fence) {
        const open = await fence();
        epoch ??= open;
        if (open !== epoch) throw new Error(ERASED_WHILE_WRITING);
      }
      const current = await store.stat(path);
      if (current && current.kind !== "file") {
        throw new Error(`memory: ${relative} is not a file.`);
      }
      const currentSha = current?.sha256 ?? null;
      if (expectSha !== undefined && currentSha !== expectSha) {
        return { ok: false, actualSha: currentSha };
      }
      if (currentSha === sha) return { ok: true };
      await store.putBlob(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }),
        { sha256: sha, size: bytes.byteLength },
      );
      const committed = await store.commitShell({
        baseRevision: revision,
        reads: { paths: [path], children: [] },
        entries: [
          {
            path,
            kind: "file",
            mode: current?.mode ?? 0o644,
            size: bytes.byteLength,
            sha256: sha,
          },
        ],
        deleted: [],
      });
      if (committed.status === "committed") return { ok: true };
      if (committed.status === "missing_blobs") {
        throw new Error(
          `memory: the workspace did not keep the content for ${relative}; nothing was written. Try again.`,
        );
      }
    }
    throw new Error(
      `memory: ${relative} kept changing while it was being written; nothing was written. Try again.`,
    );
  },
  list: async () => (await listWorldMemoryFiles(await world())).files,
});

const listWorldMemoryFiles = async (
  store: MemoryWorld,
): Promise<{ files: MemoryFileInfo[]; cutShort: boolean }> => {
  const [personality, nested] = await Promise.all([
    store.stat(worldStellaPath(PERSONALITY_FILE)),
    store.list(worldStellaPath(MEMORIES_DIR), {
      limit: MEMORY_LIST_MAX_FILES * 4,
    }),
  ]);
  return {
    files: [personality, ...nested.entries].flatMap((entry) =>
      entry?.kind === "file" && entry.sha256
        ? [
            {
              path: entry.path.slice(WORLD_STELLA_DIR.length + 1),
              size: entry.size,
              sha: entry.sha256,
              updatedAt: entry.mtime,
            },
          ]
        : [],
    ),
    cutShort: nested.cursor !== undefined,
  };
};

export const createWorldMemory = (
  world: () => Promise<MemoryWorld>,
  fence?: MemoryEpochFence,
): MemoryClient => createMemoryClient(createWorldMemoryStore(world, fence));

/**
 * Write `bytes` to a memory file only if it does not exist yet, as they are
 * (no caps: legacy content moving in). The sha written, or null when the
 * file was already there.
 */
export const createWorldMemoryFile = async (
  world: () => Promise<MemoryWorld>,
  fence: MemoryEpochFence,
  relative: string,
  bytes: Uint8Array,
): Promise<string | null> => {
  const sha = await memorySha(bytes);
  const outcome = await createWorldMemoryStore(world, fence).write(
    relative,
    bytes,
    sha,
    null,
  );
  return outcome.ok ? sha : null;
};

export const MEMORY_SYNC_READ_MAX_BYTES = 512 * 1024;

export class MemorySyncFileError extends Error {}

const syncedPath = (path: string): string => {
  if (!isSyncedMemoryPath(path)) {
    throw new MemorySyncFileError(
      `${JSON.stringify(path)} is not a memory file.`,
    );
  }
  return path;
};

export const createWorldMemorySync = (
  world: () => Promise<MemoryWorld>,
  fence: MemoryEpochFence,
) => {
  const store = createWorldMemoryStore(world, fence);
  return {
    list: async (): Promise<MemoryFileInfo[]> => {
      const { files, cutShort } = await listWorldMemoryFiles(await world());
      if (cutShort) {
        throw new MemorySyncFileError(
          "Cloud memory holds more files than sync handles.",
        );
      }
      return files.filter((file) => isSyncedMemoryPath(file.path));
    },
    read: async (
      input: string,
    ): Promise<{ content: string; sha: string } | null> => {
      const path = syncedPath(input);
      const entry = await (await world()).stat(worldStellaPath(path));
      if (!entry || entry.kind !== "file") return null;
      if (entry.size > MEMORY_SYNC_READ_MAX_BYTES) {
        throw new MemorySyncFileError(`${path} is too large to sync.`);
      }
      const bytes = await store.read(path);
      if (bytes === null) return null;
      return { content: decoder.decode(bytes), sha: await memorySha(bytes) };
    },
    write: async (
      input: string,
      content: string,
      expectSha: string | null,
    ): Promise<
      | { status: "written"; sha: string; bytes: number }
      | { status: "conflict"; actualSha: string | null }
    > => {
      const path = syncedPath(input);
      let prepared: { bytes: Uint8Array; sha: string };
      try {
        prepared = await prepareMemoryWrite(path, content);
      } catch (error) {
        throw new MemorySyncFileError(
          error instanceof Error ? error.message : String(error),
        );
      }
      const outcome = await store.write(
        path,
        prepared.bytes,
        prepared.sha,
        expectSha,
      );
      return outcome.ok
        ? {
            status: "written",
            sha: prepared.sha,
            bytes: prepared.bytes.byteLength,
          }
        : { status: "conflict", actualSha: outcome.actualSha };
    },
    remove: async (
      input: string,
      expectSha: string,
    ): Promise<
      | { status: "deleted" | "missing" }
      | { status: "conflict"; actualSha: string | null }
    > => {
      const relative = syncedPath(input);
      const outcome = await removeIfUnchanged(
        await world(),
        fence,
        worldStellaPath(relative),
        expectSha,
      );
      if (outcome.status !== "busy") return outcome;
      throw new Error(
        `memory: ${relative} kept changing while it was being deleted; nothing was deleted. Try again.`,
      );
    },
  };
};

export const WORLD_MEMORY_WIPE_PATHS: readonly string[] = [
  worldStellaPath(MEMORIES_DIR),
  worldStellaPath(WORLD_PERSONALITY_FILE),
];

export const wipeWorldMemory = (world: MemoryWorld): Promise<number> =>
  world.erasePaths(WORLD_MEMORY_WIPE_PATHS);
