import { SOCKET_TICKET_PATH } from "@stella/contracts/socket-ticket";
import { SLACK_INSTALL_START_PATH, SLACK_WORKSPACES_PATH } from "@stella/contracts/slack-workspace";
import { browserClientOrigins } from "./auth/auth.js";
const ALLOWED_HEADERS = new Set([
  "authorization",
  "content-type",
  "x-stella-expected-subject",
  "x-stella-voice-lease",
]);

const isUserAsksRoute = (path: string): boolean =>
  path === "/api/user-asks" || path.startsWith("/api/user-asks/");

const isBrowserRoute = (path: string): boolean =>
  /^\/conversations\/[^/]+\/(turns|history|socket|journal|local-turns\/(begin|finish|tool))$/u.test(
    path,
  ) ||
  /^\/owners\/me\/(devices|dispatches|apps)(\/|$)/u.test(path) ||
  path.startsWith("/cloud-home/") ||
  path === SOCKET_TICKET_PATH ||
  path.startsWith("/api/rpc/") ||
  path.startsWith("/api/media/v1/") ||
  path.startsWith("/api/voice/") ||
  path.startsWith("/api/dictation/") ||
  isUserAsksRoute(path) ||
  path.startsWith(SLACK_WORKSPACES_PATH) ||
  path === SLACK_INSTALL_START_PATH;

const isBrowserClientOrigin = (env: unknown, origin: string): boolean =>
  browserClientOrigins(env).some((trusted) => {
    if (!/^https?:/u.test(trusted)) return trusted === origin;
    try {
      return new URL(trusted).origin === origin;
    } catch {
      return false;
    }
  });

export async function withBrowserCors(
  request: Request,
  handle: () => Promise<Response>,
  env?: unknown,
): Promise<Response> {
  const origin = request.headers.get("origin");
  if (!origin || !isBrowserRoute(new URL(request.url).pathname))
    return handle();
  const path = new URL(request.url).pathname;
  const appRoute =
    /^\/owners\/me\/apps(\/|$)/.test(path) ||
    path === SOCKET_TICKET_PATH ||
    path.startsWith("/api/rpc/") ||
    path.startsWith("/api/media/v1/") ||
    path.startsWith("/api/voice/") ||
  path.startsWith("/api/dictation/") ||
  isUserAsksRoute(path) ||
  path.startsWith(SLACK_WORKSPACES_PATH) ||
  path === SLACK_INSTALL_START_PATH;
  // Packaged Electron has an opaque file origin; isolated dev runs use random
  // loopback ports. These routes require a bearer JWT and never use cookies.
  const allowed =
    isBrowserClientOrigin(env, origin) ||
    (appRoute &&
      (origin === "null" ||
        /^http:\/\/(localhost|127\.0\.0\.1):[0-9]+$/.test(origin)));
  if (request.method === "OPTIONS") {
    const method = request.headers.get("access-control-request-method");
    const headers = (
      request.headers.get("access-control-request-headers") ?? ""
    )
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    if (
      !allowed ||
      !method ||
      !["GET", "POST"].includes(method) ||
      headers.some((header) => !ALLOWED_HEADERS.has(header))
    ) {
      return new Response(null, { status: 403, headers: { Vary: "Origin" } });
    }
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST",
        "Access-Control-Allow-Headers": [...ALLOWED_HEADERS].join(", "),
        "Access-Control-Max-Age": "600",
        Vary: "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
      },
    });
  }
  const response = await handle();
  // WebSocket upgrades carry a Workers-specific webSocket handle. Preserve it.
  if (response.status === 101) return response;
  const headers = new Headers(response.headers);
  headers.append("Vary", "Origin");
  if (allowed) headers.set("Access-Control-Allow-Origin", origin);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
