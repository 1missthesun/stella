export type DevicePlacementInfo = {
  label?: string;
};

export type StellaPlacement =
  | { kind: "local" }
  | { kind: "cloud" }
  | ({ kind: "device"; deviceId: string } & DevicePlacementInfo);

export type SpawnDestination = { kind: "here" } | { kind: "cloud" } | { kind: "device"; deviceId: string };

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

export const samePlacement = (a: StellaPlacement, b: StellaPlacement): boolean =>
  a.kind === b.kind && (a.kind !== "device" || (b.kind === "device" && a.deviceId === b.deviceId));
