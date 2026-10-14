export type AppSourceRemote = {
  remote: string;
  token: string;
  expiresAt: number;
};

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
};

export type AppSourceViews = {
  "appSource.fork": {
    args: Record<string, never>;
    result: { tip: string | null; pushedAt: number | null };
  };
};

export const APP_SOURCE_RELEASES_PATH = "/api/app-source/releases";

export type AppSourceReleaseFrame = { t: "published"; version: string | null };

export const WEB_RENDERER_UPLOAD_PREFIX = "/api/app-source/web-renderer/";
