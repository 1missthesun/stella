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
  cleanupShellSessions,
  createShellState,
  listRunningShellSessionsOwnedBy,
  readShellExitSnapshot,
  shutdownManagedShells,
  waitForShellExit,
  watchShellExit,
  type ShellExitSnapshot,
  type ShellSessionAccess,
  type ShellState,
} from "./shell/sessions.js";
