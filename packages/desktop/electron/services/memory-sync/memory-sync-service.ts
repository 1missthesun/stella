import {
  promises as fs,
  unwatchFile,
  watch,
  watchFile,
  type FSWatcher,
  type Stats,
} from "node:fs";
import path from "node:path";

import {
  BackendClient,
  BackendRequestError,
} from "@stella/contracts/backend/client";
import type { MemorySyncListing } from "@stella/contracts/backend/home";
import type {
  MemorySyncEraseResult,
  MemorySyncFailure,
  MemorySyncStatus,
} from "@stella/contracts/desktop/memory-sync";
import {
  MEMORIES_DIR,
  PERSONALITY_FILE,
} from "@stella/runtime/kernel/memory/memory-layout.js";
import { tokenSubject } from "../engine-account-access.js";
import { LocalMemoryFiles, sha256Hex } from "./local-memory-files.js";
import { memoryMergeBrief, type MemoryMerge } from "./memory-merge-brief.js";
import {
  planMemorySync,
  type MemorySyncAction,
  type SyncedPair,
} from "./memory-sync-plan.js";

const STATE_DIR = "memory-sync";
const STATE_FILE = "state.json";
const CONFLICTS_DIR = "conflicts";

const PERIODIC_MS = 3 * 60_000;
const FOCUS_MIN_GAP_MS = 30_000;
const LOCAL_DEBOUNCE_MS = 1_500;
const POLL_MS = 2_000;
const SIGN_IN_DELAY_MS = 1_000;
const UNSETTLED_RETRY_MS = 5_000;
const UNSETTLED_RETRIES = 3;
const ERROR_RETRY_MIN_MS = 60_000;
const ERROR_RETRY_MAX_MS = 30 * 60_000;
const NOT_READY_RETRY_MS = 30_000;
const MERGE_SHOWN_MS = 24 * 60 * 60_000;

type PendingMerge = MemoryMerge & { dispatchedAt: number | null };

type SyncState = {
  version: 1;
  owner: string | null;
  epoch: string | null;
  files: Record<string, SyncedPair>;
  refused: Record<string, string>;
  merges: PendingMerge[];
  lastSyncedAt: number | null;
};

const emptyState = (): SyncState => ({
  version: 1,
  owner: null,
  epoch: null,
  files: {},
  refused: {},
  merges: [],
  lastSyncedAt: null,
});

const isPair = (value: unknown): value is SyncedPair =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as SyncedPair).local === "string" &&
  typeof (value as SyncedPair).cloud === "string";

const parseState = (raw: string): SyncState => {
  const value = JSON.parse(raw) as Partial<SyncState>;
  if (value.version !== 1) return emptyState();
  const files: Record<string, SyncedPair> = {};
  for (const [file, pair] of Object.entries(value.files ?? {})) {
    if (isPair(pair)) files[file] = { local: pair.local, cloud: pair.cloud };
  }
  const refused: Record<string, string> = {};
  for (const [file, sha] of Object.entries(value.refused ?? {})) {
    if (typeof sha === "string") refused[file] = sha;
  }
  return {
    version: 1,
    owner: typeof value.owner === "string" ? value.owner : null,
    epoch: typeof value.epoch === "string" ? value.epoch : null,
    files,
    refused,
    merges: Array.isArray(value.merges)
      ? value.merges.filter(
          (merge): merge is PendingMerge =>
            typeof merge?.path === "string" && typeof merge.copy === "string",
        )
      : [],
    lastSyncedAt:
      typeof value.lastSyncedAt === "number" ? value.lastSyncedAt : null,
  };
};

const STOP_REASONS = new Set([
  "CLOUD_MEMORY_OFF",
  "CLOUD_MEMORY_WIPE_ACTIVE",
  "CLOUD_MEMORY_EPOCH_STALE",
  "CLOUD_MEMORY_REIMPORT_REQUIRED",
  "MEMORY_POLICY_CHANGING",
]);

class PassStopped extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

type FailureDetail = Omit<MemorySyncFailure, "retryAt">;

class PassFailed extends Error {
  constructor(
    readonly failure: FailureDetail,
    readonly retryAfterMs?: number,
  ) {
    super(failure.message);
  }
}

const PASS_WIDE_CODES = new Set([
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "RATE_LIMITED",
  "UNAVAILABLE",
]);

const stepOf = (kind: MemorySyncAction["kind"]): MemorySyncFailure["step"] => {
  switch (kind) {
    case "push":
      return "write";
    case "pull":
    case "conflict":
      return "read";
    case "deleteCloud":
      return "delete";
    default:
      return "local";
  }
};

const failureOf = (
  step: MemorySyncFailure["step"],
  files: string[],
  error: unknown,
): FailureDetail => ({
  step,
  files,
  code:
    error instanceof BackendRequestError
      ? error.reason ?? error.code
      : error instanceof Error && "code" in error && typeof error.code === "string"
        ? error.code
        : null,
  message: error instanceof Error ? error.message : String(error),
});

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type MemorySyncServiceOptions = {
  stellaDataDir: string;
  getBackendUrl: () => string | null;
  getAuthToken: () => Promise<string | null>;
  hasConnectedAccount: () => boolean;
  dispatchAgentBrief: (brief: {
    description: string;
    prompt: string;
  }) => Promise<void>;
  broadcast: (status: MemorySyncStatus) => void;
  log?: (event: string, data?: Record<string, unknown>) => void;
};

export class MemorySyncService {
  private readonly local: LocalMemoryFiles;
  private readonly stateDir: string;
  private client: { baseUrl: string; value: BackendClient } | null = null;
  private subject: string | null = null;
  private status: MemorySyncStatus = {
    phase: "signed_out",
    lastSyncedAt: null,
    merging: 0,
    refused: [],
  };
  private pendingMode: "full" | "local" | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dueAt = 0;
  private periodic: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;
  private rerun = false;
  private unsettledRuns = 0;
  private failedPasses = 0;
  private retryNotBefore = 0;
  private lastFullPassAt = 0;
  private polled: Array<() => void> = [];
  private memoriesWatcher: FSWatcher | null = null;
  private disposed = false;
  private passSubject: string | null = null;

  constructor(private readonly options: MemorySyncServiceOptions) {
    this.local = new LocalMemoryFiles(options.stellaDataDir);
    this.stateDir = path.join(options.stellaDataDir, STATE_DIR);
  }

  getStatus(): MemorySyncStatus {
    return this.status;
  }

  noteAuthToken(token: string | null): void {
    const next = tokenSubject(token);
    if (next === this.subject || this.disposed) return;
    this.subject = next;
    this.failedPasses = 0;
    this.retryNotBefore = 0;
    if (!next) {
      this.stop();
      this.publish({ phase: "signed_out", merging: 0, refused: [] });
      return;
    }
    this.start();
    this.request("full", SIGN_IN_DELAY_MS);
  }

  noteWindowFocus(): void {
    if (!this.subject || Date.now() - this.lastFullPassAt < FOCUS_MIN_GAP_MS) {
      return;
    }
    this.request("full", 0);
  }

  async syncNow(): Promise<MemorySyncStatus> {
    await this.running?.catch(() => undefined);
    this.request("full", 0);
    this.kick();
    await this.running?.catch(() => undefined);
    return this.status;
  }

  async eraseLocal(): Promise<MemorySyncEraseResult> {
    await this.running?.catch(() => undefined);
    if (this.status.phase !== "held" || this.status.heldReason !== "wiped") {
      return { ok: false, error: "This computer's memory is not on hold." };
    }
    const work = (async () => {
      const files = await this.local.scan();
      for (const relative of files.keys()) {
        await fs.rm(this.local.absolute(relative), { force: true });
      }
      const state = await this.loadState();
      await this.saveState({ ...emptyState(), owner: state.owner });
      this.log("memory_sync.erased_local", { files: files.size });
    })();
    this.running = work.catch(() => undefined);
    try {
      await work;
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.running = null;
    }
    await this.syncNow();
    return { ok: true };
  }

  async flush(timeoutMs: number): Promise<void> {
    if (!this.subject || !(await this.hasUnsyncedEdits())) return;
    this.pendingMode ??= "local";
    this.kick();
    const running = this.running;
    if (!running) return;
    await Promise.race([
      running.catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }

  private async hasUnsyncedEdits(): Promise<boolean> {
    try {
      const [state, local] = await Promise.all([this.loadState(), this.local.scan()]);
      if (state.owner !== null && state.owner !== this.subject) return false;
      return state.epoch === null ? local.size > 0 : !this.matchesState(state, local);
    } catch {
      return true;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.client?.value.dispose();
    this.client = null;
  }

  private start(): void {
    if (!this.periodic) {
      this.periodic = setInterval(
        () => this.request("full", 0),
        PERIODIC_MS,
      );
    }
    if (this.polled.length === 0) this.watchFiles();
  }

  private stop(): void {
    if (this.periodic) clearInterval(this.periodic);
    this.periodic = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pendingMode = null;
    for (const unwatch of this.polled) unwatch();
    this.polled = [];
    this.memoriesWatcher?.close();
    this.memoriesWatcher = null;
  }

  private watchFiles(): void {
    const onChange = () => this.request("local", LOCAL_DEBOUNCE_MS);
    const memoriesDir = path.join(this.options.stellaDataDir, MEMORIES_DIR);
    const watchMemories = () => {
      if (this.memoriesWatcher) return;
      try {
        this.memoriesWatcher = watch(memoriesDir, { recursive: true }, onChange);
        this.memoriesWatcher.on("error", () => {
          this.memoriesWatcher?.close();
          this.memoriesWatcher = null;
        });
      } catch {
        // No memories/ yet; polling attaches the watcher when it appears.
      }
    };
    const poll = (file: string, changed: (exists: boolean) => void) => {
      const listener = (current: Stats, previous: Stats) => {
        if (
          current.ino !== previous.ino ||
          current.mtimeMs !== previous.mtimeMs ||
          current.size !== previous.size
        ) {
          changed(current.ino !== 0);
        }
      };
      watchFile(file, { interval: POLL_MS, persistent: false }, listener);
      this.polled.push(() => unwatchFile(file, listener));
    };
    poll(path.join(this.options.stellaDataDir, PERSONALITY_FILE), onChange);
    poll(memoriesDir, (exists) => {
      if (exists) watchMemories();
      else {
        this.memoriesWatcher?.close();
        this.memoriesWatcher = null;
      }
      onChange();
    });
    watchMemories();
  }

  private request(mode: "full" | "local", delayMs: number): void {
    if (this.disposed || !this.subject) return;
    if (mode === "full") {
      delayMs = Math.max(delayMs, this.retryNotBefore - Date.now());
    }
    const due = Date.now() + delayMs;
    const debounce = mode === "local" && this.pendingMode === "local";
    this.pendingMode =
      mode === "full" || this.pendingMode === "full" ? "full" : "local";
    if (this.timer !== null && !debounce && this.dueAt <= due) return;
    if (this.timer) clearTimeout(this.timer);
    this.dueAt = due;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.kick();
    }, delayMs);
  }

  private kick(): void {
    if (this.running) {
      this.rerun = true;
      return;
    }
    const mode = this.pendingMode;
    this.pendingMode = null;
    if (!mode || this.disposed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.running = this.pass(mode)
      .catch((error: unknown) => {
        if (!(error instanceof PassStopped)) throw error;
        this.log("memory_sync.stopped", { reason: error.reason });
        this.request("full", UNSETTLED_RETRY_MS);
      })
      .catch((error: unknown) => this.failed(error))
      .finally(() => {
        this.passSubject = null;
        this.running = null;
        if (this.rerun) {
          this.rerun = false;
          this.kick();
        }
      });
  }

  private backend(): BackendClient | null {
    const baseUrl = this.options.getBackendUrl();
    if (!baseUrl) return null;
    if (this.client?.baseUrl !== baseUrl) {
      this.client?.value.dispose();
      this.client = {
        baseUrl,
        value: new BackendClient({
          baseUrl,
          getToken: async () => {
            const token = await this.options.getAuthToken();
            if (!this.passSubject || tokenSubject(token) !== this.passSubject) {
              throw new PassStopped("ACCOUNT_CHANGED");
            }
            return token;
          },
        }),
      };
    }
    return this.client.value;
  }

  private async pass(mode: "full" | "local"): Promise<void> {
    const subject = this.subject;
    const backend = this.backend();
    if (!subject || !backend || !this.options.hasConnectedAccount()) {
      this.publish({ phase: "signed_out", merging: 0, refused: [] });
      if (subject) this.request("full", NOT_READY_RETRY_MS);
      return;
    }
    this.passSubject = subject;
    let state = await this.loadState();
    if (state.owner !== null && state.owner !== subject) {
      this.publish({ phase: "held", heldReason: "other_account" });
      return;
    }
    const local = await this.local.scan();
    if (
      mode === "local" &&
      state.epoch !== null &&
      this.matchesState(state, local)
    ) {
      return;
    }

    let listing: MemorySyncListing;
    try {
      listing = await backend.call("memory.files.list", {});
    } catch (error) {
      if (error instanceof PassStopped) throw error;
      const reason = error instanceof BackendRequestError ? error.reason : "";
      if (reason && STOP_REASONS.has(reason)) {
        this.publish({ phase: "off" });
        return;
      }
      throw new PassFailed(
        failureOf("list", [], error),
        error instanceof BackendRequestError ? error.retryAfterMs : undefined,
      );
    }
    this.lastFullPassAt = Date.now();

    const inEpoch = state.owner === subject && state.epoch === listing.memoryEpoch;
    const importing = !inEpoch && local.size > 0;
    if (importing && listing.importDisposition === "explicit_required") {
      this.publish({ phase: "held", heldReason: "wiped" });
      return;
    }
    if (!inEpoch) {
      state = { ...emptyState(), owner: subject, lastSyncedAt: state.lastSyncedAt };
    }

    const cloud = new Map(listing.files.map((file) => [file.path, file.sha]));
    const files: Record<string, SyncedPair> = { ...state.files };
    const refused: Record<string, string> = {};
    for (const [file, sha] of Object.entries(state.refused)) {
      if (local.get(file) === sha) refused[file] = sha;
    }
    const merges = [...state.merges];
    const actions = planMemorySync(state.files, local, cloud).filter(
      (action) =>
        action.kind !== "push" || refused[action.path] !== action.localSha,
    );
    if (actions.length > 0) this.publish({ phase: "syncing" });
    const context = {
      backend,
      epoch: listing.memoryEpoch,
      importing,
      files,
      refused,
      merges,
    };
    let settled = true;
    const failed: Array<{ path: string; error: unknown }> = [];
    let failedStep: MemorySyncFailure["step"] | null = null;
    try {
      for (const action of actions) {
        try {
          if (!(await this.apply(action, context))) settled = false;
        } catch (error) {
          if (error instanceof PassStopped) throw error;
          const step = stepOf(action.kind);
          const perFile =
            step === "local" ||
            (error instanceof BackendRequestError &&
              !PASS_WIDE_CODES.has(error.code));
          if (!perFile) {
            throw new PassFailed(
              failureOf(step, [action.path], error),
              error instanceof BackendRequestError
                ? error.retryAfterMs
                : undefined,
            );
          }
          failed.push({ path: action.path, error });
          failedStep ??= step;
          const detail = failureOf(step, [], error);
          this.log("memory_sync.file_failed", {
            path: action.path,
            step,
            code: detail.code,
            message: detail.message,
          });
        }
      }
    } catch (error) {
      if (error instanceof PassStopped) {
        await this.saveState({ ...state, files, refused, merges });
        this.log("memory_sync.stopped", { reason: error.reason });
        this.request("full", UNSETTLED_RETRY_MS);
        return;
      }
      await this.saveState({ ...state, files, refused, merges });
      throw error;
    }

    state = {
      ...state,
      owner: subject,
      epoch: listing.memoryEpoch,
      files,
      refused,
      merges: await this.handOffMerges(merges),
      lastSyncedAt:
        settled && failed.length === 0 ? Date.now() : state.lastSyncedAt,
    };
    await this.saveState(state);
    if (failed.length > 0) {
      throw new PassFailed(
        failureOf(
          failedStep ?? "local",
          failed.map((entry) => entry.path),
          failed[0]!.error,
        ),
      );
    }
    this.failedPasses = 0;
    this.retryNotBefore = 0;
    this.publish({
      phase: "synced",
      lastSyncedAt: state.lastSyncedAt,
      merging: state.merges.length,
      refused: Object.keys(refused).sort(),
    });
    if (settled) {
      this.unsettledRuns = 0;
    } else if (this.unsettledRuns < UNSETTLED_RETRIES) {
      this.unsettledRuns += 1;
      this.request("full", UNSETTLED_RETRY_MS);
    }
  }

  private failed(error: unknown): void {
    const detail =
      error instanceof PassFailed ? error.failure : failureOf("local", [], error);
    const backoff = Math.min(
      ERROR_RETRY_MAX_MS,
      ERROR_RETRY_MIN_MS * 2 ** Math.min(this.failedPasses, 10),
    );
    const delay = Math.max(
      backoff,
      error instanceof PassFailed ? error.retryAfterMs ?? 0 : 0,
    );
    this.failedPasses += 1;
    const retryAt = Date.now() + delay;
    this.retryNotBefore = retryAt;
    this.log("memory_sync.failed", {
      step: detail.step,
      files: detail.files.join(","),
      code: detail.code,
      message: detail.message,
      attempt: this.failedPasses,
      retryInMs: delay,
    });
    this.publish({ phase: "error", failure: { ...detail, retryAt } });
    this.request("full", delay);
  }

  private matchesState(state: SyncState, local: Map<string, string>): boolean {
    if (Object.keys(state.files).some((file) => !local.has(file))) {
      return false;
    }
    for (const [file, sha] of local) {
      if (state.files[file]?.local !== sha && state.refused[file] !== sha) {
        return false;
      }
    }
    return true;
  }

  private async callCloud<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (
        error instanceof BackendRequestError &&
        error.reason &&
        STOP_REASONS.has(error.reason)
      ) {
        throw new PassStopped(error.reason);
      }
      throw error;
    }
  }

  private async apply(
    action: MemorySyncAction,
    context: {
      backend: BackendClient;
      epoch: string;
      importing: boolean;
      files: Record<string, SyncedPair>;
      refused: Record<string, string>;
      merges: PendingMerge[];
    },
  ): Promise<boolean> {
    const { backend, epoch, files } = context;
    const fence = { expectedMemoryEpoch: epoch };
    switch (action.kind) {
      case "record":
        files[action.path] = action.pair;
        return true;
      case "forget":
        delete files[action.path];
        return true;
      case "push": {
        const bytes = await this.local.read(action.path);
        if (bytes === null || sha256Hex(bytes) !== action.localSha) return false;
        try {
          const outcome = await this.callCloud(() =>
            backend.call("memory.files.write", {
              ...fence,
              path: action.path,
              content: decoder.decode(bytes),
              expectSha: action.expectCloud,
              importing: context.importing,
            }),
          );
          if (outcome.status === "conflict") return false;
          files[action.path] = { local: action.localSha, cloud: outcome.sha };
          delete context.refused[action.path];
          return true;
        } catch (error) {
          if (
            error instanceof BackendRequestError &&
            error.reason === "CLOUD_MEMORY_FILE_REFUSED"
          ) {
            context.refused[action.path] = action.localSha;
            this.log("memory_sync.refused", { path: action.path });
            return true;
          }
          throw error;
        }
      }
      case "pull": {
        const remote = await this.callCloud(() =>
          backend.call("memory.files.read", { ...fence, path: action.path }),
        );
        if (remote === null) return false;
        const bytes = encoder.encode(remote.content);
        if (!(await this.local.write(action.path, bytes, action.expectLocal))) {
          return false;
        }
        files[action.path] = { local: sha256Hex(bytes), cloud: remote.sha };
        return true;
      }
      case "deleteCloud": {
        const outcome = await this.callCloud(() =>
          backend.call("memory.files.delete", {
            ...fence,
            path: action.path,
            expectSha: action.expectCloud,
          }),
        );
        if (outcome.status === "conflict") return false;
        delete files[action.path];
        return true;
      }
      case "deleteLocal":
        if (!(await this.local.remove(action.path, action.expectLocal))) {
          return false;
        }
        delete files[action.path];
        return true;
      case "conflict": {
        const remote = await this.callCloud(() =>
          backend.call("memory.files.read", { ...fence, path: action.path }),
        );
        const mine = await this.local.read(action.path);
        if (remote === null || mine === null || sha256Hex(mine) !== action.localSha) {
          return false;
        }
        if (remote.sha === action.localSha) {
          files[action.path] = { local: action.localSha, cloud: remote.sha };
          return true;
        }
        const copy = await this.saveConflictCopy(action.path, mine);
        const bytes = encoder.encode(remote.content);
        if (!(await this.local.write(action.path, bytes, action.localSha))) {
          await fs.rm(copy, { force: true }).catch(() => undefined);
          return false;
        }
        files[action.path] = { local: sha256Hex(bytes), cloud: remote.sha };
        context.merges.push({ path: action.path, copy, dispatchedAt: null });
        this.log("memory_sync.conflict", { path: action.path });
        return true;
      }
    }
  }

  private async saveConflictCopy(
    relative: string,
    bytes: Uint8Array,
  ): Promise<string> {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const copy = path.join(
      this.stateDir,
      CONFLICTS_DIR,
      stamp,
      ...relative.split("/"),
    );
    await fs.mkdir(path.dirname(copy), { recursive: true });
    await fs.writeFile(copy, bytes, { mode: 0o600 });
    return copy;
  }

  private async handOffMerges(merges: PendingMerge[]): Promise<PendingMerge[]> {
    const now = Date.now();
    const live: PendingMerge[] = [];
    for (const merge of merges) {
      const exists = await fs
        .stat(merge.copy)
        .then(() => true)
        .catch(() => false);
      if (!exists) continue;
      if (merge.dispatchedAt !== null && now - merge.dispatchedAt > MERGE_SHOWN_MS) {
        continue;
      }
      live.push(merge);
    }
    const waiting = live.filter((merge) => merge.dispatchedAt === null);
    if (waiting.length === 0) return live;
    try {
      await this.options.dispatchAgentBrief(
        memoryMergeBrief(this.options.stellaDataDir, waiting),
      );
      for (const merge of waiting) merge.dispatchedAt = now;
      this.log("memory_sync.merge_dispatched", { files: waiting.length });
    } catch (error) {
      this.log("memory_sync.merge_dispatch_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return live;
  }

  private async loadState(): Promise<SyncState> {
    try {
      return parseState(
        await fs.readFile(path.join(this.stateDir, STATE_FILE), "utf8"),
      );
    } catch {
      return emptyState();
    }
  }

  private async saveState(state: SyncState): Promise<void> {
    await fs.mkdir(this.stateDir, { recursive: true });
    const file = path.join(this.stateDir, STATE_FILE);
    const temporary = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      mode: 0o600,
    });
    await fs.rename(temporary, file);
  }

  private publish(patch: Partial<MemorySyncStatus>): void {
    const next: MemorySyncStatus = { ...this.status, ...patch };
    if (next.phase !== "held") delete next.heldReason;
    if (next.phase !== "error") delete next.failure;
    if (JSON.stringify(next) === JSON.stringify(this.status)) return;
    this.status = next;
    this.options.broadcast(next);
  }

  private log(event: string, data?: Record<string, unknown>): void {
    this.options.log?.(event, data);
  }
}
