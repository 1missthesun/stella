import { useEffect, useMemo, useState } from "react";
import { isEngineConnectionUsable } from "@stella/contracts/backend/engines";
import {
  deviceEngineSignIns,
  type DeviceEngine,
} from "@stella/contracts/execution-context";
import { useUiState } from "@/context/ui-state";
import { useChatStorageMode } from "@/features/chat/services/chat-storage-preference";
import {
  useAccountProviders,
  useCloudEngines,
} from "@/features/cloud/cloud-engines-api";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import { useCloudConversationSession } from "@/global/auth/hooks/use-cloud-conversation-session";
import { useBackendValue } from "@/platform/backend/use-backend-view";
import { getDeviceIdOrNull } from "@/platform/electron/device-id";
import { useT } from "@/shared/i18n";
import {
  conversationBrainAvailable,
  useConversationBrain,
} from "./conversation-brain";

const C = "settings.engineAccounts.claude";

const computerName = (label: string | undefined): string =>
  label?.trim().replace(/\.local$/iu, "") ?? "";

/** Another of the user's computers that is on, and the plans it says it's signed in to. */
export type OtherComputer = {
  deviceId: string;
  label: string;
  signedIn: DeviceEngine[];
};

/** Where the open chat runs, as the model controls need it. */
export type ModelDestination =
  | { kind: "here" }
  | {
      kind: "cloud" | "device";
      /** Its name at the start of a sentence, and inside one. */
      placeStart: string;
      place: string;
      /** The plans it can run; undefined until known (an older Stella doesn't say). */
      signedIn: readonly DeviceEngine[] | undefined;
      /** Providers whose key or sign-in the account holds, so every place can use them; undefined until known. */
      accountProviders: ReadonlySet<string> | undefined;
    };

/** The computers on the account other than this one. */
export function useOtherComputers(): {
  computers: OtherComputer[];
  labelOf: (deviceId: string) => string;
  signInsOf: (deviceId: string) => readonly DeviceEngine[] | undefined;
} {
  const t = useT();
  const { hasConnectedAccount } = useAuthSessionState();
  const [thisDeviceId, setThisDeviceId] = useState<string | null>(null);
  const list = useBackendValue("devices.list", hasConnectedAccount ? {} : "skip");
  useEffect(() => {
    let live = true;
    void getDeviceIdOrNull().then((id) => {
      if (live) setThisDeviceId(id);
    });
    return () => {
      live = false;
    };
  }, []);
  return useMemo(() => {
    const devices = list?.devices ?? [];
    const find = (deviceId: string) =>
      devices.find((device) => device.deviceId === deviceId);
    const labelOf = (deviceId: string) =>
      computerName(find(deviceId)?.label) || t(`${C}.otherComputer`);
    return {
      computers:
        thisDeviceId === null
          ? []
          : devices
              .filter((device) => device.online && device.deviceId !== thisDeviceId)
              .map((device) => ({
                deviceId: device.deviceId,
                label: labelOf(device.deviceId),
                signedIn: deviceEngineSignIns(device.availability?.capabilities) ?? [],
              })),
      labelOf,
      signInsOf: (deviceId: string) =>
        deviceEngineSignIns(find(deviceId)?.availability?.capabilities),
    };
  }, [list, t, thisDeviceId]);
}

export function useModelDestination(): {
  destination: ModelDestination;
  computers: OtherComputer[];
} {
  const t = useT();
  const isPrivate = useChatStorageMode() === "local";
  const { isCloudConversationReady } = useCloudConversationSession();
  const { hasConnectedAccount } = useAuthSessionState();
  const { state: uiState } = useUiState();
  const { computers, labelOf, signInsOf } = useOtherComputers();
  const { brain } = useConversationBrain(
    conversationBrainAvailable() &&
      !isPrivate &&
      isCloudConversationReady &&
      hasConnectedAccount
      ? uiState.conversationId
      : null,
  );
  const target = brain && !brain.here ? brain.target : undefined;
  const brainLabel = brain && !brain.here ? brain.label : undefined;
  const engines = useCloudEngines(target?.mode === "cloud");
  const providers = useAccountProviders(target !== undefined);
  const destination = useMemo((): ModelDestination => {
    if (!target) return { kind: "here" };
    const accountProviders = providers
      ? new Set<string>(
          providers.providers
            .filter((provider) => provider.connection?.status === "ok")
            .map((provider) => provider.id),
        )
      : undefined;
    if (target.mode === "cloud") {
      const connected = engines?.connections.filter(isEngineConnectionUsable);
      const signedIn: DeviceEngine[] = [];
      if (connected?.some((row) => row.provider === "anthropic")) signedIn.push("claude-code");
      if (connected?.some((row) => row.provider === "chatgpt")) signedIn.push("chatgpt");
      return {
        kind: "cloud",
        placeStart: t(`${C}.cloudStart`),
        place: t(`${C}.cloudInline`),
        signedIn: connected ? signedIn : undefined,
        accountProviders,
      };
    }
    const label = computerName(brainLabel) || labelOf(target.deviceId);
    return {
      kind: "device",
      placeStart: label,
      place: label,
      signedIn: signInsOf(target.deviceId),
      accountProviders,
    };
  }, [brainLabel, engines, labelOf, providers, signInsOf, t, target]);
  return { destination, computers };
}

/** The plan a model reference runs on, when it runs on a plan signed in per place. */
export const planOfModel = (modelId: string): DeviceEngine | undefined =>
  modelId.startsWith("claude-code/")
    ? "claude-code"
    : modelId.startsWith("codex-cli/") || modelId.startsWith("chatgpt/")
      ? "chatgpt"
      : modelId.startsWith("antigravity/")
        ? "antigravity"
        : undefined;

/** Whether the place can run a plan; undefined when it runs here or hasn't said. */
export const planSignedInAt = (
  destination: ModelDestination,
  plan: DeviceEngine,
): boolean | undefined =>
  destination.kind === "here" ? undefined : destination.signedIn?.includes(plan);

/** A provider set up only on this computer (its key, sign-in or model server), so no other place can use it. */
export const providerOnlyHere = (
  destination: ModelDestination,
  provider: string,
): boolean =>
  destination.kind !== "here" &&
  destination.accountProviders !== undefined &&
  provider !== "stella" &&
  provider !== "antigravity" &&
  !destination.accountProviders.has(provider);

export type ModelBlock = "signed-out" | "only-here";

/** Why the place the chat runs on can't run this model, if it can't. */
export const modelBlockedAt = (
  destination: ModelDestination,
  modelId: string,
): ModelBlock | undefined => {
  if (destination.kind === "here" || !modelId) return undefined;
  const plan = planOfModel(modelId);
  if (plan) return planSignedInAt(destination, plan) === false ? "signed-out" : undefined;
  const slash = modelId.indexOf("/");
  return slash > 0 && providerOnlyHere(destination, modelId.slice(0, slash))
    ? "only-here"
    : undefined;
};
