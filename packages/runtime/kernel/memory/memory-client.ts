import { redactMemoryText } from "./redaction.js";
import { residentMemoryChars } from "./resident-doc-shape.js";
import {
  MAIN_MEMORY_INJECTED_MAX_CHARS,
  MAIN_MEMORY_RELATIVE_PATH,
  MEMORIES_DIR,
  mainMemoryCapNote,
  PERSONALITY_FILE,
} from "./memory-layout.js";

export const MEMORY_FILE_MAX_CHARS = 32_000;
export const MEMORY_LIST_MAX_FILES = 500;

const MAX_PATH_CHARS = 240;
const MAX_SEGMENT_CHARS = 96;
const MAX_SEGMENTS = 8;
const SHA_PREFIX_HEX = /^[0-9a-f]{12,64}$/u;
export const MEMORY_SHA_CHARS = 12;

export type MemoryFileInfo = {
  path: string;
  size: number;
  sha: string;
  updatedAt: number;
};

export type MemoryWriteResult = { sha: string; bytes: number; note?: string };

export type MemoryReadResult = { text: string; sha: string };

export type MemoryListEntry = {
  path: string;
  size: number;
  sha: string;
  updatedAt: string;
};

export type MemoryFileStore = {
  read(path: string): Promise<Uint8Array | null>;
  write(
    path: string,
    bytes: Uint8Array,
    sha: string,
    expectSha: string | null | undefined,
  ): Promise<{ ok: true } | { ok: false; actualSha: string | null }>;
  list(): Promise<MemoryFileInfo[]>;
};

export type MemoryClient = {
  read(path: unknown): Promise<MemoryReadResult | null>;
  write(
    path: unknown,
    content: unknown,
    options?: unknown,
  ): Promise<MemoryWriteResult>;
  list(): Promise<MemoryListEntry[]>;
};

const visibleSha = (sha: string): string => sha.slice(0, MEMORY_SHA_CHARS);

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const codePoints = (text: string): number => Array.from(text).length;

export const memorySha = async (bytes: Uint8Array): Promise<string> => {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>),
  );
  let hex = "";
  for (const byte of digest) hex += byte.toString(16).padStart(2, "0");
  return hex;
};

const pathError = (op: string, input: unknown, reason: string): Error =>
  new Error(
    `memory.${op}: ${JSON.stringify(typeof input === "string" ? input : String(input))} ${reason}. Memory paths are relative to ~/.stella: a Markdown file under "memories/", such as "memories/main.md" or "memories/areas/finance.md".`,
  );

export const memoryPath = (input: unknown, op = "read"): string => {
  if (typeof input !== "string" || input.length === 0) {
    throw pathError(op, input, "is not a path");
  }
  if (input.startsWith("~/.stella/")) {
    throw new Error(
      `memory.${op}: pass ${JSON.stringify(input.slice("~/.stella/".length))}, not ${JSON.stringify(input)}; memory paths are relative to ~/.stella.`,
    );
  }
  if (input.startsWith("/") || input.startsWith("~")) {
    throw pathError(op, input, "is absolute");
  }
  if (
    input.length > MAX_PATH_CHARS ||
    input.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(input)
  ) {
    throw pathError(op, input, "is not a valid path");
  }
  const segments = input.split("/");
  if (
    segments.length > MAX_SEGMENTS ||
    segments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        segment.startsWith(".") ||
        segment.length > MAX_SEGMENT_CHARS,
    )
  ) {
    throw pathError(op, input, "is not a valid path");
  }
  if (segments[0] !== MEMORIES_DIR || segments.length < 2) {
    throw pathError(op, input, "is not a memory file");
  }
  if (!input.endsWith(".md")) {
    throw pathError(op, input, "is not a Markdown (.md) file");
  }
  return input;
};

export const isMemoryPath = (path: string): boolean => {
  try {
    memoryPath(path);
    return true;
  } catch {
    return false;
  }
};

export const isSyncedMemoryPath = (path: string): boolean =>
  path === PERSONALITY_FILE || isMemoryPath(path);

export const memoryFileMaxChars = (path: string): number => {
  if (path === MAIN_MEMORY_RELATIVE_PATH) return MAIN_MEMORY_INJECTED_MAX_CHARS;
  return MEMORY_FILE_MAX_CHARS;
};

const expectShaOption = (options: unknown): string | null | undefined => {
  if (options === undefined || options === null) return undefined;
  if (typeof options !== "object" || Array.isArray(options)) {
    throw new Error(
      "memory.write: options must be an object such as { expectSha }.",
    );
  }
  const expectSha = (options as { expectSha?: unknown }).expectSha;
  if (expectSha === undefined || expectSha === null) return expectSha;
  if (typeof expectSha !== "string" || !SHA_PREFIX_HEX.test(expectSha)) {
    throw new Error(
      "memory.write: expectSha must be a file's sha from memory.read(), memory.list() or an earlier memory.write(), or null for a file that must not exist yet.",
    );
  }
  return expectSha;
};

const shortSha = (sha: string | null): string =>
  sha ? visibleSha(sha) : "no file";

export const prepareMemoryWrite = async (
  path: string,
  content: string,
): Promise<{ bytes: Uint8Array; sha: string }> => {
  const text = redactMemoryText(content);
  const chars = codePoints(text);
  const maxChars = memoryFileMaxChars(path);
  if (path !== MAIN_MEMORY_RELATIVE_PATH && chars > maxChars) {
    throw new Error(
      `memory.write: ${path} would be ${chars.toLocaleString("en-US")} characters; its limit is ${maxChars.toLocaleString("en-US")}. Nothing was written. Curate it down (rewrite stale lines, or move area detail into its area file under memories/areas/) and write again.`,
    );
  }
  const bytes = encoder.encode(text);
  return { bytes, sha: await memorySha(bytes) };
};

export const createMemoryClient = (store: MemoryFileStore): MemoryClient => ({
  read: async (input) => {
    const path = memoryPath(input, "read");
    const bytes = await store.read(path);
    if (bytes === null) return null;
    return {
      text: decoder.decode(bytes),
      sha: visibleSha(await memorySha(bytes)),
    };
  },
  write: async (input, content, options) => {
    const path = memoryPath(input, "write");
    if (typeof content !== "string") {
      throw new Error(`memory.write: content for ${path} must be a string.`);
    }
    const expected = expectShaOption(options);
    const changed = (actualSha: string | null) =>
      new Error(
        `memory.write: ${path} changed since that sha was taken (expected ${shortSha(expected ?? null)}, found ${shortSha(actualSha)}). Nothing was written; read it again, reapply the edit, and write with the new sha.`,
      );
    let expectSha = expected;
    if (typeof expected === "string" && expected.length < 64) {
      const current = await store.read(path);
      const currentSha = current === null ? null : await memorySha(current);
      if (currentSha === null || !currentSha.startsWith(expected)) {
        throw changed(currentSha);
      }
      expectSha = currentSha;
    }
    const { bytes, sha } = await prepareMemoryWrite(path, content);
    const outcome = await store.write(path, bytes, sha, expectSha);
    if (!outcome.ok) throw changed(outcome.actualSha);
    const note =
      path === MAIN_MEMORY_RELATIVE_PATH
        ? mainMemoryCapNote(residentMemoryChars(decoder.decode(bytes)))
        : undefined;
    return {
      sha: visibleSha(sha),
      bytes: bytes.byteLength,
      ...(note ? { note } : {}),
    };
  },
  list: async () =>
    (await store.list())
      .filter((file) => isMemoryPath(file.path))
      .sort((left, right) =>
        left.path === MAIN_MEMORY_RELATIVE_PATH
          ? -1
          : right.path === MAIN_MEMORY_RELATIVE_PATH
            ? 1
            : left.path.localeCompare(right.path),
      )
      .slice(0, MEMORY_LIST_MAX_FILES)
      .map((file) => ({
        path: file.path,
        size: file.size,
        sha: visibleSha(file.sha),
        updatedAt: new Date(file.updatedAt).toISOString(),
      })),
});

export const runMemoryRequest = async (
  client: MemoryClient,
  input: unknown,
): Promise<unknown> => {
  const request =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  switch (request.op) {
    case "read":
      return await client.read(request.path);
    case "write":
      return await client.write(request.path, request.content, request.options);
    case "list":
      return await client.list();
    default:
      throw new Error(
        `memory.${String(request.op ?? "?")} is not a memory method; use memory.read, memory.write or memory.list.`,
      );
  }
};
