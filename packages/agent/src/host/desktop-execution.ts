import type { Context } from "@earendil-works/chord";
import { samePiBrainHost, type PiBrainHost, type PiBrainRecord } from "@stella/contracts/turn-plane/pi-brain";
import {
  DEVICES_PATH,
  findDeviceDestination,
  type DeviceDestination,
  type DevicesResponse,
} from "@stella/contracts/turn-plane/placement";
import { AGENT_MOVE_CLOUD, deviceRefusal, deviceStanding, type StellaExecutionHost } from "../stella/execution.ts";
import type { StellaPlacement } from "../stella/placement.ts";

const LIST_TIMEOUT_MS = 15_000;

export type DesktopDevices = { devices(): Promise<DeviceDestination[]> };

export const httpDevices = (
  conversationId: string,
  auth: () => { baseUrl: string; authToken: string } | null | undefined,
  pushed?: () => DeviceDestination[] | undefined,
): DesktopDevices | undefined => {
  if (conversationId.startsWith("local_")) return undefined;
  return {
    devices: async () => {
      const live = pushed?.();
      if (live) return live;
      const current = auth();
      if (!current) throw new Error("Sign in to Stella to reach your other computers.");
      const response = await fetch(`${current.baseUrl.replace(/\/+$/, "")}${DEVICES_PATH}`, {
        headers: { authorization: `Bearer ${current.authToken}` },
        signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Listing your computers failed (${response.status}).`);
      return ((await response.json()) as DevicesResponse).devices ?? [];
    },
  };
};

export type DesktopBrain = {
  read(): Promise<PiBrainRecord | null>;
  set(host: PiBrainHost): Promise<PiBrainRecord>;
  handOff(host: PiBrainHost, brief: string): Promise<void>;
  note(host: PiBrainHost, note: { id: string; text: string }): Promise<boolean>;
  setHome?(deviceId: string | null): Promise<void>;
};

export function desktopExecution(options: {
  deviceId?: string;
  localOnly: boolean;
  devices?: DesktopDevices;
  brain?: DesktopBrain;
  turnEnded?(): Promise<void>;
  brainMoved?(record: PiBrainRecord): void;
  moveAgent?: StellaExecutionHost["moveAgent"];
  leftBehind?: StellaExecutionHost["leftBehind"];
  report(error: unknown): void;
}) {
  const isHere = (target: StellaPlacement): boolean =>
    target.kind === "local" || (target.kind === "device" && target.deviceId === options.deviceId);

  const setBrain = async (brain: DesktopBrain, next: PiBrainHost): Promise<PiBrainRecord> => {
    const record = await brain.set(next);
    options.brainMoved?.(record);
    return record;
  };

  const brainHostAt = async (target: StellaPlacement): Promise<{ placement: StellaPlacement; next: PiBrainHost } | { error: string }> => {
    if (isHere(target)) return { error: "You already run on this computer." };
    if (!options.devices) return { error: "Sign in to Stella to move away from this computer." };
    if (target.kind === "cloud") return { placement: target, next: { host: "cloud" } };
    if (target.kind !== "device") return { error: "You already run on this computer." };
    const listed = await options.devices.devices().catch(() => undefined);
    if (!listed) return { error: "Couldn't read the connected devices list right now. Try again in a moment." };
    const device = findDeviceDestination(listed, target.deviceId);
    if (!device) {
      return { error: `No connected device has the device_id or name ${target.deviceId}. Use a device_id from the connected devices list, or "cloud".` };
    }
    if (device.deviceId === options.deviceId) return { error: "You already run on this computer." };
    const name = device.label?.trim() || device.deviceId;
    const refusal = deviceRefusal(device, name);
    if (refusal) return { error: refusal };
    return {
      placement: { kind: "device", deviceId: device.deviceId, label: name },
      next: { host: "device", deviceId: device.deviceId, label: name },
    };
  };

  const agentTarget: NonNullable<StellaExecutionHost["agentTarget"]> = async (deviceId, needs) => {
    if (!options.devices) return { error: "Sign in to Stella to move to another computer." };
    if (deviceId.trim().toLowerCase() === AGENT_MOVE_CLOUD) return { deviceId: AGENT_MOVE_CLOUD, name: "Stella's cloud" };
    const listed = await options.devices.devices().catch(() => undefined);
    if (!listed) return { error: "Couldn't read the connected devices list right now. Try again in a moment." };
    const device = findDeviceDestination(listed, deviceId);
    if (!device) {
      return { error: `No connected device has the device_id or name ${deviceId}. Use a device_id from the connected devices list.` };
    }
    const name = device.label?.trim() || device.deviceId;
    if (device.deviceId === options.deviceId) return { deviceId: device.deviceId, name, here: true };
    if (!device.online) {
      return { error: `${name} is offline, so you can't move there now. Carry on here, or tell Stella with send_message to "stella" if the work needs that computer.` };
    }
    const refusal = deviceRefusal(device, name);
    if (refusal) return { error: refusal };
    if (needs.claudeCode && device.availability && !device.availability.capabilities.includes("claude-code")) {
      return {
        error: `${name} isn't signed in to Claude Code, so you, on Claude Code, can't run there. Ask the user to sign in to Claude on ${name} (Settings › Account there) and try again.`,
      };
    }
    return { deviceId: device.deviceId, name };
  };

  const host: StellaExecutionHost = {
    standing: async (deviceId) => {
      const listed = await options.devices?.devices().catch(() => undefined);
      const device = listed?.find((entry) => entry.deviceId === deviceId);
      return device ? deviceStanding(device) : undefined;
    },
    ...(options.moveAgent && options.devices && !options.localOnly
      ? { agentTarget, moveAgent: options.moveAgent, ...(options.leftBehind ? { leftBehind: options.leftBehind } : {}) }
      : {}),
    ...(options.brain && !options.localOnly
      ? {
          moveBrain: async (target, brief) => {
            const at = await brainHostAt(target);
            if ("error" in at) return at;
            const brain = options.brain!;
            await setBrain(brain, at.next);
            void (async () => {
              await options.turnEnded?.();
              await brain.handOff(at.next, brief);
            })().catch((error: unknown) => options.report(error));
            return { moved: at.placement };
          },
        }
      : {}),
  };

  const pinBrain = async (target: StellaPlacement, _context: Context): Promise<PiBrainRecord | { error: string }> => {
    const brain = options.brain;
    if (!brain || options.localOnly) return { error: "This chat is stored only on this computer, so it can only run here." };
    const home = async (record: PiBrainRecord): Promise<PiBrainRecord> => {
      await brain.setHome?.(record.host === "device" ? record.deviceId : null);
      return record;
    };
    const settle = async (next: PiBrainHost): Promise<PiBrainRecord> => {
      const current = await brain.read().catch(() => null);
      return await home(current && samePiBrainHost(current, next) ? current : await setBrain(brain, next));
    };
    if (!isHere(target)) {
      const at = await brainHostAt(target);
      if ("error" in at) return at;
      return await settle(at.next);
    }
    if (!options.deviceId) return { error: "This computer has no device id yet. Try again in a moment." };
    const listed = await options.devices?.devices().catch(() => undefined);
    const label = listed?.find((entry) => entry.deviceId === options.deviceId)?.label?.trim();
    return await settle({ host: "device", deviceId: options.deviceId, ...(label ? { label } : {}) });
  };

  return { host, pinBrain };
}

export type DesktopExecution = ReturnType<typeof desktopExecution>;
