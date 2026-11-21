/**
 * Finding, installing, updating and repairing the Claude Code CLI. The app
 * keeps its Claude account logins and the update schedule; how to find,
 * install, update or repair the CLI is the runtime's, which runs it for turns.
 */
import { randomUUID } from "node:crypto";

import { createCancelableRegistry } from "./cancelable.js";

const installs = createCancelableRegistry();

export const selectClaudeCliForApp = async (
  request: { repair?: unknown } | null | undefined,
): Promise<{ ok: true; executable: string } | { ok: false; unusable: boolean; message: string }> => {
  const { selectClaudeCli, ClaudeCliUnusableError } = await import(
    "../../kernel/integrations/claude-cli-launch.js"
  );
  try {
    const repair = request?.repair;
    const launch = await selectClaudeCli(
      repair === "wait" || repair === "background" || repair === "none" ? { repair } : {},
    );
    return { ok: true, executable: launch.executable };
  } catch (error) {
    return {
      ok: false,
      unusable: error instanceof ClaudeCliUnusableError,
      message: error instanceof Error ? error.message : String(error),
    };
  }
};

export const installClaudeCliForApp = async (
  request: { installId?: unknown } | null | undefined,
  onProgress: (progress: unknown) => void,
) => {
  const installId =
    typeof request?.installId === "string" && request.installId
      ? request.installId
      : `install-${randomUUID()}`;
  const { installClaudeCli } = await import("../../kernel/integrations/claude-cli-install.js");
  return await installs.run(installId, (signal) => installClaudeCli({ signal, onProgress }));
};

export const cancelClaudeCliInstall = (request: { installId?: unknown } | null | undefined) => {
  const installId = typeof request?.installId === "string" ? request.installId : "";
  return { canceled: installs.cancel(installId, new Error("Claude Code install cancelled.")) };
};

/** One scheduled check: update or repair the CLI, and forget aliases a new version resolves differently. */
export const checkClaudeCliUpdate = async (
  stellaDataDir: string,
  request: { previousVersion?: unknown } | null | undefined,
) => {
  const { updateClaudeCli } = await import("../../kernel/integrations/claude-cli-update.js");
  let outcome: Awaited<ReturnType<typeof updateClaudeCli>>;
  try {
    outcome = await updateClaudeCli();
  } catch (error) {
    outcome = {
      status: "failed",
      version: null,
      output: error instanceof Error ? error.message : String(error),
    } as never;
  }
  const version = "version" in outcome ? outcome.version : null;
  const previous =
    typeof request?.previousVersion === "string" ? request.previousVersion : null;
  if (version && previous && version !== previous) {
    const { forgetClaudeCodeResolvedAliases } = await import(
      "../../kernel/integrations/claude-code-resolved-models.js"
    );
    await forgetClaudeCodeResolvedAliases(stellaDataDir);
  }
  return outcome;
};
