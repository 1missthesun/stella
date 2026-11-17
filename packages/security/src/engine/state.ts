import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ChangeVerdict, EmailVerdict } from "./judge.ts";
import type { Feed } from "./news/feed.ts";
import type { PublicBreach } from "./reference.ts";
import type { HandledLine, RunSummary } from "./types.ts";
import { OS, home } from "./util.ts";

export type SeenItem = { firstSeen: number; name: string; kind: string; verdict?: ChangeVerdict };

export type State = {
  version: 1;
  /** Everything already looked at (downloads, startup items, extensions, apps), with the model's verdict. */
  seen: Record<string, SeenItem>;
  /** "Not now": hidden until this time. */
  snoozed: Record<string, number>;
  /** Findings the person fixed through the app, kept so the next run can confirm. */
  fixed: Record<string, { at: number; title: string }>;
  handledLog: HandledLine[];
  lastRun?: RunSummary;
  feed?: Feed;
  breachCatalog?: { at: number; list: PublicBreach[] };
  emailLeaks?: Record<string, { at: number; leaks: unknown[] }>;
  mail?: { checkedThrough?: number; connectedAt?: number; verdicts: Record<string, EmailVerdict & { at: number; from: string; subject: string }> };
};

export const defaultDataDir = () =>
  OS === "darwin" ? home("Library/Application Support/Stella Security") : OS === "win32" ? path.join(process.env.APPDATA ?? home("AppData/Roaming"), "Stella Security") : path.join(process.env.XDG_CONFIG_HOME ?? home(".config"), "stella-security");

export const emptyState = (): State => ({ version: 1, seen: {}, snoozed: {}, fixed: {}, handledLog: [] });

export const loadState = (dataDir: string): State => {
  try {
    const s = JSON.parse(readFileSync(path.join(dataDir, "state.json"), "utf8")) as State;
    return s.version === 1 ? { ...emptyState(), ...s } : emptyState();
  } catch {
    return emptyState();
  }
};

export const saveState = (dataDir: string, state: State) => {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = path.join(dataDir, "state.json");
  writeFileSync(file + ".tmp", JSON.stringify(state), { mode: 0o600 });
  renameSync(file + ".tmp", file);
};
