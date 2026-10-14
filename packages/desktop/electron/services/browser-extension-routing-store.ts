import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { writePrivateFileSync } from "@stella/runtime/kernel/shared/private-fs";
import type {
  BrowserExtensionClient,
  BrowserExtensionClientsState,
  BrowserExtensionRouting,
} from "@stella/contracts/desktop/browser-view";

export const BROWSER_EXTENSION_ROUTING_FILE = "browser-extension-routing.json";

const MAX_KNOWN_CLIENTS = 32;
const BUNDLE_KEY_PREFIX = "bundle:";

const nullableString = z.string().nullable().catch(null);

const knownClientSchema = z.object({
  key: z.string().min(1),
  browser: z.string().catch(""),
  profile: nullableString,
  email: nullableString,
  lastSeenAtMs: z.number().finite().catch(0),
});

export type KnownBrowserExtensionClient = z.infer<typeof knownClientSchema>;

const storeSchema = z.object({
  version: z.literal(1),
  preferredKey: z.string().min(1).nullable().catch(null),
  disabledKeys: z.array(z.string().min(1)).catch([]),
  known: z
    .array(z.unknown())
    .catch([])
    .transform((entries) =>
      entries.flatMap((entry) => {
        const parsed = knownClientSchema.safeParse(entry);
        return parsed.success ? [parsed.data] : [];
      }),
    ),
});

export type BrowserExtensionRoutingRecord = BrowserExtensionRouting & {
  known: KnownBrowserExtensionClient[];
};

const daemonClientSchema = z.object({
  key: z.string().min(1),
  browser: z.string().catch(""),
  profile: nullableString.optional().transform((value) => value ?? null),
  email: nullableString.optional().transform((value) => value ?? null),
  connectedAtMs: z.number().finite().optional().catch(undefined),
  enabled: z.boolean().catch(true),
  inUse: z.boolean().catch(false),
});

export type DaemonExtensionClient = z.infer<typeof daemonClientSchema>;

export const parseDaemonExtensionClients = (
  data: unknown,
): DaemonExtensionClient[] => {
  if (!data || typeof data !== "object" || !("clients" in data)) return [];
  const { clients } = data as { clients: unknown };
  if (!Array.isArray(clients)) return [];
  const byKey = new Map<string, DaemonExtensionClient>();
  for (const entry of clients) {
    const parsed = daemonClientSchema.safeParse(entry);
    if (!parsed.success) continue;
    const existing = byKey.get(parsed.data.key);
    if (!existing || (parsed.data.inUse && !existing.inUse)) {
      byKey.set(parsed.data.key, parsed.data);
    }
  }
  return [...byKey.values()];
};

const emptyRecord = (): BrowserExtensionRoutingRecord => ({
  preferredKey: null,
  disabledKeys: [],
  known: [],
});

const storePath = (stellaDataDir: string) =>
  path.join(stellaDataDir, BROWSER_EXTENSION_ROUTING_FILE);

export const readBrowserExtensionRouting = (
  stellaDataDir: string,
): BrowserExtensionRoutingRecord => {
  try {
    const raw: unknown = JSON.parse(
      fs.readFileSync(storePath(stellaDataDir), "utf-8"),
    );
    const parsed = storeSchema.safeParse(raw);
    if (!parsed.success) return emptyRecord();
    return {
      preferredKey: parsed.data.preferredKey,
      disabledKeys: [...new Set(parsed.data.disabledKeys)],
      known: parsed.data.known,
    };
  } catch {
    return emptyRecord();
  }
};

const writeBrowserExtensionRouting = (
  stellaDataDir: string,
  record: BrowserExtensionRoutingRecord,
) => {
  try {
    fs.mkdirSync(stellaDataDir, { recursive: true });
    writePrivateFileSync(
      storePath(stellaDataDir),
      JSON.stringify({ version: 1, ...record }, null, 2),
    );
  } catch (error) {
    console.warn(
      "[browser-extension-routing] Failed to save routing:",
      error instanceof Error ? error.message : String(error),
    );
  }
};

const sameKnown = (
  left: KnownBrowserExtensionClient[],
  right: KnownBrowserExtensionClient[],
) => JSON.stringify(left) === JSON.stringify(right);

const isPinned = (record: BrowserExtensionRouting, key: string) =>
  record.preferredKey === key || record.disabledKeys.includes(key);

export const rememberBrowserExtensionClients = (
  stellaDataDir: string,
  clients: DaemonExtensionClient[],
  now = Date.now(),
): BrowserExtensionRoutingRecord => {
  const record = readBrowserExtensionRouting(stellaDataDir);
  const known = new Map(record.known.map((entry) => [entry.key, entry]));
  for (const client of clients) {
    const previous = known.get(client.key);
    known.set(client.key, {
      key: client.key,
      browser: client.browser || previous?.browser || "",
      profile: client.profile ?? previous?.profile ?? null,
      email: client.email ?? previous?.email ?? null,
      lastSeenAtMs: now,
    });
  }
  const profiledBrowsers = new Set(
    [...known.values()]
      .filter((entry) => !entry.key.startsWith(BUNDLE_KEY_PREFIX))
      .map((entry) => entry.browser),
  );
  const connectedKeys = new Set(clients.map((client) => client.key));
  const next = [...known.values()]
    .filter(
      (entry) =>
        !entry.key.startsWith(BUNDLE_KEY_PREFIX) ||
        connectedKeys.has(entry.key) ||
        isPinned(record, entry.key) ||
        !profiledBrowsers.has(entry.browser),
    )
    .sort((left, right) => right.lastSeenAtMs - left.lastSeenAtMs)
    .slice(0, MAX_KNOWN_CLIENTS);
  if (sameKnown(next, record.known)) return record;
  const updated = { ...record, known: next };
  writeBrowserExtensionRouting(stellaDataDir, updated);
  return updated;
};

export const saveBrowserExtensionRouting = (
  stellaDataDir: string,
  routing: BrowserExtensionRouting,
): BrowserExtensionRoutingRecord => {
  const record = readBrowserExtensionRouting(stellaDataDir);
  const updated: BrowserExtensionRoutingRecord = {
    ...record,
    preferredKey: routing.preferredKey,
    disabledKeys: [...new Set(routing.disabledKeys)],
  };
  writeBrowserExtensionRouting(stellaDataDir, updated);
  return updated;
};

export const buildBrowserExtensionClientsState = (
  record: BrowserExtensionRoutingRecord,
  connected: DaemonExtensionClient[],
): BrowserExtensionClientsState => {
  const live = new Map(connected.map((client) => [client.key, client]));
  const disabled = new Set(record.disabledKeys);
  const keys = [
    ...record.known.map((entry) => entry.key),
    ...connected
      .map((client) => client.key)
      .filter((key) => !record.known.some((entry) => entry.key === key)),
  ];
  const clients = keys.map((key): BrowserExtensionClient => {
    const knownEntry = record.known.find((entry) => entry.key === key);
    const liveEntry = live.get(key);
    const enabled = !disabled.has(key);
    const isConnected = Boolean(liveEntry);
    const inUse = Boolean(liveEntry?.inUse) && enabled;
    return {
      key,
      browser: liveEntry?.browser || knownEntry?.browser || "",
      profile: liveEntry?.profile ?? knownEntry?.profile ?? null,
      email: liveEntry?.email ?? knownEntry?.email ?? null,
      connected: isConnected,
      enabled,
      inUse,
      status: !enabled
        ? "off"
        : inUse
          ? "in_use"
          : isConnected
            ? "connected"
            : "not_connected",
      lastSeenAtMs: knownEntry?.lastSeenAtMs ?? Date.now(),
    };
  });
  clients.sort((left, right) => {
    const byBrowser = left.browser.localeCompare(right.browser);
    if (byBrowser !== 0) return byBrowser;
    return (left.profile ?? "").localeCompare(right.profile ?? "");
  });
  return {
    preferredKey: record.preferredKey,
    disabledKeys: record.disabledKeys,
    clients,
  };
};
