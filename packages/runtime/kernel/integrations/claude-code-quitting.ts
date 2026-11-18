/**
 * Stella is quitting: the background work of the Claude Code processes it ends
 * is told after the next start, not now. Kept apart from the Claude Code engine
 * so that marking it at quit never loads the engine into the worker's boot.
 */
let quitting = false;

export const markClaudeCodeQuitting = (): void => {
  quitting = true;
};

export const claudeCodeQuitting = (): boolean => quitting;
