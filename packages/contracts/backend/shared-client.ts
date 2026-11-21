import {
  BackendClient,
  type BackendClientOptions,
  type TokenProvider,
} from "./client.js";

/**
 * One BackendClient, so one `/owners/me/live` socket, per backend origin in a
 * process. Every holder leases it with its own token source; the client asks
 * the holders in lease order and the first token wins, so the socket keeps
 * working while any holder is still signed in. The last release disposes it.
 */
export type BackendClientLease = {
  readonly client: BackendClient;
  /** Reconnects the shared socket when the signed-in account changed. */
  noteAuthToken(token: string | null): void;
  release(): void;
};

type Entry = {
  client: BackendClient;
  tokens: TokenProvider[];
  subject: string | null;
};

const entries = new Map<string, Entry>();

const keyOf = (baseUrl: string): string => baseUrl.trim().replace(/\/+$/, "");

export const backendTokenSubject = (
  token: string | null | undefined,
): string | null => {
  const segment = token?.split(".")[1];
  if (!segment) return null;
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  try {
    const json = JSON.parse(atob(padded)) as { sub?: unknown };
    return typeof json.sub === "string" ? json.sub : null;
  } catch {
    return null;
  }
};

const entryFor = (
  key: string,
  options: Omit<BackendClientOptions, "baseUrl" | "getToken">,
): Entry => {
  const existing = entries.get(key);
  if (existing) return existing;
  const entry: Entry = {
    client: null as unknown as BackendClient,
    tokens: [],
    subject: null,
  };
  entry.client = new BackendClient({
    ...options,
    baseUrl: key,
    getToken: async (request) => {
      let failure: unknown = null;
      for (const provider of [...entry.tokens]) {
        try {
          const token = await provider(request);
          if (token) return token;
        } catch (error) {
          failure ??= error;
        }
      }
      if (failure !== null) throw failure;
      return null;
    },
  });
  entries.set(key, entry);
  return entry;
};

export const leaseBackendClient = (
  options: BackendClientOptions,
): BackendClientLease => {
  const key = keyOf(options.baseUrl);
  const { baseUrl: _baseUrl, getToken, ...rest } = options;
  const entry = entryFor(key, rest);
  const token: TokenProvider = (request) => getToken(request);
  entry.tokens.push(token);
  let released = false;
  return {
    client: entry.client,
    noteAuthToken(next) {
      if (released) return;
      const subject = backendTokenSubject(next);
      if (subject === entry.subject) return;
      entry.subject = subject;
      entry.client.reconnect();
    },
    release() {
      if (released) return;
      released = true;
      entry.tokens = entry.tokens.filter((provider) => provider !== token);
      if (entry.tokens.length > 0 || entries.get(key) !== entry) return;
      entries.delete(key);
      entry.client.dispose();
    },
  };
};
