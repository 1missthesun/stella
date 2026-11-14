// Every signal the harness sends from a stored pid goes through here: the
// pid must still be the process recorded (start time, or a command-line tag
// for records from before start times were kept), and every signal sent or
// refused is appended to the process-kill log (`~/.stella/logs/process-kills.log`
// or STELLA_PROCESS_KILL_LOG) with the target's command and the reason.
import { setTimeout as delay } from "node:timers/promises";
import {
  logProcessSignal,
  pidIsAlive,
  readProcessCommand,
  readProcessGroup,
  readProcessIdentity,
  recordProcess,
  signalRecordedProcess,
} from "../../../../packages/runtime/kernel/shared/process-identity.ts";

export { logProcessSignal, pidIsAlive, readProcessCommand, readProcessIdentity, recordProcess, signalRecordedProcess };

/**
 * SIGTERM, then SIGKILL after `termMs`, to a recorded process (its whole
 * group while it leads one). Stops at the first refusal; returns the last
 * outcome ("sent", "gone", "mismatch", "unverifiable" or "failed").
 */
export const stopRecordedProcess = async (recorded, { reason, termMs = 4_000, killMs = 2_000 }) => {
  if (!recorded?.pid || !pidIsAlive(recorded.pid)) return "gone";
  const group = process.platform !== "win32" && readProcessGroup(recorded.pid) === recorded.pid;
  for (const [signal, waitMs] of [["SIGTERM", termMs], ["SIGKILL", killMs]]) {
    const outcome = signalRecordedProcess(recorded, signal, { reason, group });
    if (outcome !== "sent") return outcome;
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline && pidIsAlive(recorded.pid)) await delay(100);
    if (!pidIsAlive(recorded.pid)) return "sent";
  }
  return "sent";
};
