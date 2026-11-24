export type AppSourceRemote = {
  remote: string;
  token: string;
  expiresAt: number;
};

export type AppSourceUpdate = {
  version: string;
  preparer: { deviceId: string; device: string; base: string; at: number } | null;
  result: { sha: string; base: string; deviceId: string; device: string } | null;
  unresolved: string[] | null;
  apply: {
    deviceId: string;
    device: string;
    targets: string[] | null;
    at: number;
  } | null;
  updatedAt: number;
};

export const UPDATE_RESULT_TAG_PREFIX = "stella-update/";

export const updateResultTag = (version: string) =>
  `${UPDATE_RESULT_TAG_PREFIX}${version}`;

export const UPDATE_PREPARER_STALE_MS = 90 * 60_000;

export type AppSourceCalls = {
  "appSource.access": {
    args: Record<string, never>;
    result: {
      fork: AppSourceRemote & { name: string; defaultBranch: string };
      upstream: AppSourceRemote;
    };
  };
  "appSource.webRenderer": {
    args: Record<string, never>;
    result: { path: string } | null;
  };
  "appSource.forkPushed": {
    args: { tip: string };
    result: { pushedAt: number };
  };
  "appSource.claimUpdate": {
    args: { version: string; deviceId: string; device: string; base: string };
    result: { update: AppSourceUpdate };
  };
  "appSource.updatePrepared": {
    args: {
      version: string;
      deviceId: string;
      device: string;
      base: string;
      result: string | null;
      unresolved?: string[];
    };
    result: { update: AppSourceUpdate };
  };
  "appSource.applyUpdate": {
    args: { version: string; deviceId: string; device: string; targets: string[] | null };
    result: { update: AppSourceUpdate };
  };
};

export type AppSourceViews = {
  "appSource.fork": {
    args: Record<string, never>;
    result: { tip: string | null; pushedAt: number | null };
  };
  "appSource.update": {
    args: Record<string, never>;
    result: { update: AppSourceUpdate | null };
  };
};

export const APP_SOURCE_RELEASES_PATH = "/api/app-source/releases";

export type AppSourceReleaseFrame = { t: "published"; version: string | null };

export const WEB_RENDERER_UPLOAD_PREFIX = "/api/app-source/web-renderer/";
