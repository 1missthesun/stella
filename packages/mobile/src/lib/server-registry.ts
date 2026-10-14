import * as ExpoSecureStore from "expo-secure-store";
import {
  normalizeServerOrigin,
  parseServerDiscovery,
  type ServerDiscovery,
} from "@stella/contracts/self-host";
import { selfHostServersAvailable } from "./native-capabilities";

export const HOSTED_SERVER_ID = "hosted";

export type SelfHostedServer = {
  kind: "self-hosted";
  id: string;
  origin: string;
  name: string;
  discovery: ServerDiscovery | null;
  addedAt: number;
  checkedAt: number;
};

export type HostedServer = { kind: "hosted"; id: typeof HOSTED_SERVER_ID };

export type ServerEntry = HostedServer | SelfHostedServer;

const REGISTRY_KEY = "stella-mobile.servers.v1";
const ACTIVE_KEY = "stella-mobile.active-server.v1";
const scopeKeysKey = (id: string) => `stella-mobile.server-keys.${id}`;

const options: ExpoSecureStore.SecureStoreOptions = {
  keychainAccessible: ExpoSecureStore.AFTER_FIRST_UNLOCK,
};

const readRaw = (key: string): string | null => {
  try {
    return ExpoSecureStore.getItem(key, options);
  } catch {
    return null;
  }
};

const writeRaw = (key: string, value: string) => {
  try {
    ExpoSecureStore.setItem(key, value, options);
  } catch {
    // Web and broken keychains: the hosted server still works.
  }
};

const deleteRaw = async (key: string) => {
  await ExpoSecureStore.deleteItemAsync(key, options).catch(() => undefined);
};

export const serverIdForOrigin = (origin: string): string =>
  `s_${origin
    .replace(/^https?:\/\//, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .slice(0, 80)}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseEntry = (value: unknown): SelfHostedServer | null => {
  if (!isRecord(value)) return null;
  const origin = normalizeServerOrigin(String(value.origin ?? ""));
  if (!origin) return null;
  const discovery = parseServerDiscovery(value.discovery);
  return {
    kind: "self-hosted",
    id: serverIdForOrigin(origin),
    origin,
    name:
      typeof value.name === "string" && value.name.trim()
        ? value.name.trim()
        : (discovery?.name ?? new URL(origin).host),
    discovery,
    addedAt: typeof value.addedAt === "number" ? value.addedAt : Date.now(),
    checkedAt: typeof value.checkedAt === "number" ? value.checkedAt : 0,
  };
};

export const readSelfHostedServers = (): SelfHostedServer[] => {
  if (!selfHostServersAvailable) return [];
  const raw = readRaw(REGISTRY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed
      .map(parseEntry)
      .filter((entry): entry is SelfHostedServer => {
        if (!entry || seen.has(entry.id)) return false;
        seen.add(entry.id);
        return true;
      });
  } catch {
    return [];
  }
};

const writeSelfHostedServers = (servers: SelfHostedServer[]) => {
  writeRaw(
    REGISTRY_KEY,
    JSON.stringify(
      servers.map(({ origin, name, discovery, addedAt, checkedAt }) => ({
        origin,
        name,
        discovery,
        addedAt,
        checkedAt,
      })),
    ),
  );
};

const HOSTED: HostedServer = { kind: "hosted", id: HOSTED_SERVER_ID };

const resolveLaunchServer = (): ServerEntry => {
  if (!selfHostServersAvailable) return HOSTED;
  const activeId = readRaw(ACTIVE_KEY);
  if (!activeId || activeId === HOSTED_SERVER_ID) return HOSTED;
  return readSelfHostedServers().find((entry) => entry.id === activeId) ?? HOSTED;
};

export const launchServer: ServerEntry = resolveLaunchServer();

export const isSelfHostedLaunch = launchServer.kind === "self-hosted";

export const listServers = (): ServerEntry[] => [HOSTED, ...readSelfHostedServers()];

export const upsertSelfHostedServer = (
  discovery: ServerDiscovery,
  origin: string,
): SelfHostedServer => {
  const normalized = normalizeServerOrigin(origin);
  if (!normalized) throw new Error("That server address isn't valid.");
  const servers = readSelfHostedServers();
  const id = serverIdForOrigin(normalized);
  const existing = servers.find((entry) => entry.id === id);
  const now = Date.now();
  const entry: SelfHostedServer = {
    kind: "self-hosted",
    id,
    origin: normalized,
    name: discovery.name || new URL(normalized).host,
    discovery,
    addedAt: existing?.addedAt ?? now,
    checkedAt: now,
  };
  writeSelfHostedServers([
    ...servers.filter((server) => server.id !== id),
    entry,
  ]);
  return entry;
};

export const updateServerDiscovery = (
  id: string,
  discovery: ServerDiscovery,
): SelfHostedServer | null => {
  const servers = readSelfHostedServers();
  const index = servers.findIndex((entry) => entry.id === id);
  if (index < 0) return null;
  const next: SelfHostedServer = {
    ...servers[index]!,
    name: discovery.name || servers[index]!.name,
    discovery,
    checkedAt: Date.now(),
  };
  servers[index] = next;
  writeSelfHostedServers(servers);
  return next;
};

export const setActiveServerId = (id: string) => {
  writeRaw(ACTIVE_KEY, id);
};

export const storageScopeFor = (serverId: string): string | null =>
  serverId === HOSTED_SERVER_ID ? null : `srv.${serverId}.`;

export const scopedKeyFor = (serverId: string, key: string): string => {
  const scope = storageScopeFor(serverId);
  return scope ? `${scope}${key}` : key;
};

const readScopeKeys = (serverId: string): string[] => {
  const raw = readRaw(scopeKeysKey(serverId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
};

/**
 * Remember which scoped keys a server wrote, so removing the server can
 * delete them all (SecureStore can't list keys).
 */
const notedKeys = new Set<string>();

export const noteScopedKey = (serverId: string, key: string) => {
  if (serverId === HOSTED_SERVER_ID || notedKeys.has(key)) return;
  notedKeys.add(key);
  const keys = readScopeKeys(serverId);
  if (keys.includes(key)) return;
  writeRaw(scopeKeysKey(serverId), JSON.stringify([...keys, key]));
};

export const removeSelfHostedServer = async (id: string) => {
  if (id === HOSTED_SERVER_ID) return;
  const keys = readScopeKeys(id);
  for (const key of keys) notedKeys.delete(key);
  await Promise.all(keys.map((key) => deleteRaw(key)));
  await deleteRaw(scopeKeysKey(id));
  writeSelfHostedServers(readSelfHostedServers().filter((entry) => entry.id !== id));
  if (readRaw(ACTIVE_KEY) === id) writeRaw(ACTIVE_KEY, HOSTED_SERVER_ID);
};

export const serverHost = (entry: ServerEntry, hostedLabel: string): string =>
  entry.kind === "hosted" ? hostedLabel : new URL(entry.origin).host;
