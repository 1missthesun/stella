import crypto from "crypto";
import fs from "fs";
import { promises as fsPromises } from "fs";
import path from "path";
import { writePrivateFile } from "../shared/private-fs.js";

const RESOLVED_MODELS_FILE = "claude-code-resolved-models.json";

/**
 * Model aliases the `claude` CLI accepts via `--model`
 * (https://code.claude.com/docs/en/model-config). Canonical list — the
 * session runtime derives its picker options from it, and stored keys
 * outside this set (full model ids) are bounded by a small LRU below.
 */
export const CLAUDE_CODE_MODEL_ALIASES = [
  "default",
  "best",
  "fable",
  "opus",
  "sonnet",
  "haiku",
  "opusplan",
  "sonnet[1m]",
  "opus[1m]",
] as const;

const ALIAS_KEYS: ReadonlySet<string> = new Set(CLAUDE_CODE_MODEL_ALIASES);

const MAX_NON_ALIAS_KEYS = 8;

const resolvedModelsPath = (stellaAppDir: string): string =>
  path.join(stellaAppDir, RESOLVED_MODELS_FILE);

const writeQueues = new Map<string, Promise<void>>();

const withFileQueue = (
  filePath: string,
  task: () => Promise<void>,
): Promise<void> => {
  const previous = writeQueues.get(filePath) ?? Promise.resolve();
  const next = previous.then(task, task);
  writeQueues.set(filePath, next);
  void next.finally(() => {
    if (writeQueues.get(filePath) === next) writeQueues.delete(filePath);
  });
  return next;
};

const writeFileAtomic = async (
  filePath: string,
  content: string,
): Promise<void> => {
  const tmpPath = `${filePath}.${process.pid}.${crypto
    .randomBytes(4)
    .toString("hex")}.tmp`;
  try {
    await writePrivateFile(tmpPath, content);
    await fsPromises.rename(tmpPath, filePath);
  } catch (error) {
    await fsPromises.rm(tmpPath, { force: true }).catch(() => undefined);
    throw error;
  }
};

export const readClaudeCodeResolvedModels = (
  stellaAppDir: string,
): Record<string, string> => {
  try {
    const raw = fs.readFileSync(resolvedModelsPath(stellaAppDir), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const next: Record<string, string> = {};
    for (const [requested, resolved] of Object.entries(parsed)) {
      if (typeof resolved === "string" && resolved.trim()) {
        next[requested] = resolved.trim();
      }
    }
    return next;
  } catch {
    return {};
  }
};

export const recordClaudeCodeResolvedModel = (
  stellaAppDir: string,
  requestedModel: string,
  resolvedModel: string,
): Promise<void> => {
  const requested = requestedModel.trim() || "default";
  const resolved = resolvedModel.trim();
  if (!resolved) return Promise.resolve();
  const filePath = resolvedModelsPath(stellaAppDir);
  return withFileQueue(filePath, async () => {
    try {
      const current = readClaudeCodeResolvedModels(stellaAppDir);
      if (current[requested] === resolved) return;
      delete current[requested];
      const entries = [...Object.entries(current), [requested, resolved]];
      const aliasEntries = entries.filter(([key]) => ALIAS_KEYS.has(key));
      const nonAliasEntries = entries.filter(([key]) => !ALIAS_KEYS.has(key));
      const bounded = [
        ...aliasEntries,
        ...nonAliasEntries.slice(-MAX_NON_ALIAS_KEYS),
      ];
      await writeFileAtomic(
        filePath,
        JSON.stringify(Object.fromEntries(bounded), null, 2),
      );
    } catch {
      // Resolved-model capture is best-effort; never fail a turn over it.
    }
  });
};

const CONTEXT_WINDOWS_FILE = "claude-code-context-windows.json";

const contextWindowsPath = (stellaAppDir: string): string =>
  path.join(stellaAppDir, CONTEXT_WINDOWS_FILE);

export const readClaudeCodeContextWindows = (
  stellaAppDir: string,
): Record<string, number> => {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(contextWindowsPath(stellaAppDir), "utf-8"),
    ) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === "number" && entry[1] > 0,
      ),
    );
  } catch {
    return {};
  }
};

export const recordClaudeCodeContextWindows = (
  stellaAppDir: string,
  modelUsage: unknown,
): Promise<void> => {
  if (!modelUsage || typeof modelUsage !== "object") return Promise.resolve();
  const reported = Object.entries(modelUsage).flatMap(
    ([model, usage]): [string, number][] => {
      const window = (usage as { contextWindow?: unknown } | null)
        ?.contextWindow;
      return typeof window === "number" && window > 0 ? [[model, window]] : [];
    },
  );
  if (reported.length === 0) return Promise.resolve();
  const filePath = contextWindowsPath(stellaAppDir);
  return withFileQueue(filePath, async () => {
    try {
      const current = readClaudeCodeContextWindows(stellaAppDir);
      if (reported.every(([model, window]) => current[model] === window)) {
        return;
      }
      for (const [model, window] of reported) {
        delete current[model];
        current[model] = window;
      }
      await writeFileAtomic(
        filePath,
        JSON.stringify(
          Object.fromEntries(Object.entries(current).slice(-32)),
          null,
          2,
        ),
      );
    } catch {
      // Context-window capture is best-effort; never fail a turn over it.
    }
  });
};

export const formatClaudeCodeResolvedModel = (modelId: string): string => {
  const trimmed = modelId.trim();
  const oneMillion = trimmed.endsWith("[1m]");
  const bare = oneMillion ? trimmed.slice(0, -"[1m]".length) : trimmed;
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d+))?(?:-\d{8})?$/.exec(bare);
  if (!match) return trimmed;
  const family = match[1].charAt(0).toUpperCase() + match[1].slice(1);
  const version = match[3] ? `${match[2]}.${match[3]}` : match[2];
  const label = `${family} ${version}`;
  return oneMillion ? `${label} (1M context)` : label;
};
