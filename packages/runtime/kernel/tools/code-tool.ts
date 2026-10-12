/** The only JavaScript orchestration tool name advertised to new turns. */
export const CODE_TOOL_NAME = "code" as const;

/**
 * Historical transcripts may still contain this name. It is data-compatibility
 * only: the tool catalog must never advertise it again.
 */
export const LEGACY_NODE_REPL_TOOL_NAME = "node_repl" as const;

/**
 * Conservatively decide whether a source-provided approval policy requires an
 * explicit, top-level approval flow. Unknown policy shapes fail closed.
 */
export const toolRequiresExplicitApproval = (approval: unknown): boolean => {
  if (approval === undefined || approval === null || approval === false) {
    return false;
  }
  if (approval === true) return true;
  if (typeof approval === "string") {
    const normalized = approval.trim().toLowerCase();
    return normalized !== "" && normalized !== "none" && normalized !== "never";
  }
  if (typeof approval === "object" && !Array.isArray(approval)) {
    const required = (approval as { required?: unknown }).required;
    return required !== false;
  }
  return true;
};

