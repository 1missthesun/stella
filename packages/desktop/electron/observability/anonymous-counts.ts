import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ANONYMOUS_COUNTS_ENABLED,
  ANONYMOUS_COUNTS_ENDPOINTS,
  ANONYMOUS_COUNTS_MAX_EVENTS,
  ANONYMOUS_COUNTS_SCHEMA_VERSION,
  ANONYMOUS_COUNT_PLATFORMS,
  DAY1_MESSAGE_CAP,
  TURN_ERRORS_PER_DAY,
  isAnonymousCountsInstallId,
  isFoundViaChoice,
  isSetupStep,
  isTurnErrorKind,
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
} from "@stella/node-shared/preferences/local-preferences";
import { releaseLabel } from "./release-info.js";

type CountsState = {
  installId: string;
  /** Once-only events already counted: the event type, or `setup_step:<step>`. */
  recorded: Record<string, true>;
  lastActiveDay: string | null;
  /** When this install's first run was counted; unset for installs counted before day-1 messages existed. */
  firstRunAtMs?: number;
  day1Messages?: number;
  turnErrorDay?: string;
  turnErrorsThatDay?: number;
  queue: AnonymousCountItem[];
};

const DAY_MS = 24 * 60 * 60_000;

const onceKey = (event: AnonymousCountEvent): string | null => {
  switch (event.type) {
    case "first_run":
    case "engine_chosen":
    case "first_reply":
    case "found_via":
      return event.type;
    case "setup_step":
      return `setup_step:${event.step}`;
    default:
      return null;
  }
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
    await this.ensureFirstRun();
    const queued = await this.resolve(request);
    if (!queued) return;
    void this.flush();
  }

  private async engine(): Promise<AnonymousCountEngine> {
    return classifyAnonymousCountEngine(
      this.options.stellaDataDirPath,
      await this.options.isSignedIn().catch(() => false),
    );
  }

  private async resolve(request: AnonymousCountRequest): Promise<boolean> {
    switch (request?.type) {
      case "engine_chosen":
      case "first_reply":
        return await this.enqueueOnce({ type: request.type, engine: await this.engine() });
      case "found_via":
        return isFoundViaChoice(request.answer)
          ? await this.enqueueOnce({ type: "found_via", answer: request.answer })
          : false;
      case "setup_step":
        return isSetupStep(request.step)
          ? await this.enqueueOnce({ type: "setup_step", step: request.step })
          : false;
      case "message_sent": {
        const engine = await this.engine();
        return await this.enqueueWhen((state) => {
          const firstRunAt = state.firstRunAtMs;
          if (firstRunAt === undefined || Date.now() - firstRunAt > DAY_MS) return null;
          const n = (state.day1Messages ?? 0) + 1;
          if (n > DAY1_MESSAGE_CAP) return null;
          state.day1Messages = n;
          return { type: "day1_message", n, engine };
        });
      }
      case "turn_error": {
        if (!isTurnErrorKind(request.kind)) return false;
        const kind = request.kind;
        const engine = await this.engine();
        return await this.enqueueWhen((state) => {
          const today = localDay();
          const count = state.turnErrorDay === today ? (state.turnErrorsThatDay ?? 0) : 0;
          if (count >= TURN_ERRORS_PER_DAY) return null;
          state.turnErrorDay = today;
          state.turnErrorsThatDay = count + 1;
          return { type: "turn_error", kind, engine };
        });
      }
      default:
        return false;
    }
  }

  private async ensureFirstRun(): Promise<void> {
    await this.enqueueOnce({
      type: "first_run",
      existingInstall: getOnboardingCompleted(this.options.stellaDataDirPath),
    });
  }

  private async tick(): Promise<void> {
    if (!this.active()) return;
    await this.ensureFirstRun();
    await this.enqueueWhen((state) => {
      const today = localDay();
      if (state.lastActiveDay === today) return null;
      state.lastActiveDay = today;
      return { type: "active_day" };
    });
    await this.flush();
  }

  private enqueueOnce(event: AnonymousCountEvent): Promise<boolean> {
    return this.enqueueWhen((state) => {
      const key = onceKey(event);
      if (!key || state.recorded[key]) return null;
      state.recorded[key] = true;
      if (event.type === "first_run" && !event.existingInstall) state.firstRunAtMs = Date.now();
      return event;
    });
  }

  /** `decide` may update the state; the event it returns is queued (a repeating one is dropped when the queue is full). */
  private enqueueWhen(
    decide: (state: CountsState) => AnonymousCountEvent | null,
  ): Promise<boolean> {
    return this.serial(async () => {
      const state = await this.load();
      const event = decide(state);
      if (!event) return false;
      if (state.queue.length < MAX_QUEUE || onceKey(event) !== null) {
        state.queue.push({ eventId: randomUUID(), occurredAtMs: Date.now(), event });
      }
      await this.save(state);
      return true;
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
      ...(typeof parsed?.firstRunAtMs === "number" ? { firstRunAtMs: parsed.firstRunAtMs } : {}),
      ...(typeof parsed?.day1Messages === "number" ? { day1Messages: parsed.day1Messages } : {}),
      ...(typeof parsed?.turnErrorDay === "string" ? { turnErrorDay: parsed.turnErrorDay } : {}),
      ...(typeof parsed?.turnErrorsThatDay === "number"
        ? { turnErrorsThatDay: parsed.turnErrorsThatDay }
        : {}),
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
