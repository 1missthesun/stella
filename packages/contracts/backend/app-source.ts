export type AppSourceRemote = {
  remote: string;
  token: string;
  expiresAt: number;
};

/**
 * One published version on its way to the account's computers.
 *
 * `preparer` is the computer that merges it with the user's own changes when
 * that needs a model; only one per account does, once per version. Its merged
 * result is pushed to the fork as `refs/tags/stella-update/<version>` so every
 * other computer with the same changes takes that instead of merging again.
 * `apply` is the user's Update: the computers it is for (`targets: null` is
 * every one of them) apply the version by themselves.
 */
export type AppSourceUpdate = {
  version: string;
  preparer: { deviceId: string; device: string; base: string; at: number } | null;
  result: { sha: string; base: string; deviceId: string; device: string } | null;
  /** The preparer could not merge it confidently; what conflicts. */
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

/** A preparer that has not reported for this long has gone; another computer may take over. */
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
  /** Ask to be the computer that merges `version`; the answer says who is. */
  "appSource.claimUpdate": {
    args: { version: string; deviceId: string; device: string; base: string };
    result: { update: AppSourceUpdate };
  };
  /** The preparer's outcome: the merged version, or what it could not resolve. */
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
  /** The user pressed Update: `targets` null means every computer. */
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
