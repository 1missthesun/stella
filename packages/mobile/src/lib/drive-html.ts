import { embedRelativeHtmlAssets } from "@stella/contracts/html-relative-assets";
import { transferBudgetMs } from "@stella/contracts/request-deadline";
import { fetchWithinDeadline } from "./cloud-request";
import { resolveCloudDriveFileUri } from "./use-cloud-drive-file-uri";

const fetchDriveText = async (
  uri: string,
  signal: AbortSignal | undefined,
): Promise<Response> =>
  await fetchWithinDeadline(uri, undefined, {
    label: "Loading this file from your Drive",
    timeoutMs: transferBudgetMs(null),
    ...(signal ? { signal } : {}),
  });

export const embedDriveHtmlAssets = async (
  html: string,
  drivePath: string,
  signal?: AbortSignal,
): Promise<string> =>
  await embedRelativeHtmlAssets(
    html,
    `/${drivePath.replace(/^\/+/u, "")}`,
    async ({ path, kind }) => {
      const assetUri = await resolveCloudDriveFileUri(path.replace(/^\/+/u, ""));
      if (kind !== "text") return assetUri;
      const asset = await fetchDriveText(assetUri, signal);
      return asset.ok ? await asset.text() : null;
    },
    signal,
  );

export const loadDriveHtml = async (
  drivePath: string,
  signal?: AbortSignal,
): Promise<string> => {
  const response = await fetchDriveText(
    await resolveCloudDriveFileUri(drivePath),
    signal,
  );
  if (!response.ok) throw new Error("This file is no longer available.");
  return await embedDriveHtmlAssets(await response.text(), drivePath, signal);
};
