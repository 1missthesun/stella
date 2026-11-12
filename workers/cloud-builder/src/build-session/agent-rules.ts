import { standingRulesSection } from "@stella/agent/stella/standing-rules";
import { RULES_MEMORY_RELATIVE_PATH } from "@stella/runtime/kernel/memory/memory-layout.js";
import { ownerGateStub } from "../rpc-release.js";
import { ownerMemoryWorld, readWorldStellaText } from "../world-memory.js";
import type { TurnRequest } from "./shared/types.js";

/** The owner's standing rules for a cloud Claude Code agent's prompt; none while memory is off. */
export const agentRulesSection = async (
  env: Pick<Cloudflare.Env, "OWNER_GATES" | "WORLDS">,
  turn: Pick<TurnRequest, "ownerId" | "ownerGeneration" | "ownerPurgeGeneration">,
): Promise<string | undefined> => {
  if (!turn.ownerPurgeGeneration) return undefined;
  try {
    const { memory } = await ownerGateStub(env.OWNER_GATES, turn.ownerId).homeContext(
      turn.ownerGeneration,
      turn.ownerPurgeGeneration,
    );
    if (!memory.preference.memoryEnabled) return undefined;
    return standingRulesSection(
      await readWorldStellaText(await ownerMemoryWorld(env.WORLDS, turn.ownerId), RULES_MEMORY_RELATIVE_PATH),
    );
  } catch {
    return undefined;
  }
};
