import { randomUUID } from "node:crypto";

export type RuntimeServerIdentity = {
  serverId: string;
  rootHash: string;
  pid: number;
  buildStamp: string | null;
  protocolVersion: string;
  startedAtMs: number;
  launchEnv: Record<string, string>;
};

export const RUNTIME_SHARED_ENV_KEYS = [
  "STELLA_BROWSER_SOCKET_DIR",
  "STELLA_IN_APP_BROWSER_BOOTSTRAP_SESSION",
] as const;

export const readRuntimeLaunchEnv = (
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> => {
  const launchEnv: Record<string, string> = {};
  for (const key of RUNTIME_SHARED_ENV_KEYS) {
    const value = env[key]?.trim();
    if (value) launchEnv[key] = value;
  }
  return launchEnv;
};

export const createRuntimeServerIdentity = (args: {
  rootHash: string;
  buildStamp: string | null;
  protocolVersion: string;
}): RuntimeServerIdentity => ({
  serverId: randomUUID(),
  rootHash: args.rootHash,
  pid: process.pid,
  buildStamp: args.buildStamp,
  protocolVersion: args.protocolVersion,
  startedAtMs: Date.now(),
  launchEnv: readRuntimeLaunchEnv(),
});

const isStringRecord = (value: unknown): value is Record<string, string> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every((entry) => typeof entry === "string");

export const parseRuntimeServerIdentity = (
  value: unknown,
): RuntimeServerIdentity | null => {
  const candidate = value as Partial<RuntimeServerIdentity> | null;
  if (
    !candidate ||
    typeof candidate.serverId !== "string" ||
    !candidate.serverId ||
    typeof candidate.rootHash !== "string" ||
    typeof candidate.pid !== "number" ||
    typeof candidate.protocolVersion !== "string" ||
    !isStringRecord(candidate.launchEnv)
  ) {
    return null;
  }
  return {
    serverId: candidate.serverId,
    rootHash: candidate.rootHash,
    pid: candidate.pid,
    buildStamp:
      typeof candidate.buildStamp === "string" ? candidate.buildStamp : null,
    protocolVersion: candidate.protocolVersion,
    startedAtMs:
      typeof candidate.startedAtMs === "number" ? candidate.startedAtMs : 0,
    launchEnv: candidate.launchEnv,
  };
};

export type ExpectedRuntimeServerIdentity = {
  rootHash: string;
  pid?: number;
  serverId?: string;
  launchEnv?: Record<string, string>;
};

const sameLaunchEnv = (
  left: Record<string, string>,
  right: Record<string, string>,
): boolean => {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (left[key] !== right[key]) return false;
  }
  return true;
};

export const describeRuntimeServerIdentityMismatch = (
  expected: ExpectedRuntimeServerIdentity,
  actual: RuntimeServerIdentity | null,
): string | null => {
  if (!actual) return "the runtime predates the identity handshake";
  if (actual.rootHash !== expected.rootHash) {
    return `the runtime serves root ${actual.rootHash}, expected ${expected.rootHash}`;
  }
  if (expected.serverId && actual.serverId !== expected.serverId) {
    return `runtime instance ${actual.serverId} answered, expected ${expected.serverId}`;
  }
  if (expected.pid != null && actual.pid !== expected.pid) {
    return `runtime pid ${actual.pid} answered, but the pidfile names ${expected.pid}`;
  }
  if (expected.launchEnv && !sameLaunchEnv(expected.launchEnv, actual.launchEnv)) {
    return `the runtime booted with a different shared environment (${JSON.stringify(actual.launchEnv)}, expected ${JSON.stringify(expected.launchEnv)})`;
  }
  return null;
};
