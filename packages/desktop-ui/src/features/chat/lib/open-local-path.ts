import {
  deviceFileNoPreviewMessage,
  deviceFileUnavailableMessage,
} from "@stella/contracts/device-files";
import { openDisplayPayloadTab } from "@/features/workspace-display/open-payload";
import { showToast } from "@/ui/toast";
import { displayPayloadForStellaFile } from "./stella-file-links";

const ipcErrorMessage = (caught: unknown): string =>
  (caught instanceof Error ? caught.message : String(caught)).replace(
    /^Error invoking remote method '[^']*': (?:\w*Error: )?/u,
    "",
  );

export const openLocalPath = async (filePath: string): Promise<string | null> => {
  const payload = displayPayloadForStellaFile(filePath, Date.now());
  if (payload) {
    openDisplayPayloadTab(payload);
    return null;
  }
  const statPath = window.electronAPI?.display?.statPath;
  const stat = statPath
    ? await statPath(filePath).then(
        (value) => ({ ok: true as const, value }),
        (caught: unknown) => ({ ok: false as const, message: ipcErrorMessage(caught) }),
      )
    : null;
  if (stat?.ok && stat.value.deviceName) {
    if (stat.value.kind === "directory") {
      openDisplayPayloadTab({ kind: "folder", filePath, createdAt: Date.now() });
      return null;
    }
    return deviceFileNoPreviewMessage(filePath, stat.value.deviceName);
  }
  if (stat && !stat.ok && stat.message) return stat.message;
  const api = window.electronAPI?.system;
  if (!api?.openPath) return deviceFileUnavailableMessage(null, filePath);
  const result = await api.openPath(filePath).catch(() => null);
  if (result?.ok) return null;
  return result?.error || deviceFileUnavailableMessage(null, filePath);
};

export const showOpenPathError = (error: string) => {
  showToast({ description: error, variant: "error" });
};

export const openLocalPathOrExplain = (filePath: string) => {
  void openLocalPath(filePath).then((error) => {
    if (error) showOpenPathError(error);
  });
};
