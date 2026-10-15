import { session, type WebContents } from "electron";
import { RENDERER_ORIGIN } from "../source/origin.js";
import { isCanvasUrl } from "../source/canvas-protocol.js";

const APP_ALLOWED_PERMISSIONS = new Set([
  "media",
  "display-capture",
  "clipboard-sanitized-write",
]);

const originFromUrl = (value: string): string | null => {
  try {
    // `URL.origin` is "null" for the renderer's custom `stella-app:` scheme.
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
};

const isFileUrl = (value: string) => value.startsWith("file://");

const getWebContentsOrigin = (webContents: WebContents | null | undefined) => {
  const url = webContents?.getURL() ?? "";
  if (isFileUrl(url)) return "file://";
  return originFromUrl(url);
};

const CLOUD_BROWSER_LIVE_VIEW_URLS = ["https://live.browser.run/*"];

/**
 * Cloud browser Live View answers with `frame-ancestors *`, and CSP's `*`
 * never matches a custom scheme, so the app's `stella-app:` window could not
 * frame the sign-in handoff. Only a Live View frame inside the app's own
 * window gets the app origin added to its frame-ancestors.
 */
const allowLiveViewInAppFrames = (
  appSession: Electron.Session,
  isTrustedAppContents: (webContents: WebContents | null | undefined) => boolean,
) => {
  appSession.webRequest.onHeadersReceived(
    { urls: CLOUD_BROWSER_LIVE_VIEW_URLS },
    (details, callback) => {
      const headers = details.responseHeaders;
      if (
        !headers ||
        details.resourceType !== "subFrame" ||
        !isTrustedAppContents(details.webContents)
      ) {
        callback({});
        return;
      }
      const next: Record<string, string[]> = {};
      for (const [name, values] of Object.entries(headers)) {
        next[name] =
          name.toLowerCase() === "content-security-policy"
            ? values.map((policy) =>
                policy.replace(
                  /(^|;)(\s*frame-ancestors)((?:\s+(?!'none')[^;\s]+)+)/iu,
                  `$1$2$3 ${RENDERER_ORIGIN}`,
                ),
              )
            : values;
      }
      callback({ responseHeaders: next });
    },
  );
};

type ConfigureStellaSessionPermissionsOptions = {
  appPartition: string;
};

export const configureStellaSessionPermissions = ({
  appPartition,
}: ConfigureStellaSessionPermissionsOptions) => {
  const isTrustedAppContents = (
    webContents: WebContents | null | undefined,
  ) => {
    const origin = getWebContentsOrigin(webContents);
    return origin === "file://" || origin === RENDERER_ORIGIN;
  };
  const appSession = session.fromPartition(appPartition);
  allowLiveViewInAppFrames(appSession, isTrustedAppContents);

  // The window is the app's, but a canvas frame inside it is model-authored
  // content: whatever it asks for (camera, clipboard, notifications, ...) is
  // refused, judged by the frame that asked rather than the window.
  appSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      callback(
        !isCanvasUrl(details.requestingUrl) &&
          APP_ALLOWED_PERMISSIONS.has(permission) &&
          isTrustedAppContents(webContents),
      );
    },
  );

  appSession.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin, details) => {
      return (
        !isCanvasUrl(details.requestingUrl ?? "") &&
        !isCanvasUrl(requestingOrigin) &&
        APP_ALLOWED_PERMISSIONS.has(permission) &&
        isTrustedAppContents(webContents)
      );
    },
  );
};
