/**
 * The desktop's prompt material: the served prompt bundle, and the user's
 * personality, memory and skills under the Stella home (`~/.stella`).
 */
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

/** How long a fetched bundle serves before the next request revalidates it in the background. */
const SERVED_PROMPTS_MAX_AGE_MS = 5 * 60_000;

/**
 * The backend's prompt bundle. The first request waits for it; afterwards a
 * request finding it older than `SERVED_PROMPTS_MAX_AGE_MS` uses it as is and
 * revalidates it in the background (`If-None-Match`), so a prompt the backend
 * publishes reaches a long-open conversation within minutes, not at the next
 * restart.
 */
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
  /** The Stella home, `~/.stella` in the installed app. */
  stellaHome: string;
  backendUrl?: string;
  memoryEnabled?: () => boolean;
  /** This device, where a desktop conversation runs. */
  destination: ExecutionDestination;
  media?: () => MediaAccess | undefined;
  /** The response language the user's latest message asked for. */
  locale?: () => Promise<string | undefined>;
  /** The conversation is stored in the cloud, whose journal `history` reads. */
  cloudStored?: boolean;
  /** The owner's devices and media access; its destination is ignored for `destination`. */
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
    // Stella reads a conversation stored in the cloud; an agent reads its own thread, which is here.
    codeHistory: async (agentType) => agentType !== "orchestrator" || options.cloudStored === true,
  };
}
