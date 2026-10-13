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

/**
 * Open a local path a chat reply links to, the way every chat entry point
 * (inline link, attachment pill, overflow menu) should: a type with an
 * in-app viewer opens in the side panel, which finds the file on this
 * computer, the computer that produced it, the selected computer or the copy
 * in the Drive, and explains a file it can't find. Anything else (a folder,
 * an unknown type) goes to the OS when it is on this computer, so a folder
 * opens in the file manager; a folder on another of the user's computers
 * opens as a listing in the side panel, and a file there says where it is.
 * Resolves to the reason it could not open, or null.
 */
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
