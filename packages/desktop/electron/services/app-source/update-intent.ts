import { promises as fs } from "node:fs";
import path from "node:path";

export type Wanted =
  | {
      kind: "version";
      version: string;
      from: { deviceId: string; device: string } | null;
      at: number;
      task?: true;
    }
  | { kind: "draft"; name: string; at: number };

export type Arrived = {
  sha: string;
  version: string;
  from: string | null;
  at: number;
  revert?: string;
};

export type UpdateIntent = {
  wanted: Wanted[];
  arrived: Arrived | null;
  handled: string[];
};

const FILE = "stella-update-intent.json";
export const WANTED_MAX_AGE_MS = 24 * 60 * 60_000;
const HANDLED_KEEP = 50;

const EMPTY: UpdateIntent = { wanted: [], arrived: null, handled: [] };

const isWanted = (value: unknown): value is Wanted => {
  const entry = value as Partial<Wanted> | null;
  if (!entry || typeof entry.at !== "number") return false;
  if (entry.kind === "version") return typeof (entry as { version?: unknown }).version === "string";
  return entry.kind === "draft" && typeof (entry as { name?: unknown }).name === "string";
};

export const readIntent = async (commonDir: string): Promise<UpdateIntent> => {
  try {
    const value = JSON.parse(await fs.readFile(path.join(commonDir, FILE), "utf8")) as Partial<UpdateIntent>;
    const now = Date.now();
    return {
      wanted: Array.isArray(value.wanted)
        ? value.wanted.filter(isWanted).filter((entry) => now - entry.at < WANTED_MAX_AGE_MS)
        : [],
      arrived:
        value.arrived && typeof value.arrived.sha === "string" && typeof value.arrived.at === "number"
          ? value.arrived
          : null,
      handled: Array.isArray(value.handled)
        ? value.handled.filter((key): key is string => typeof key === "string")
        : [],
    };
  } catch {
    return { ...EMPTY, wanted: [], handled: [] };
  }
};

export const writeIntent = async (commonDir: string, intent: UpdateIntent) => {
  const file = path.join(commonDir, FILE);
  const kept: UpdateIntent = { ...intent, handled: intent.handled.slice(-HANDLED_KEEP) };
  const staging = `${file}.${process.pid}.tmp`;
  await fs.writeFile(staging, JSON.stringify(kept));
  await fs.rename(staging, file);
};
