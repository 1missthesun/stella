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

export type DeviceEngine = "claude-code" | "chatgpt" | "antigravity";

export type ExecutionContextDevice = Pick<
  DeviceDestination,
  "deviceId" | "label" | "online" | "remoteExecutionEnabled" | "remoteExecution"
> & { signedIn?: DeviceEngine[] };

const DEVICE_ENGINES: readonly DeviceEngine[] = ["claude-code", "chatgpt", "antigravity"];
const EXPECTED_DEVICE_ENGINES: readonly DeviceEngine[] = ["claude-code", "chatgpt"];
const DEVICE_ENGINE_NAMES: Record<DeviceEngine, string> = {
  "claude-code": "Claude Code",
  chatgpt: "ChatGPT",
  antigravity: "Google Antigravity (antigravity/<model> runs there, e.g. antigravity/gemini-4-neon)",
};

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

export type EmailAccess = { accounts: string[] };

export type ExecutionContextSnapshot = {
  devices: ExecutionContextDevice[];
  destination: ExecutionDestination;
  devicesKnown: boolean;
  media?: MediaAccess;
  email?: EmailAccess;
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
  email?: EmailAccess | undefined;
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
  ...(args.email && args.email.accounts.length > 0
    ? { email: { accounts: args.email.accounts.slice(0, 20).map(labelText) } }
    : {}),
});

const readEmailAccess = (value: unknown): EmailAccess | undefined => {
  if (!isRecord(value) || !Array.isArray(value.accounts)) return undefined;
  const accounts = value.accounts.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  return accounts.length > 0 ? { accounts } : undefined;
};

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
    email: readEmailAccess(snapshot.email),
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
  const missing = names(EXPECTED_DEVICE_ENGINES.filter((engine) => !device.signedIn!.includes(engine)));
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
      ? `Still images are set to their own ${name} key, but none is saved: ask them to add it in Models → Image (the Models button at the top of Stella's window on a computer).`
      : null;
  if (media.stella === "included") {
    return ["# Media generation", "On: included in the user's plan.", keyLine].filter(Boolean).join("\n");
  }
  const fix =
    media.stella === "sign_in" ? "sign in and subscribe to Stella Pro" : "subscribe to Stella Pro (Plan & usage in the account menu, top right, on a computer; Settings on the phone)";
  const why = media.stella === "sign_in" ? "no Stella account" : "not in the user's plan";
  if (key?.saved) {
    return `# Media generation\nStill images only, on their own ${name} key; the rest is off (${why}). For other media, don't try; tell them to ${fix}.`;
  }
  return [
    "# Media generation",
    `Off: ${why}. If they ask for media, don't try; tell them to ${fix}, or for still images, add their own OpenAI, OpenRouter or fal key in Models → Image (the Models button at the top of Stella's window on a computer).`,
    keyLine,
  ]
    .filter(Boolean)
    .join("\n");
};

export const renderEmailAccess = (snapshot: ExecutionContextSnapshot): string | undefined => {
  const accounts = snapshot.email?.accounts;
  if (!accounts?.length) return undefined;
  return [
    "# Email",
    `Email is on: you read the user's Gmail yourself (${accounts.join(", ")}) and keep their Email page, the page they open from the Email tab on a computer and on their phone. It is built around decisions, not emails.`,
    "- When to read: a message from the system says there is new mail (a scheduled read, a few times a day), or an email that may not wait just arrived; or the user asks about their email. Then in `code` call `tools.email({ action: \"inbox\" })`, `read` the threads you need, and update the page with the `page` action.",
    "- The page: needs_you is what only the user can decide, few items, each a gist with your recommendation and one proposed step as `action` (\"Send reply\", \"Pay it\", \"Confirm 7:30\"). When the step is a reply, draft the reply you recommend (pick the option you'd choose and say why in the gist; never a holding reply) with the `draft` action, and put its text in `draft` and its id in `draftId`; they change it with Tell Stella. handled is what you did without them (archived, filed, a routine confirmation), with `action` (\"Undo\", \"Unarchive\") only when it can be undone. waiting is threads where someone owes the user a reply. Everything else only counts toward `ignored`. Related mail is one item (`count`, `threads`). Remove items once they are done or no longer matter. Mark `urgent` only for what can't wait hours or what a wake rule asked to hear about at once; it reaches their phone.",
    "- In the chat: say nothing for a read that only updated the page: answer exactly <no-reply/>. When something needs them, one short line pointing to the page (\"Two emails need you, on the Email page: the lease renewal and Dana's question.\"), never a rundown.",
    "- Their taps on the page arrive as a <canvas-action canvas=\"email\"> message. `do:<id>` is their yes to exactly that item's `action`: do it (send the drafted reply with the `send` action, passing its draft id), then move the item to handled or remove it. `undo:<id>` reverses what you did. `tell:<id>` carries their words about the item in `text`. `check` asks you to read now.",
    "- Sending as the user: only after their yes for that exact email (a tap on its action, or their words). Until then it stays a Gmail draft. Payments and anything else with consequences likewise wait for their yes.",
    "- When they say a kind of email doesn't matter, or ask to hear about something at once, or to always handle something a certain way, save it with the `rules` action (ignore, wake or act) and follow it.",
  ].join("\n");
};
