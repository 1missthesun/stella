import type { CloudExecutionSelection } from "@stella/contracts/agent-engine";
import {
  REASONING_EFFORT_LEVELS,
  normalizeReasoningEffortLevel,
} from "@stella/contracts/reasoning-effort";
import type { AutomaticExecutionTarget } from "./execution-placement-core";

export const usesCloudModelSettings = (
  target: AutomaticExecutionTarget,
  paired: boolean,
): boolean => target.mode === "cloud" || !paired;

export const managedCloudModelSelection = (
  model: string,
  previous: CloudExecutionSelection,
): CloudExecutionSelection => ({
  engine: "stella",
  provider: "stella",
  model,
  reasoningEffort: previous.reasoningEffort,
});

/** Do not issue a request after token resolution crosses an account boundary. */
export async function runOwnerBoundModelRequest<T>(args: {
  getToken: () => Promise<string>;
  isCurrent: () => boolean;
  request: (token: string) => Promise<T>;
}): Promise<T | undefined> {
  const token = await args.getToken();
  if (!args.isCurrent()) return undefined;
  const result = await args.request(token);
  return args.isCurrent() ? result : undefined;
}

/** Read the optional persisted route without promoting corrupt outbox data. */
export function parseCloudModelSelection(value: unknown): CloudExecutionSelection | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const model = typeof row.model === "string" ? row.model.trim() : "";
  const efforts: readonly unknown[] = ["none", ...REASONING_EFFORT_LEVELS, "default", "minimal"];
  if (!model || !efforts.includes(row.reasoningEffort)) return undefined;
  const reasoningEffort: CloudExecutionSelection["reasoningEffort"] =
    row.reasoningEffort === "none" ? "none" : normalizeReasoningEffortLevel(row.reasoningEffort);
  if (row.engine === "provider") {
    const provider = typeof row.provider === "string" ? row.provider.trim() : "";
    return provider ? { engine: "provider", provider, model, reasoningEffort } : undefined;
  }
  if (row.engine !== row.provider) return undefined;
  switch (row.engine) {
    case "stella": return { engine: "stella", provider: "stella", model, reasoningEffort };
    case "anthropic": return { engine: "anthropic", provider: "anthropic", model, reasoningEffort };
    case "chatgpt": return { engine: "chatgpt", provider: "chatgpt", model, reasoningEffort };
    default: return undefined;
  }
}
