export const SOCKET_TICKET_PATH = "/api/socket-ticket";
export const SOCKET_TICKET_SUBPROTOCOL_PREFIX = "stella.ticket.";
export const LEGACY_SOCKET_TOKEN_SUBPROTOCOL_PREFIX = "stella.token.";
export const SOCKET_TICKET_TTL_MS = 30_000;
export const SOCKET_TICKET_REQUEST_TIMEOUT_MS = 10_000;

export const SOCKET_TICKET_PURPOSES = [
  "conversation",
  "live",
  "presence",
  "dictation",
] as const;

export type SocketTicketPurpose = (typeof SOCKET_TICKET_PURPOSES)[number];

export type SocketTicketRequest = {
  purpose: SocketTicketPurpose;
  resource?: string;
};

export type SocketTicketResponse = {
  ticket: string;
  expiresAtMs: number;
};

const httpOriginOf = (socketUrl: string): string => {
  const url = new URL(socketUrl);
  if (url.protocol === "ws:") url.protocol = "http:";
  else if (url.protocol === "wss:") url.protocol = "https:";
  return url.origin;
};

const isTicket = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9._-]{16,4096}$/u.test(value);

export const socketCredentialProtocol = async (args: {
  socketUrl: string;
  token: string;
  purpose: SocketTicketPurpose;
  resource?: string;
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
}): Promise<string> => {
  const fetchImpl =
    args.fetchImpl ?? ((url: string, init: RequestInit) => fetch(url, init));
  const body: SocketTicketRequest = {
    purpose: args.purpose,
    ...(args.resource ? { resource: args.resource } : {}),
  };
  const legacy = `${LEGACY_SOCKET_TOKEN_SUBPROTOCOL_PREFIX}${args.token}`;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    SOCKET_TICKET_REQUEST_TIMEOUT_MS,
  );
  try {
    const response = await fetchImpl(
      `${httpOriginOf(args.socketUrl)}${SOCKET_TICKET_PATH}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${args.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );
    if (!response.ok) return legacy;
    const value = (await response.json().catch(() => null)) as
      | Partial<SocketTicketResponse>
      | null;
    return isTicket(value?.ticket)
      ? `${SOCKET_TICKET_SUBPROTOCOL_PREFIX}${value.ticket}`
      : legacy;
  } catch {
    return legacy;
  } finally {
    clearTimeout(timer);
  }
};
