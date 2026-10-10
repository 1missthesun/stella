import { deviceFileUnavailableMessage } from "@stella/contracts/device-files";
import { openDisplayPayloadTab } from "@/features/workspace-display/open-payload";
import { showToast } from "@/ui/toast";
import { displayPayloadForStellaFile } from "./stella-file-links";

/**
 * Open a local path a chat reply links to, the way every chat entry point
 * (inline link, attachment pill, overflow menu) should: a type with an
 * in-app viewer opens in the side panel, which explains a file it can't
 * find; anything else (a folder, a `.txt`, an unknown type) goes to the OS,
 * so a folder opens in Finder or the file manager. A folder on another of
 * the user's computers opens as a listing in the side panel instead. Resolves
 * to the reason it could not open, or null.
 */
export const openLocalPath = async (filePath: string): Promise<string | null> => {
  const payload = displayPayloadForStellaFile(filePath, Date.now());
  if (payload) {
    openDisplayPayloadTab(payload);
    return null;
  }
  const statPath = window.electronAPI?.display?.statPath;
  const stat = statPath ? await statPath(filePath).catch(() => null) : null;
  if (stat?.kind === "directory" && stat.deviceName) {
    openDisplayPayloadTab({ kind: "folder", filePath, createdAt: Date.now() });
    return null;
  }
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
