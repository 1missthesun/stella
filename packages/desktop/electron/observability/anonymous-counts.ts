import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import {
  ANONYMOUS_COUNTS_ENABLED,
  ANONYMOUS_COUNTS_ENDPOINTS,
  ANONYMOUS_COUNTS_MAX_EVENTS,
  ANONYMOUS_COUNTS_SCHEMA_VERSION,
  ANONYMOUS_COUNT_PLATFORMS,
  isAnonymousCountsInstallId,
  isFoundViaChoice,
  type AnonymousCountEngine,
  type AnonymousCountEvent,
  type AnonymousCountItem,
  type AnonymousCountPlatform,
  type AnonymousCountRequest,
  type AnonymousCountsBatch,
} from "@stella/contracts/telemetry/anonymous-counts";
import {
  getAnonymousCountsEnabled,
  getOnboardingCompleted,
  loadLocalPreferences,
  setAnonymousCountsEnabled,
} from "@stella/runtime/kernel/preferences/local-preferences";
import { gitRaw } from "../services/app-source/git.js";

type OnceEvent = "first_run" | "engine_chosen" | "first_reply" | "found_via";

type CountsState = {
  installId: string;
  recorded: Partial<Record<OnceEvent, true>>;
  lastActiveDay: string | null;
  queue: AnonymousCountItem[];
};

export type AnonymousCountsStatus = { available: boolean; enabled: boolean };

type AnonymousCountsOptions = {
  stellaDataDirPath: string;
  environment: "development" | "production";
  isSignedIn: () => Promise<boolean>;
  isSelfHosted: () => boolean;
  /** The app checkout, to find which published Stella it is built from. */
  getStellaAppDir?: () => string | null | undefined;
};

const MAX_QUEUE = 50;
const TICK_MS = 30 * 60_000;
const START_DELAY_MS = 5_000;
const SEND_TIMEOUT_MS = 10_000;

const localDay = (date = new Date()): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const platform = (): AnonymousCountPlatform | null =>
  (ANONYMOUS_COUNT_PLATFORMS as readonly string[]).includes(process.platform)
    ? (process.platform as AnonymousCountPlatform)
    : null;

const RELEASE_LABEL = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,31}$/;
const UPSTREAM_REF = "refs/remotes/stella-upstream/main";
const LAUNCHER_LOG_TAIL_BYTES = 1024 * 1024;

/**
 * The newest published Stella this checkout contains (the same commit on
 * every computer, never a local merge), shortened to 12 characters.
 */
const publishedSource = async (appDir: string | null | undefined): Promise<string | null> => {
  if (!appDir) return null;
  const result = await gitRaw(appDir, ["merge-base", "HEAD", UPSTREAM_REF], {
    background: true,
    timeoutMs: 10_000,
  }).catch(() => null);
  const commit = result?.code === 0 ? result.stdout.trim() : "";
  return /^[0-9a-f]{40,64}$/.test(commit) ? commit.slice(0, 12) : null;
};

/**
 * The launcher's version. Launchers from v86 on pass it in the environment;
 * older ones write it in their log as they start, before starting Electron.
 */
const launcherVersion = async (): Promise<string | null> => {
  const fromEnv = process.env.STELLA_LAUNCHER_VERSION?.trim();
  if (fromEnv && /^\d{1,9}$/.test(fromEnv)) return fromEnv;
  const root = process.env.STELLA_LAUNCHER_DATA_DIR?.trim();
  if (!root) return null;
  const file = await open(path.join(root, "logs", "launcher.log"), "r").catch(() => null);
  if (!file) return null;
  try {
    const { size } = await file.stat();
    const length = Math.min(size, LAUNCHER_LOG_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    await file.read(buffer, 0, length, size - length);
    const starts = [...buffer.toString("utf8").matchAll(/launcher: start .*?\bversion=(\d{1,9})\b/g)];
    return starts.at(-1)?.[1] ?? null;
  } catch {
    return null;
  } finally {
    await file.close().catch(() => {});
  }
};

/**
 * `<app version>+s<published Stella>.l<launcher>`, for example
 * `0.0.0+s94e565cd5882.l85`: semver build metadata, so the telemetry worker's
 * release check and column take it as they are. Parts that can't be found
 * are left out.
 */
const releaseLabel = async (appDir: string | null | undefined): Promise<string> => {
  const version = app.getVersion();
  const base = RELEASE_LABEL.test(version) && !version.includes("+") ? version : "unknown";
  const [source, launcher] = await Promise.all([publishedSource(appDir), launcherVersion()]);
  const build = [source && `s${source}`, launcher && `l${launcher}`].filter(Boolean);
  const label = build.length ? `${base}+${build.join(".")}` : base;
  return RELEASE_LABEL.test(label) ? label : base;
};

/** Which engine the computer is set to use, from its local model preferences. */
export const classifyAnonymousCountEngine = (
  stellaDataDir: string,
  signedIn: boolean,
): AnonymousCountEngine => {
  const prefs = loadLocalPreferences(stellaDataDir);
  if (prefs.agentRuntimeEngine === "claude_code_local") return "claude_code";
  if (prefs.agentRuntimeEngine === "codex_cli") return "chatgpt";
  const provider = prefs.modelOverrides?.orchestrator?.split("/")[0]?.trim();
  if (provider === "local") return "local";
  if (provider === "chatgpt") return "chatgpt";
  if (provider && provider !== "stella") return "api_key";
  return signedIn ? "stella" : "none";
};

/**
 * Anonymous install counts (contracts `telemetry/anonymous-counts.ts`).
 * Everything is a no-op while `ANONYMOUS_COUNTS_ENABLED` is false, on a
 * self-hosted server, or when the user turned the Settings toggle off.
 */
export class AnonymousCounts {
  private readonly statePath: string;
  private state: CountsState | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private timer: NodeJS.Timeout | null = null;
  private sending = false;

  constructor(private readonly options: AnonymousCountsOptions) {
    this.statePath = path.join(
      options.stellaDataDirPath,
      "telemetry",
      "anonymous-counts.json",
    );
  }

  private available(): boolean {
    return ANONYMOUS_COUNTS_ENABLED && platform() !== null && !this.options.isSelfHosted();
  }

  private active(): boolean {
    return this.available() && getAnonymousCountsEnabled(this.options.stellaDataDirPath);
  }

  status(): AnonymousCountsStatus {
    return {
      available: this.available(),
      enabled: getAnonymousCountsEnabled(this.options.stellaDataDirPath),
    };
  }

  start(): void {
    if (!this.available() || this.timer) return;
    const tick = () => void this.tick();
    setTimeout(tick, START_DELAY_MS).unref();
    this.timer = setInterval(tick, TICK_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async setEnabled(enabled: boolean): Promise<AnonymousCountsStatus> {
    setAnonymousCountsEnabled(this.options.stellaDataDirPath, enabled);
    if (!enabled) {
      await this.serial(async () => {
        const state = await this.load();
        state.queue = [];
        await this.save(state);
      });
    } else {
      this.start();
      void this.tick();
    }
    return this.status();
  }

  async record(request: AnonymousCountRequest): Promise<void> {
    if (!this.active()) return;
    const event = await this.resolve(request);
    if (!event) return;
    await this.enqueue(event, true);
    void this.flush();
  }

  private async resolve(request: AnonymousCountRequest): Promise<AnonymousCountEvent | null> {
    switch (request?.type) {
      case "engine_chosen":
      case "first_reply":
        return {
          type: request.type,
          engine: classifyAnonymousCountEngine(
            this.options.stellaDataDirPath,
            await this.options.isSignedIn().catch(() => false),
          ),
        };
      case "found_via":
        return isFoundViaChoice(request.answer)
          ? { type: "found_via", answer: request.answer }
          : null;
      default:
        return null;
    }
  }

  private async tick(): Promise<void> {
    if (!this.active()) return;
    const state = await this.serial(() => this.load());
    if (!state.recorded.first_run) {
      await this.enqueue(
        {
          type: "first_run",
          existingInstall: getOnboardingCompleted(this.options.stellaDataDirPath),
        },
        true,
      );
    }
    await this.enqueue({ type: "active_day" }, false);
    await this.flush();
  }

  private enqueue(event: AnonymousCountEvent, once: boolean): Promise<void> {
    return this.serial(async () => {
      const state = await this.load();
      if (once) {
        const kind = event.type as OnceEvent;
        if (state.recorded[kind]) return;
        state.recorded[kind] = true;
      } else {
        const today = localDay();
        if (state.lastActiveDay === today) return;
        state.lastActiveDay = today;
        if (state.queue.length >= MAX_QUEUE) {
          await this.save(state);
          return;
        }
      }
      state.queue.push({ eventId: randomUUID(), occurredAtMs: Date.now(), event });
      await this.save(state);
    });
  }

  async flush(): Promise<void> {
    if (this.sending || !this.active()) return;
    const currentPlatform = platform();
    if (!currentPlatform) return;
    this.sending = true;
    let release: string | undefined;
    try {
      while (this.active()) {
        const state = await this.serial(() => this.load());
        const events = state.queue.slice(0, ANONYMOUS_COUNTS_MAX_EVENTS);
        if (events.length === 0) return;
        release ??= await releaseLabel(this.options.getStellaAppDir?.());
        const batch: AnonymousCountsBatch = {
          schemaVersion: ANONYMOUS_COUNTS_SCHEMA_VERSION,
          environment: this.options.environment,
          installId: state.installId,
          release,
          platform: currentPlatform,
          events,
        };
        const outcome = await this.send(batch);
        if (outcome === "retry") return;
        const done = new Set(events.map((item) => item.eventId));
        await this.serial(async () => {
          const latest = await this.load();
          latest.queue = latest.queue.filter((item) => !done.has(item.eventId));
          await this.save(latest);
        });
      }
    } finally {
      this.sending = false;
    }
  }

  /** "sent" on 2xx; "drop" on a rejected batch (it would never pass); "retry" otherwise. */
  private async send(batch: AnonymousCountsBatch): Promise<"sent" | "drop" | "retry"> {
    const endpoint =
      process.env.STELLA_ANONYMOUS_COUNTS_ENDPOINT?.trim() ||
      ANONYMOUS_COUNTS_ENDPOINTS[this.options.environment];
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (response.ok) return "sent";
      if (response.status === 429 || response.status >= 500) return "retry";
      return "drop";
    } catch {
      return "retry";
    }
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.chain.then(work, work);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async load(): Promise<CountsState> {
    if (this.state) return this.state;
    let parsed: Partial<CountsState> | null = null;
    try {
      parsed = JSON.parse(await readFile(this.statePath, "utf8")) as Partial<CountsState>;
    } catch {
      parsed = null;
    }
    const state: CountsState = {
      installId: isAnonymousCountsInstallId(parsed?.installId)
        ? parsed.installId
        : randomUUID(),
      recorded:
        parsed?.recorded && typeof parsed.recorded === "object" ? parsed.recorded : {},
      lastActiveDay:
        typeof parsed?.lastActiveDay === "string" ? parsed.lastActiveDay : null,
      queue: Array.isArray(parsed?.queue) ? parsed.queue.slice(-MAX_QUEUE) : [],
    };
    this.state = state;
    if (!parsed) await this.save(state);
    return state;
  }

  private async save(state: CountsState): Promise<void> {
    this.state = state;
    await mkdir(path.dirname(this.statePath), { recursive: true });
    const temporary = `${this.statePath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
    await rename(temporary, this.statePath);
  }
}
