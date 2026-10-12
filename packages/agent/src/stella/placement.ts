/**
 * Where a conversation runs: this computer, another of the user's
 * computers, or the cloud. Every conversation's work runs on the host that
 * holds it; an agent placed elsewhere runs there as a whole
 * (`StellaAgentsHost.remote`), and its record here names where.
 */

/** What is known of a computer an agent runs on. */
export type DevicePlacementInfo = {
  /** The computer's name, as the user's device list shows it. */
  label?: string;
};

export type StellaPlacement =
  | { kind: "local" }
  | { kind: "cloud" }
  | ({ kind: "device"; deviceId: string } & DevicePlacementInfo);

/** Where a `spawn_agent` call asked its agent to run. */
export type SpawnDestination = { kind: "here" } | { kind: "cloud" } | { kind: "device"; deviceId: string };

/** Blank means where the caller runs; any other value names a device. */
export const parseSpawnDestination = (value: unknown): SpawnDestination => {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return { kind: "here" };
  if (text.toLowerCase() === "cloud") return { kind: "cloud" };
  return { kind: "device", deviceId: text };
};

export const placementOf = (
  value: ({ kind: string; deviceId?: string } & DevicePlacementInfo) | undefined,
): StellaPlacement | undefined => {
  if (!value) return undefined;
  if (value.kind === "cloud") return { kind: "cloud" };
  if (value.kind === "device" && value.deviceId) {
    return { kind: "device", deviceId: value.deviceId, ...(typeof value.label === "string" && value.label ? { label: value.label } : {}) };
  }
  if (value.kind === "local") return { kind: "local" };
  return undefined;
};

export const describePlacement = (placement: StellaPlacement): string =>
  placement.kind === "cloud"
    ? "cloud"
    : placement.kind === "device"
      ? placement.label
        ? `${placement.label} [device ${placement.deviceId}]`
        : `device ${placement.deviceId}`
      : "this computer";

/** Whether two placements name the same place, whatever else is known of it. */
export const samePlacement = (a: StellaPlacement, b: StellaPlacement): boolean =>
  a.kind === b.kind && (a.kind !== "device" || (b.kind === "device" && a.deviceId === b.deviceId));
