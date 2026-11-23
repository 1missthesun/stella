export {
  handleExecCommand,
  handleShellStatus,
  handleWriteStdin,
} from "./shell/handlers.js";
export {
  buildAgentShellEnvironment,
  resolveToolProcessIdentity,
} from "./shell/launch.js";
export {
  COMPLETED_SHELL_TTL_MS,
  claimShellExit,
  cleanupShellSessions,
  createShellState,
  listRunningTaskShells,
  listUntoldTaskShells,
  type RunningTaskShell,
  type UntoldTaskShell,
  releaseShellExit,
  shutdownManagedShells,
  waitForShellExit,
  watchShellExit,
  type ShellExitSnapshot,
  type ShellState,
} from "./shell/sessions.js";
