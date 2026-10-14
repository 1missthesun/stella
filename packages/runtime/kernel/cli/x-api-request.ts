export type XApiOperation =
  | { op: "connectUrl" }
  | { op: "connections" }
  | {
      op: "request";
      path: string;
      method?: string;
      query?: Record<string, unknown>;
      body?: unknown;
    };

export type XApiAuth = { baseUrl: string; authToken: string };

export type XApiHttpResult = { status: number; body: unknown };

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

const stellaUrl = (baseUrl: string, pathname: string): string =>
  new URL(pathname, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();

const readBody = async (response: Response): Promise<unknown> => {
  const text = await response.text().catch(() => "");
  if (text.length > MAX_RESPONSE_BYTES) {
    return { error: "The Stella X response was too large." };
  }
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: text };
  }
};

export const sendXApiRequest = async (
  auth: XApiAuth,
  operation: XApiOperation,
  signal?: AbortSignal,
): Promise<XApiHttpResult> => {
  const headers = {
    Authorization: `Bearer ${auth.authToken}`,
    "Content-Type": "application/json",
  };
  const init: RequestInit =
    operation.op === "request"
      ? {
          method: "POST",
          headers,
          body: JSON.stringify({
            path: operation.path,
            method: operation.method ?? "GET",
            query: operation.query ?? {},
            ...(operation.body !== undefined ? { body: operation.body } : {}),
          }),
        }
      : { method: "GET", headers };
  const pathname =
    operation.op === "request"
      ? "/api/x/request"
      : operation.op === "connectUrl"
        ? "/api/x/connect-url"
        : "/api/x/connections";
  const response = await fetch(stellaUrl(auth.baseUrl, pathname), {
    ...init,
    ...(signal ? { signal } : {}),
  });
  return { status: response.status, body: await readBody(response) };
};
