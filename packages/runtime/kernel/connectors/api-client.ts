import { ConnectorAuthError } from "./connector-bridge.js";
import { loadConnectorAccessToken } from "./oauth.js";
import type { ApiConnectorConfig } from "./types.js";

const AUTH_STATUSES = new Set([401, 403, 407]);

const MAX_REDIRECTS = 5;

const connectorBase = (baseUrl: string) =>
  new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);

const isInsideBase = (base: URL, url: URL) => {
  if (url.origin !== base.origin) return false;
  const basePath = base.pathname.replace(/\/+$/u, "");
  return (
    basePath === "" ||
    basePath === "/" ||
    url.pathname === basePath ||
    url.pathname.startsWith(`${basePath}/`)
  );
};

const resolveConnectorUrl = (baseUrl: string, path: string) => {
  const base = connectorBase(baseUrl);
  const url = /^[a-z][a-z0-9+.-]*:/iu.test(path)
    ? new URL(path)
    : new URL(path.replace(/^\/+/u, ""), base);
  if (!isInsideBase(base, url)) {
    throw new Error("API calls must stay within the connector base URL.");
  }
  return url;
};

const buildAuthHeader = async (stellaAppDir: string, api: ApiConnectorConfig) => {
  if (!api.auth || api.auth.type === "none") return {};
  const token = await loadConnectorAccessToken(stellaAppDir, api.auth.tokenKey);
  if (!token) {
    throw new ConnectorAuthError(
      0,
      api.displayName,
      api.auth.tokenKey,
      `${api.displayName} has no stored credential for tokenKey "${api.auth.tokenKey}".`,
    );
  }
  const scheme = api.auth.scheme ?? "bearer";
  const value =
    scheme === "raw"
      ? token
      : scheme === "basic"
        ? `Basic ${token}`
        : scheme === "oauth"
          ? `OAuth ${token}`
          : `Bearer ${token}`;
  return { [api.auth.headerName ?? "Authorization"]: value };
};

export const callApiConnector = async (
  stellaAppDir: string,
  api: ApiConnectorConfig,
  args: {
    method?: string;
    path: string;
    query?: Record<string, string | number | boolean>;
    body?: unknown;
    headers?: Record<string, string>;
  },
) => {
  const method = (args.method ?? "GET").toUpperCase();
  if (!/^(GET|POST|PUT|PATCH|DELETE)$/u.test(method)) {
    throw new Error(`Unsupported API method: ${method}`);
  }
  const url = resolveConnectorUrl(api.baseUrl, args.path);
  for (const [key, value] of Object.entries(args.query ?? {})) {
    url.searchParams.set(key, String(value));
  }
  const authHeaders = await buildAuthHeader(stellaAppDir, api);
  const base = connectorBase(api.baseUrl);
  let target = url;
  let currentMethod = method;
  let body = args.body === undefined ? undefined : JSON.stringify(args.body);
  let credentials = authHeaders;
  let response: Response;
  for (let hop = 0; ; hop += 1) {
    response = await fetch(target, {
      method: currentMethod,
      redirect: "manual",
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(args.headers ?? {}),
        ...credentials,
      },
      body,
    });
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location) break;
    if (hop >= MAX_REDIRECTS) {
      throw new Error(`${api.displayName} API redirected too many times.`);
    }
    await response.body?.cancel();
    target = new URL(location, target);
    if (!isInsideBase(base, target)) credentials = {};
    if (
      response.status === 303 ||
      ((response.status === 301 || response.status === 302) && currentMethod === "POST")
    ) {
      currentMethod = "GET";
      body = undefined;
    }
  }
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  const payload =
    contentType.includes("json") && text ? JSON.parse(text) : text;
  if (!response.ok) {
    if (AUTH_STATUSES.has(response.status)) {
      throw new ConnectorAuthError(
        response.status,
        api.displayName,
        api.auth?.tokenKey,
        text,
      );
    }
    throw new Error(
      `${api.displayName} API failed (${response.status}): ${text.slice(0, 1000)}`,
    );
  }
  return payload;
};
