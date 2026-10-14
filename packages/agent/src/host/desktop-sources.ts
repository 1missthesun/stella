import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createExecutionContextSnapshot,
  type ExecutionContextSnapshot,
  type ExecutionDestination,
  type MediaAccess,
} from "@stella/contracts/execution-context";
import { STELLA_PROMPTS_PATH } from "@stella/contracts/stella-api";
import { readOrSeedPersonality } from "@stella/runtime/kernel/personality/personality";
import { renderSkillCatalogBlock } from "@stella/runtime/kernel/shared/skill-catalog";
import type { StellaAgentPromptId, StellaContextSources, StellaMemory } from "../stella/context.ts";

const BUNDLED_PROMPTS = fileURLToPath(new URL("../../../runtime/extensions/stella-runtime/", import.meta.url));

const bundledPath = (id: StellaAgentPromptId): string =>
  path.join(BUNDLED_PROMPTS, "agent-metadata", id.replace(/^agents\//, ""));

const readOptional = async (file: string): Promise<string | undefined> => {
  try {
    const text = await readFile(file, "utf8");
    return text.trim() === "" ? undefined : text;
  } catch {
    return undefined;
  }
};

type ServedPrompts = { revision: string; prompts: Map<string, string>; checkedAt: number };

const SERVED_PROMPTS_MAX_AGE_MS = 5 * 60_000;

function servedPrompts(backendUrl: string | undefined) {
  let current: ServedPrompts | undefined;
  let pending: Promise<void> | undefined;
  const refresh = async () => {
    if (!backendUrl) return;
    try {
      const response = await fetch(`${backendUrl.replace(/\/+$/, "")}${STELLA_PROMPTS_PATH}`, {
        headers: current ? { "if-none-match": `"${current.revision}"` } : {},
        signal: AbortSignal.timeout(5_000),
      });
      if (response.status === 304 && current) {
        current = { ...current, checkedAt: Date.now() };
        return;
      }
      if (!response.ok) return;
      const body = (await response.json()) as { revision: string; prompts: { id: string; content: string }[] };
      current = {
        revision: body.revision,
        prompts: new Map(body.prompts.map((prompt) => [prompt.id, prompt.content])),
        checkedAt: Date.now(),
      };
    } catch {
      // Offline: the bundled prompt, or the last bundle, serves until the next refresh.
    }
  };
  const start = () => (pending ??= refresh().finally(() => (pending = undefined)));
  return async (id: string): Promise<string | undefined> => {
    if (current === undefined) await start();
    else if (Date.now() - current.checkedAt > SERVED_PROMPTS_MAX_AGE_MS) void start();
    return current?.prompts.get(id);
  };
}

export type DesktopSourcesOptions = {
  stellaHome: string;
  backendUrl?: string;
  memoryEnabled?: () => boolean;
  destination: ExecutionDestination;
  media?: () => MediaAccess | undefined;
  locale?: () => Promise<string | undefined>;
  cloudStored?: boolean;
  executionContext?: () => Promise<ExecutionContextSnapshot | undefined>;
};

export function desktopContextSources(options: DesktopSourcesOptions): StellaContextSources {
  const served = servedPrompts(options.backendUrl);
  return {
    env: "desktop",
    agentPrompt: async (id) => (await served(id)) ?? (await readOptional(bundledPath(id))),
    personality: async () => readOrSeedPersonality(options.stellaHome) || undefined,
    memory: async (): Promise<StellaMemory> => {
      if (options.memoryEnabled?.() === false) return { enabled: false };
      const main = await readOptional(path.join(options.stellaHome, "memories", "main.md"));
      return { enabled: true, ...(main ? { main } : {}) };
    },
    skillsCatalog: async () => renderSkillCatalogBlock(options.stellaHome),
    executionContext: async () => {
      const loaded = await options.executionContext?.();
      return createExecutionContextSnapshot({
        devices: loaded?.devicesKnown ? loaded.devices : null,
        destination: options.destination,
        media: loaded?.media ?? options.media?.(),
      });
    },
    locale: async () => options.locale?.(),
    codeHistory: async (agentType) => agentType !== "orchestrator" || options.cloudStored === true,
  };
}
