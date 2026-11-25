import type { CloudApp } from "./cloud-api";
import { openAppTab } from "@/features/workspace-display/open-payload";

const CLOUD_APP_LOCATION_PREFIX = "cloud:";

export const cloudAppLocation = (appId: string): string =>
  `${CLOUD_APP_LOCATION_PREFIX}${appId}`;

export const cloudAppIdFromLocation = (location: string | null): string | null => {
  if (!location?.startsWith(CLOUD_APP_LOCATION_PREFIX)) return null;
  const appId = location.slice(CLOUD_APP_LOCATION_PREFIX.length).trim();
  return appId || null;
};

export const openCloudAppPanel = (app: Pick<CloudApp, "appId">): void => {
  openAppTab(cloudAppLocation(app.appId));
};
