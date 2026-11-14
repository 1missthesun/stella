import type { DeviceDestination } from "./turn-plane/placement.js";

/** Why a task that hasn't ended runs nothing now; it carries on by itself once this clears. */
export type AgentPause =
  | { reason: "computer-off"; computer?: string }
  | { reason: "usage-limit" }
  | { reason: "sign-in" };

export type LocalAgentPause = Exclude<AgentPause["reason"], "computer-off">;

export const localAgentPause = (reason: LocalAgentPause | undefined): AgentPause | undefined =>
  reason ? { reason } : undefined;

/**
 * A cloud-ledger thread's pause: a usage-limit hold, or a run on a computer
 * that is off. A device the list doesn't know (replaced by a reinstall) is
 * not read as off.
 */
export const agentThreadPause = (
  thread: { status: string; placement: string; runsOnDeviceId?: string; executorDeviceId?: string },
  devices: readonly Pick<DeviceDestination, "deviceId" | "label" | "online">[] | undefined,
): AgentPause | undefined => {
  if (thread.status === "waiting_for_user") return { reason: "usage-limit" };
  const deviceId = thread.runsOnDeviceId ?? thread.executorDeviceId;
  if (thread.status !== "running" || thread.placement !== "computer" || !deviceId) return undefined;
  const device = devices?.find((candidate) => candidate.deviceId === deviceId);
  if (!device || device.online) return undefined;
  const computer = device.label?.trim();
  return { reason: "computer-off", ...(computer ? { computer } : {}) };
};

export const agentPauseKey = (pause: AgentPause): string =>
  pause.reason === "computer-off" ? `computer-off:${pause.computer ?? ""}` : pause.reason;

export const agentPauseText = (pause: AgentPause): string => {
  switch (pause.reason) {
    case "computer-off":
      return pause.computer ? `${pause.computer} is off` : "its computer is off";
    case "usage-limit":
      return "usage limit reached";
    case "sign-in":
      return "needs a sign-in";
  }
};

export const agentPauseLabel = (pause: AgentPause): string => `Paused · ${agentPauseText(pause)}`;
