import { fetchWithDeadline, REQUEST_BUDGET_MS } from "@stella/contracts/request-deadline";
import { RPC_PATH_PREFIX } from "@stella/contracts/backend/protocol";

export const ACCOUNT_MCP_OPS = ["list", "put", "remove", "call"] as const;

export type AccountMcpOp = (typeof ACCOUNT_MCP_OPS)[number];

export type AccountMcpOperation = { op: AccountMcpOp; args: Record<string, unknown> };

export type AccountMcpAuth = { baseUrl: string; authToken: string };

export type AccountMcpHttpResult = { status: number; body: unknown };

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export const sendAccountMcpRequest = async (
  auth: AccountMcpAuth,
  operation: AccountMcpOperation,
  signal?: AbortSignal,
): Promise<AccountMcpHttpResult> => {
  const url = new URL(
    `${RPC_PATH_PREFIX}mcpServers.${operation.op}`,
    auth.baseUrl.endsWith("/") ? auth.baseUrl : `${auth.baseUrl}/`,
  );
  const response = await fetchWithDeadline(
    fetch,
    url.toString(),
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${auth.authToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ args: operation.args }),
    },
    {
      label: `MCP ${operation.op}`,
      timeoutMs: operation.op === "call" ? REQUEST_BUDGET_MS.slow : REQUEST_BUDGET_MS.call,
      signal,
    },
  );
  const text = await response.text().catch(() => "");
  if (text.length > MAX_RESPONSE_BYTES) {
    return { status: 502, body: { ok: false, error: { message: "The MCP registry response was too large." } } };
  }
  let body: unknown = null;
  try {
    body = text.trim() ? (JSON.parse(text) as unknown) : null;
  } catch {
    body = { ok: false, error: { message: text.slice(0, 500) } };
  }
  return { status: response.status, body };
};
