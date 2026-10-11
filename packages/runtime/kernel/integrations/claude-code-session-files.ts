import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CLAUDE_SESSION_MAX_FILES,
  claudeProjectSlot,
  isClaudeSessionFilePath,
} from "@stella/contracts/backend/claude-sessions";
import { resolveExternalCliPath } from "./external-cli-resolution.js";

const MAX_SIDECAR_DEPTH = 4;
const REPLY_HASH_LIMIT = 400;

export const claudeConfigRoot = (configDir: string | null | undefined): string =>
  configDir?.trim() ||
  process.env.CLAUDE_CONFIG_DIR?.trim() ||
  path.join(os.homedir(), ".claude");

export const resolveClaudeWorkingFolder = async (cwd: string): Promise<string> => {
  const absolute = path.resolve(cwd);
  try {
    return await fs.realpath(absolute);
  } catch {
    return absolute;
  }
};

export const claudeSessionProjectDir = (
  configDir: string | null | undefined,
  workingFolder: string,
): string =>
  path.join(claudeConfigRoot(configDir), "projects", claudeProjectSlot(workingFolder));

export const claudeSessionFileAbsolutePath = (
  projectDir: string,
  relativePath: string,
): string => path.join(projectDir, ...relativePath.split("/"));

const walkSidecar = async (
  root: string,
  relative: string,
  depth: number,
  out: string[],
): Promise<void> => {
  if (depth > MAX_SIDECAR_DEPTH || out.length >= CLAUDE_SESSION_MAX_FILES) return;
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(path.join(root, ...relative.split("/")), {
      withFileTypes: true,
    });
  } catch {
    return;
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (out.length >= CLAUDE_SESSION_MAX_FILES) return;
    const child = `${relative}/${entry.name}`;
    if (entry.isDirectory()) {
      await walkSidecar(root, child, depth + 1, out);
    } else if (entry.isFile()) {
      out.push(child);
    }
  }
};

export const listClaudeSessionFiles = async (
  projectDir: string,
  sessionId: string,
): Promise<string[]> => {
  const sidecar: string[] = [];
  await walkSidecar(projectDir, sessionId, 1, sidecar);
  const main = `${sessionId}.jsonl`;
  let hasMain = false;
  try {
    hasMain = (await fs.lstat(path.join(projectDir, main))).isFile();
  } catch {
    hasMain = false;
  }
  return [
    ...sidecar.filter((entry) => isClaudeSessionFilePath(sessionId, entry)),
    ...(hasMain ? [main] : []),
  ];
};

let cachedCliVersion: Promise<string> | null = null;

export const claudeCliVersion = (): Promise<string> => {
  cachedCliVersion ??= new Promise<string>((resolve) => {
    let executable: string;
    try {
      executable = resolveExternalCliPath("claude");
    } catch {
      resolve("unknown");
      return;
    }
    execFile(executable, ["--version"], { timeout: 15_000 }, (error, stdout) => {
      const match = /\d+\.\d+\.\d+/.exec(String(stdout ?? ""));
      resolve(!error && match ? match[0] : "unknown");
    });
  });
  return cachedCliVersion;
};

export const compareClaudeCliVersions = (left: string, right: string): number => {
  const parse = (value: string) =>
    (/^(\d+)\.(\d+)\.(\d+)/.exec(value) ?? []).slice(1, 4).map(Number);
  const a = parse(left);
  const b = parse(right);
  if (a.length !== 3 || b.length !== 3) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (a[index]! !== b[index]!) return a[index]! - b[index]!;
  }
  return 0;
};

export const claudeCliCanResume = (local: string, origin: string): boolean => {
  if (local === "unknown" || origin === "unknown") return true;
  if (compareClaudeCliVersions(local, origin) >= 0) return true;
  const minor = (value: string) => /^(\d+)\.(\d+)\./.exec(value)?.slice(1, 3).join(".");
  return minor(local) !== undefined && minor(local) === minor(origin);
};

export const hashClaudeReplyText = (text: string): string =>
  crypto.createHash("sha256").update(text.trim()).digest("hex");

type SessionLine = Record<string, unknown>;

const parseLine = (line: string): SessionLine | null => {
  try {
    const value = JSON.parse(line) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as SessionLine)
      : null;
  } catch {
    return null;
  }
};

const messageOf = (entry: SessionLine): Record<string, unknown> | null => {
  const message = entry.message;
  return message && typeof message === "object" && !Array.isArray(message)
    ? (message as Record<string, unknown>)
    : null;
};

export const claudeSessionReplyHashes = (jsonl: string): string[] => {
  const byMessage = new Map<string, string[]>();
  const order: string[] = [];
  const hashes: string[] = [];
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    const entry = parseLine(line);
    if (!entry || entry.type !== "assistant" || entry.isSidechain === true) continue;
    const message = messageOf(entry);
    const content = message?.content;
    const texts = Array.isArray(content)
      ? content.flatMap((block) =>
          block &&
          typeof block === "object" &&
          (block as Record<string, unknown>).type === "text" &&
          typeof (block as Record<string, unknown>).text === "string"
            ? [String((block as Record<string, unknown>).text)]
            : [],
        )
      : typeof content === "string"
        ? [content]
        : [];
    if (texts.length === 0) continue;
    const id = typeof message?.id === "string" ? message.id : `line:${order.length}`;
    if (!byMessage.has(id)) {
      byMessage.set(id, []);
      order.push(id);
    }
    byMessage.get(id)!.push(...texts);
    for (const text of texts) {
      if (text.trim()) hashes.push(hashClaudeReplyText(text));
    }
  }
  for (const id of order) {
    const texts = byMessage.get(id) ?? [];
    if (texts.length > 1) {
      hashes.push(hashClaudeReplyText(texts.join("\n\n")));
      hashes.push(hashClaudeReplyText(texts.join("")));
    }
  }
  return [...new Set(hashes)].slice(-REPLY_HASH_LIMIT);
};

const THINKING_BLOCK_TYPES = new Set(["thinking", "redacted_thinking"]);

export const stripClaudeThinkingBlocks = (
  jsonl: string,
): { text: string; removedBlocks: number } => {
  const lines = jsonl.split("\n");
  const trailingNewline = jsonl.endsWith("\n");
  const kept: string[] = [];
  const dropped = new Map<string, string | null>();
  let removedBlocks = 0;
  const entries = lines.map((line) => (line.trim() ? parseLine(line) : null));
  entries.forEach((entry, index) => {
    const line = lines[index]!;
    if (!entry) {
      if (line.trim()) kept.push(line);
      return;
    }
    const message = messageOf(entry);
    const content = message?.content;
    if (entry.type !== "assistant" || !Array.isArray(content)) {
      kept.push(line);
      return;
    }
    const filtered = content.filter(
      (block) =>
        !(
          block &&
          typeof block === "object" &&
          THINKING_BLOCK_TYPES.has(String((block as Record<string, unknown>).type))
        ),
    );
    removedBlocks += content.length - filtered.length;
    if (filtered.length === content.length) {
      kept.push(line);
      return;
    }
    if (filtered.length === 0 && typeof entry.uuid === "string") {
      dropped.set(
        entry.uuid,
        typeof entry.parentUuid === "string" ? entry.parentUuid : null,
      );
      kept.push("");
      return;
    }
    kept.push(JSON.stringify({ ...entry, message: { ...message, content: filtered } }));
  });
  const resolveParent = (uuid: string | null): string | null => {
    let current = uuid;
    const seen = new Set<string>();
    while (current && dropped.has(current) && !seen.has(current)) {
      seen.add(current);
      current = dropped.get(current) ?? null;
    }
    return current;
  };
  const relinked = kept
    .filter((line) => line.length > 0)
    .map((line) => {
      if (dropped.size === 0) return line;
      const entry = parseLine(line);
      if (!entry || typeof entry.parentUuid !== "string" || !dropped.has(entry.parentUuid)) {
        return line;
      }
      return JSON.stringify({ ...entry, parentUuid: resolveParent(entry.parentUuid) });
    });
  return {
    text: relinked.join("\n") + (trailingNewline && relinked.length > 0 ? "\n" : ""),
    removedBlocks,
  };
};

export const writeFileAtomically = async (
  target: string,
  data: Uint8Array | string,
): Promise<void> => {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, data, { mode: 0o600 });
  await fs.rename(temporary, target);
};

export const stripClaudeThinkingFromSessionFile = async (
  file: string,
): Promise<number> => {
  let original: string;
  try {
    original = await fs.readFile(file, "utf8");
  } catch {
    return 0;
  }
  const stripped = stripClaudeThinkingBlocks(original);
  if (stripped.removedBlocks === 0) return 0;
  await writeFileAtomically(file, stripped.text);
  return stripped.removedBlocks;
};
