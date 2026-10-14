import { getElectronApi } from "./electron";
import { writeLocalDeviceId } from "./device-id";
import { backendUrl } from "@/platform/backend/backend-url";

export { getDeviceIdOrNull, getOrCreateDeviceId } from "./device-id";

let configurePiRuntimePromise: Promise<void> | null = null;

const runConfigurePiRuntime = async () => {
  const api = getElectronApi();
  if (!api?.system?.configurePiRuntime || !backendUrl) {
    return;
  }
  const response = await api.system.configurePiRuntime({ backendUrl });
  if (response?.deviceId) {
    writeLocalDeviceId(response.deviceId);
  }
};

export const configurePiRuntime = async () => {
  if (configurePiRuntimePromise) {
    return configurePiRuntimePromise;
  }
  const attempt = runConfigurePiRuntime();
  configurePiRuntimePromise = attempt.then(
    () => undefined,
    (err) => {
      configurePiRuntimePromise = null;
      console.debug(
        "[device] configurePiRuntime failed:",
        (err as Error).message,
      );
    },
  );
  return configurePiRuntimePromise;
};
