import {
  CAPABILITIES,
  hasCapability,
  toCapabilityAudience,
  type ManagedCapabilityAudience,
} from "./capabilities.js";
import {
  currentDeviceDestinations,
  type DeviceDestination,
} from "./turn-plane/placement.js";

export type ExecutionDestination =
  | { kind: "cloud" }
  | { kind: "device"; deviceId: string; label: string };

export type DeviceEngine = "claude-code" | "chatgpt";

export type ExecutionContextDevice = Pick<
  DeviceDestination,
  "deviceId" | "label" | "online" | "remoteExecutionEnabled" | "remoteExecution"
> & { signedIn?: DeviceEngine[] };

const DEVICE_ENGINES: readonly DeviceEngine[] = ["claude-code", "chatgpt"];
const DEVICE_ENGINE_NAMES: Record<DeviceEngine, string> = { "claude-code": "Claude Code", chatgpt: "ChatGPT" };

/** The engines a computer is signed in to, when it reports them (`engine-sign-ins`); older computers report none. */
export const deviceEngineSignIns = (capabilities: readonly unknown[] | undefined): DeviceEngine[] | undefined =>
  capabilities?.includes("engine-sign-ins")
    ? DEVICE_ENGINES.filter((engine) => capabilities.includes(engine))
    : undefined;

const knownEngines = (value: unknown): DeviceEngine[] | undefined =>
  Array.isArray(value) ? DEVICE_ENGINES.filter((engine) => value.includes(engine)) : undefined;

export type MediaAccess = {
  stella: "included" | "upgrade" | "sign_in";
  ownImageKey?: { provider: "openai" | "openrouter" | "fal"; saved: boolean };
};

export const mediaAccessForAudience = (
  audience: ManagedCapabilityAudience | string,
): MediaAccess["stella"] => {
  const plan = toCapabilityAudience(audience as ManagedCapabilityAudience) ?? "free";
  return CAPABILITIES.every((capability) => hasCapability(plan, capability)) ? "included" : "upgrade";
};

export type ExecutionContextSnapshot = {
  devices: ExecutionContextDevice[];
  destination: ExecutionDestination;
  devicesKnown: boolean;
  media?: MediaAccess;
};

const MAX_DEVICES = 100;
const labelText = (value: string): string =>
  value
    .replace(/[<>\r\n\x00-\x1f]/g, " ")
    .trim()
    .slice(0, 256);

export const createExecutionContextSnapshot = (args: {
  devices: readonly (DeviceDestination & { signedIn?: DeviceEngine[] })[] | null;
  destination: ExecutionDestination;
  media?: MediaAccess | undefined;
}): ExecutionContextSnapshot => ({
  destination:
    args.destination.kind === "cloud"
      ? { kind: "cloud" }
      : {
          kind: "device",
          deviceId: labelText(args.destination.deviceId),
          label: labelText(args.destination.label),
        },
  devicesKnown: args.devices !== null,
  devices: currentDeviceDestinations(args.devices ?? [])
    .sort((a, b) =>
      a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0,
    )
    .slice(0, MAX_DEVICES)
    .map((device) => ({
      deviceId: labelText(device.deviceId),
      ...(device.label ? { label: labelText(device.label) } : {}),
      online: device.online,
      remoteExecutionEnabled: device.remoteExecutionEnabled,
      remoteExecution: device.remoteExecution,
      ...((): { signedIn?: DeviceEngine[] } => {
        const signedIn = device.signedIn ?? deviceEngineSignIns(device.availability?.capabilities);
        return device.online && signedIn ? { signedIn } : {};
      })(),
    })),
  ...(args.media
    ? {
        media: {
          stella: args.media.stella,
          ...(args.media.ownImageKey
            ? {
                ownImageKey: {
                  provider: args.media.ownImageKey.provider,
                  saved: args.media.ownImageKey.saved,
                },
              }
            : {}),
        },
      }
    : {}),
});

const readMediaAccess = (value: unknown): MediaAccess | undefined => {
  if (!isRecord(value)) return undefined;
  const stella = value.stella;
  if (stella !== "included" && stella !== "upgrade" && stella !== "sign_in")
    return undefined;
  const key = value.ownImageKey;
  const provider = isRecord(key) ? key.provider : undefined;
  return {
    stella,
    ...(isRecord(key) &&
    (provider === "openai" || provider === "openrouter" || provider === "fal") &&
    typeof key.saved === "boolean"
      ? { ownImageKey: { provider, saved: key.saved } }
      : {}),
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const remoteExecutionText = (
  value: unknown,
): DeviceDestination["remoteExecution"] | undefined =>
  value === "unconfigured" ||
  value === "asking" ||
  value === "enabled" ||
  value === "declined"
    ? value
    : undefined;
const boundedString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 256;

export const readExecutionContextSnapshot = (
  message: unknown,
): ExecutionContextSnapshot | undefined => {
  if (!isRecord(message) || !isRecord(message.executionContext))
    return undefined;
  const snapshot = message.executionContext;
  if (
    !Array.isArray(snapshot.devices) ||
    snapshot.devices.length > MAX_DEVICES ||
    typeof snapshot.devicesKnown !== "boolean"
  )
    return undefined;
  if (!isRecord(snapshot.destination)) return undefined;
  let destination: ExecutionDestination;
  if (snapshot.destination.kind === "cloud") destination = { kind: "cloud" };
  else if (
    snapshot.destination.kind === "device" &&
    boundedString(snapshot.destination.deviceId) &&
    boundedString(snapshot.destination.label)
  ) {
    destination = {
      kind: "device",
      deviceId: snapshot.destination.deviceId,
      label: snapshot.destination.label,
    };
  } else return undefined;
  const devices: ExecutionContextDevice[] = [];
  for (const device of snapshot.devices) {
    if (
      !isRecord(device) ||
      !boundedString(device.deviceId) ||
      (device.label !== undefined && !boundedString(device.label)) ||
      typeof device.online !== "boolean" ||
      typeof device.remoteExecutionEnabled !== "boolean"
    )
      return undefined;
    devices.push({
      deviceId: device.deviceId,
      ...(typeof device.label === "string" ? { label: device.label } : {}),
      online: device.online,
      remoteExecutionEnabled: device.remoteExecutionEnabled,
      remoteExecution: remoteExecutionText(device.remoteExecution)
        ?? (device.remoteExecutionEnabled ? "enabled" : "unconfigured"),
      ...((): { signedIn?: DeviceEngine[] } => {
        const signedIn =
          knownEngines(device.signedIn) ??
          deviceEngineSignIns(isRecord(device.availability) && Array.isArray(device.availability.capabilities)
            ? device.availability.capabilities
            : undefined);
        return signedIn ? { signedIn } : {};
      })(),
    });
  }
  return createExecutionContextSnapshot({
    devices: snapshot.devicesKnown ? devices : null,
    destination,
    media: readMediaAccess(snapshot.media),
  });
};

const remoteExecutionNote = (device: ExecutionContextDevice, reader: "orchestrator" | "agent"): string => {
  switch (device.remoteExecution) {
    case "enabled":
      return "";
    case "asking":
      return "; its screen is asking the user to allow work from other devices";
    case "declined":
      return "; set not to accept work from other devices";
    default:
      return reader === "orchestrator" && device.online
        ? "; not yet allowed to take work from other devices: start the task there anyway, and its screen asks the user to allow it"
        : "; not yet allowed to take work from other devices";
  }
};

const signInNote = (device: ExecutionContextDevice): string => {
  if (!device.online || !device.signedIn) return "";
  const names = (engines: readonly DeviceEngine[]) => engines.map((engine) => DEVICE_ENGINE_NAMES[engine]);
  const have = names(device.signedIn);
  const missing = names(DEVICE_ENGINES.filter((engine) => !device.signedIn!.includes(engine)));
  if (have.length === 0) return `; not signed in to ${missing.join(" or ")}`;
  return `; signed in to ${have.join(" and ")}${missing.length ? `, not ${missing.join(" or ")}` : ""}`;
};

export const renderExecutionDevices = (
  snapshot: ExecutionContextSnapshot,
  reader: "orchestrator" | "agent" = "orchestrator",
): string =>
  [
    "# Connected devices and execution destinations",
    "- Cloud",
    ...snapshot.devices.map(
      (device) =>
        `- ${device.label || device.deviceId} [device_id: ${device.deviceId}]: ${device.online ? "online" : "offline"}${signInNote(device)}${remoteExecutionNote(device, reader)}`,
    ),
    ...(!snapshot.devicesKnown
      ? ["The connected device list is currently unavailable."]
      : []),
    reader === "agent"
      ? 'To move yourself to one of these, pass its device_id (or "cloud") to switch_destination.'
      : 'To run an agent on one of these, pass its device_id (or "cloud") as spawn_agent\'s destination: it runs entirely there. A running agent can move itself to any of these with switch_destination, keeping its conversation.',
  ].join("\n");

export const renderExecutionDestination = (
  snapshot: ExecutionContextSnapshot,
): string =>
  snapshot.destination.kind === "cloud"
    ? "Current execution destination: Cloud."
    : `Current execution destination: ${snapshot.destination.label || snapshot.destination.deviceId} [device_id: ${snapshot.destination.deviceId}].`;

const OWN_KEY_NAMES: Record<NonNullable<MediaAccess["ownImageKey"]>["provider"], string> = {
  openai: "OpenAI",
  openrouter: "OpenRouter",
  fal: "fal",
};

export const renderMediaAccess = (snapshot: ExecutionContextSnapshot): string | undefined => {
  const media = snapshot.media;
  if (!media) return undefined;
  const key = media.ownImageKey;
  const name = key ? OWN_KEY_NAMES[key.provider] : "";
  const keyLine = key?.saved
    ? `Still images use their own ${name} key.`
    : key
      ? `Still images are set to their own ${name} key, but none is saved: ask them to add it in Settings → Image.`
      : null;
  if (media.stella === "included") {
    return ["# Media generation", "On: included in the user's plan.", keyLine].filter(Boolean).join("\n");
  }
  const fix =
    media.stella === "sign_in" ? "sign in and subscribe to Stella Pro" : "subscribe to Stella Pro (Account, top right)";
  const why = media.stella === "sign_in" ? "no Stella account" : "not in the user's plan";
  if (key?.saved) {
    return `# Media generation\nStill images only, on their own ${name} key; the rest is off (${why}). For other media, don't try; tell them to ${fix}.`;
  }
  return [
    "# Media generation",
    `Off: ${why}. If they ask for media, don't try; tell them to ${fix}, or for still images, add their own OpenAI, OpenRouter or fal key in Settings → Image.`,
    keyLine,
  ]
    .filter(Boolean)
    .join("\n");
};
