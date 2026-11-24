let quitting = false;

export const markClaudeCodeQuitting = (): void => {
  quitting = true;
};

export const claudeCodeQuitting = (): boolean => quitting;
