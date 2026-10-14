import type { AutomaticExecutionTarget } from "./execution-placement-core";
import type { StoredPhoneAccess } from "./phone-access";

export type RealtimeVoiceRoute =
  | { execution: "phone"; desktopAccess: null }
  | { execution: "computer"; desktopAccess: StoredPhoneAccess };

export const resolveRealtimeVoiceRoute = (args: {
  executionTarget: AutomaticExecutionTarget;
  preferredAccess: StoredPhoneAccess | null;
  pairedDesktops: readonly StoredPhoneAccess[];
}): RealtimeVoiceRoute => {
  const { executionTarget, preferredAccess, pairedDesktops } = args;
  if (executionTarget.mode === "cloud") {
    return { execution: "phone", desktopAccess: null };
  }
  if (executionTarget.mode === "device") {
    const selected =
      pairedDesktops.find(
        (entry) => entry.desktopDeviceId === executionTarget.deviceId,
      ) ??
      (preferredAccess?.desktopDeviceId === executionTarget.deviceId
        ? preferredAccess
        : null);
    return selected
      ? { execution: "computer", desktopAccess: selected }
      : { execution: "phone", desktopAccess: null };
  }
  return preferredAccess
    ? { execution: "computer", desktopAccess: preferredAccess }
    : { execution: "phone", desktopAccess: null };
};
