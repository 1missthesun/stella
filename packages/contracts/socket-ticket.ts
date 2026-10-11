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

export class SocketTicketError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "SocketTicketError";
    this.status = status;
  }
}

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
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    SOCKET_TICKET_REQUEST_TIMEOUT_MS,
  );
  let value: Partial<SocketTicketResponse> | null;
  let status: number;
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
    status = response.status;
    if (status === 401 || status === 404 || status === 405) {
      return `${LEGACY_SOCKET_TOKEN_SUBPROTOCOL_PREFIX}${args.token}`;
    }
    if (!response.ok) {
      throw new SocketTicketError(
        status,
        `Socket ticket request failed (${status}).`,
      );
    }
    value = (await response.json().catch(() => null)) as
      | Partial<SocketTicketResponse>
      | null;
  } finally {
    clearTimeout(timer);
  }
  if (!isTicket(value?.ticket)) {
    throw new SocketTicketError(status, "Socket ticket was malformed.");
  }
  return `${SOCKET_TICKET_SUBPROTOCOL_PREFIX}${value.ticket}`;
};
