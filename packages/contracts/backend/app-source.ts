/**
 * The app's source on Cloudflare Artifacts (v3): one upstream repo the
 * release process publishes to, and a fork per owner that the owner's local
 * clone pushes its self-modifications to. Tokens are short-lived; ask again
 * before each git operation.
 */

export type AppSourceRemote = {
  /** HTTPS git remote. */
  remote: string;
  /** Git token: send as `Authorization: Bearer <token>`. */
  token: string;
  /** Token expiry, ms since epoch. */
  expiresAt: number;
};

export type AppSourceCalls = {
  /**
   * The owner's fork (created from upstream on first use) with a write
   * token, and upstream with a read token for pulling updates.
   */
  "appSource.access": {
    args: Record<string, never>;
    result: {
      fork: AppSourceRemote & { name: string; defaultBranch: string };
      upstream: AppSourceRemote;
    };
  };
  /**
   * The owner's own browser renderer, built from their fork by their desktop
   * and uploaded after a push that changed it: `path` is relative to the
   * website's `/chat-app/` (`u/<fork>/<tree>/`). Null means the shared build.
   */
  "appSource.webRenderer": {
    args: Record<string, never>;
    result: { path: string } | null;
  };
  /**
   * A desktop pushed to the owner's fork (its main or change tags); `tip` is
   * the fork's main after the push. The owner's other computers hear it
   * through `appSource.fork` and fetch. `pushedAt` lets the pusher tell its
   * own push from another computer's.
   */
  "appSource.forkPushed": {
    args: { tip: string };
    result: { pushedAt: number };
  };
};

export type AppSourceViews = {
  /** The last push to the owner's fork; nulls before any desktop reported one. */
  "appSource.fork": {
    args: Record<string, never>;
    result: { tip: string | null; pushedAt: number | null };
  };
};

/**
 * The release channel: one socket per desktop, public (the published
 * version is no secret), on the backend that serves the desktop, which knows
 * only its own environment's namespace (stella-app-prod, stella-app-dev).
 *
 *   GET  ws  → `AppSourceReleaseFrame` on connect, then on every publish
 *   POST     → the publish step's notice: the backend reads upstream `main`
 *             itself and tells connected desktops when it moved
 *
 * Desktops send `SOCKET_KEEPALIVE_PING` (protocol.ts), answered without
 * waking the channel's object.
 */
export const APP_SOURCE_RELEASES_PATH = "/api/app-source/releases";

/** `version` is the upstream `main` commit; null before the first publish. */
export type AppSourceReleaseFrame = { t: "published"; version: string | null };

/** Where the desktop uploads a fork's browser renderer: `PUT <prefix><treeSha>`, an uncompressed tar. */
export const WEB_RENDERER_UPLOAD_PREFIX = "/api/app-source/web-renderer/";
