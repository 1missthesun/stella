import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { app } from "electron";
import {
  BackendClient,
  BackendRequestError,
} from "@stella/contracts/backend/client";
import {
  UPDATE_PREPARER_STALE_MS,
  updateResultTag,
  type AppSourceRemote,
  type AppSourceUpdate,
} from "@stella/contracts/backend/app-source";
import type {
  AppSourceActionResult,
  AppSourceFailure,
  AppSourceCommit,
  AppSourceConflicts,
  AppSourceDraftOffer,
  AppSourceState,
  AppSourceWaiting,
} from "@stella/contracts/desktop/app-source";
import {
  isStellaDraft,
  isUpdateDraft,
} from "@stella/contracts/desktop/app-source";
import {
  DRAFT_REF_PREFIX,
  git,
  gitRaw,
  isAncestor,
  isDraftName,
  listWorktrees,
  run,
} from "./git.js";
import { removeWorktree } from "./dir-links.js";
import { DRAFT_AGENTS_DIR, installCheckoutGuard } from "./checkout-guard.js";
import { ReleaseChannel } from "./release-channel.js";
import {
  MERGE_WAIT_MS,
  classifyMerge,
  isMerging,
  readMergeRecord,
  writeMergeRecord,
  type DispatchedAgent,
  type MergeRecord,
  type MergeStatus,
} from "./merge-record.js";
import { tokenSubject } from "../engine-account-access.js";
import type { CoveredWindow, RelaunchHold } from "./update-transition.js";
import type { RendererApplyOutcome } from "../../source/renderer-protocol.js";
import {
  classifyUpdate,
  conflictedPaths,
  installs,
  interfaceOnly,
  relaunches,
  restartsRuntime,
  type UpdatePlan,
} from "./update-plan.js";
import {
  buildOnScratch,
  checkMergedUpdate,
  prebuildElectronBundles,
  prepareInstallAhead,
} from "./update-gate.js";
import {
  UpdatePreparer,
  type PrepareJob,
  type PreparedUpdate,
  type ResolveLevel,
} from "./update-prepare.js";
import type { ModelResolve } from "./update-merge.js";
import {
  readIntent,
  writeIntent,
  WANTED_MAX_AGE_MS,
  type UpdateIntent,
  type Wanted,
} from "./update-intent.js";
import {
  mergeDraftName,
  rejectedDraftNote,
  remoteMergeBrief,
  remoteMergeDraftName,
  staleDraftBrief,
  undoBrief,
  upstreamMergeBrief,
  type AgentBrief,
} from "./app-source-briefs.js";

type AppSourceServiceOptions = {
  stellaAppDir: string;
  broadcast: (state: AppSourceState) => void;
  isAnyWindowVisible: () => boolean;
  requestRuntimeRestart: () => void;
  applyRendererChanges: (
    paths: string[],
    options?: { reload?: boolean },
  ) => Promise<RendererApplyOutcome> | undefined;
  /** Milliseconds since the user last touched Stella; null when no window can say. */
  userQuietFor?: () => Promise<number | null>;
  /** The user is not looking at Stella or has left the computer. */
  isUserAway?: () => boolean;
  /** A screen recording or its finish card is open; a reload would end it. */
  recordingOpen?: () => boolean;
  /** Stella is mid-reply on this computer; a restart of the runtime would cut it off. */
  replying?: () => Promise<boolean>;
  relaunch: (options?: { keepRuntime?: boolean }) => void;
  hasConnectedAccount: () => boolean;
  getBackendUrl: () => string | null;
  getAuthToken: () => Promise<string | null>;
  log: (event: string, data: Record<string, unknown>) => void;
  onPushed?: (cwd: string) => void | Promise<void>;
  afterApply?: (cwd: string) => void | Promise<void>;
  beforeAction?: (cwd: string) => void | Promise<void>;
  coverRenderer?: () => Promise<CoveredWindow | null>;
  beforeRelaunch?: () => Promise<RelaunchHold | null>;
  launcherPreparesOnRelaunch?: boolean;
  reportPrepared?: (prepared: { lockHash?: string; head?: string }) => void;
  updateScratchDir: string;
  dispatchAgentBrief?: (brief: AgentBrief) => Promise<DispatchedAgent>;
  /** Sends `text` to the task `agentId`; false when it could not be reached. */
  tellAgent?: (agentId: string, messageId: string, text: string) => Promise<boolean>;
  /** null: the runtime can't be asked right now. */
  agentRunning?: (agent: DispatchedAgent) => Promise<boolean | null>;
  /** This computer's id on the account, once it has one. */
  getDeviceId?: () => string | null;
  /** A model that resolves merge conflicts without a task; spends the user's model use. */
  modelResolve?: ModelResolve;
};

type TakeSource = {
  kind: "upstream" | "remote" | "draft";
  ref: string;
  emptyMessage: string;
  subject: string;
  trustIdenticalTree: boolean;
  brief: (
    plan: Extract<UpdatePlan, { kind: "clean" | "conflict" }>,
    head: string,
    gateOutput?: string,
  ) => AgentBrief;
  pendingDraft: string;
  pendingDraftExists: boolean;
  settle?: (to: string) => Promise<void>;
  /** When a task has to draft it: the press it answers, so the draft is applied once it is ready. */
  wanted?: Wanted;
};

type ForkAccess = {
  remote: string;
  branch: string;
  token: string;
  expiresAt: number;
};

type SourceAccess = {
  owner: string | null;
  fork: ForkAccess | null;
  upstream: AppSourceRemote;
};

const STATE_POLL_MS = 10_000;
const AUTO_APPLY_QUIET_MS = 1_500;
const AUTO_APPLY_RETRY_MS = 500;
const SWAPS_BEFORE_RELOAD = 12;
const RELOAD_WHEN_AWAY_POLL_MS = 30_000;
const LAUNCH_SYNC_DELAY_MS = 5_000;
const SYNC_RETRY_MS = 30_000;
const SYNC_RETRY_MAX_MS = 10 * 60_000;
const RECENT_COUNT = 20;
type RecentRow = { commit: AppSourceCommit; base: string };
type HeadMove = { from: string; at: number };
type Share =
  | { kind: "merge"; merge: string }
  | { kind: "nothing" }
  | { kind: "conflict" }
  | { kind: "build" };
const SKIPPED_FILE = "stella-updates-skipped.json";
const UPSTREAM_MERGE_SUBJECT = "Merge the published Stella update";
const REMOTE_MERGE_SUBJECT = "Merge the changes from another computer";
const CATCH_UP_SUBJECT = "Catch up with Stella on your other computers";
const SKIP_KEY = /^(version|other|draft):[0-9a-f]{40}([0-9a-f]{24})?$/;
const FORK_REF_PREFIX = "refs/remotes/stella-fork/";
const UPSTREAM_REF = "refs/remotes/stella-upstream/main";
const COMMIT_AGENTS_DIR = "stella-commits";
const CHANGE_TAG = "stella-change/";
const CHANGE_TAG_PREFIX = `refs/tags/${CHANGE_TAG}`;
const FORK_CHANGES_PREFIX = "refs/stella/fork-changes/";
const BOOTSTRAP_PATH = "/api/app-source/bootstrap";
const RESULT_REF = "refs/stella/update-result";
/** Where a fetch lands first: the tracked ref only moves to history this checkout shares. */
const INCOMING_REF = "refs/stella/incoming";
/** How often a computer asks to be the one that merges a version in the background. */
const CLAIM_RETRY_MS = 5 * 60_000;
const PLAN_TTL_MS = 10 * 60_000;
const APPLY_ANNOUNCE_TIMEOUT_MS = 8_000;
const ACCESS_ATTEMPTS = 5;

const NO_UPSTREAM: AppSourceState["upstream"] = {
  status: "none",
  count: 0,
  subject: "",
};

const EMPTY_STATE: AppSourceState = {
  remote: { status: "none", count: 0 },
  upstream: NO_UPSTREAM,
  recent: [],
  waiting: [],
  skipped: [],
  busy: false,
};

type Offer = { tip: string; real: boolean; catchUp: boolean };

/** A failure Stella means to tell the user, by kind (the window words it). */
class PlainFailure extends Error {
  constructor(
    readonly reason: AppSourceFailure,
    message: string,
  ) {
    super(message);
  }
}

/** The windows could not show the change, and the checkout is back where it was. */
class RendererRejected extends Error {
  constructor(
    message: string,
    readonly detail: string,
  ) {
    super(message);
  }
}

type ApplyPhase = "planned" | "signed" | "holding" | "installed" | "relaunching";

type FoundDraft = Omit<AppSourceDraftOffer, "kind" | "key" | "adding" | "summary"> & {
  subject: string;
};

const deviceName = () =>
  hostname()
    .trim()
    .replace(/\.(local|localdomain|lan|home)$/i, "");

/** The name this computer is registered under on the account. */
const accountDeviceName = () => hostname().trim().slice(0, 96);

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const failureOf = (error: unknown): { reason: AppSourceFailure; detail?: string } =>
  error instanceof PlainFailure
    ? { reason: error.reason }
    : error instanceof RendererRejected
      ? { reason: "taken-back", detail: error.detail }
      : { reason: "unexpected", detail: errorMessage(error) };

/** Longest an update waits for a screen recording: past its 10-minute cap, building and its card. */
const RECORDING_HOLD_MAX_MS = 20 * 60_000;
/** Longest an update that restarts the runtime waits for Stella to finish her reply. */
const REPLY_HOLD_MAX_MS = 3 * 60_000;

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms).unref?.());

/**
 * Git config through the environment keeps the token out of argv.
 *
 * Fetches use protocol v2. Artifacts' v1 upload-pack answers a stateless
 * negotiation round with a bare "ACK <oid>" instead of multi_ack_detailed's
 * "ACK <oid> common", so git takes it as the final ACK, and the NAK the server
 * then puts before the pack fails as "bad band #78" (N). That happens whenever
 * a common commit turns up in a round before git runs out of haves (rounds
 * are 16+ haves), so any checkout with real history hits it. Pushes stay on
 * v1.
 */
const remoteEnv = (
  token: string,
  protocolVersion: "1" | "2",
): NodeJS.ProcessEnv => ({
  GIT_CONFIG_COUNT: "2",
  GIT_CONFIG_KEY_0: "http.extraHeader",
  GIT_CONFIG_VALUE_0: `Authorization: Bearer ${token}`,
  GIT_CONFIG_KEY_1: "protocol.version",
  GIT_CONFIG_VALUE_1: protocolVersion,
});
const fetchEnv = (token: string) => remoteEnv(token, "2");
const pushEnv = (token: string) => remoteEnv(token, "1");

export class AppSourceService {
  private readonly options: AppSourceServiceOptions;
  private state: AppSourceState = EMPTY_STATE;
  private publishedState = JSON.stringify(EMPTY_STATE);
  private queue: Promise<unknown> = Promise.resolve();
  private busy = false;
  private heldForRecording = false;
  private heldForReply = false;
  private refreshing: Promise<void> | null = null;
  private refreshAgain = false;
  private syncing = false;
  private syncWanted = false;
  private syncNotBefore = 0;
  private syncFailures = 0;
  private syncTimer: NodeJS.Timeout | null = null;
  private published: string | null = null;
  private syncedFor: string | null = null;
  private readonly releases: ReleaseChannel;
  private forkWatch: { baseUrl: string; stop: () => void } | null = null;
  private forkPushSeen: number | null = null;
  private readonly ownForkPushes = new Set<number>();
  private forkReports = 0;
  private forkPushHeld: number | null = null;
  private syncReason = "launch";
  private timers: NodeJS.Timeout[] = [];
  private backend: { baseUrl: string; client: BackendClient } | null = null;
  private access: SourceAccess | null = null;
  private forkBranch: string | null = null;
  private forkUnrelated = false;
  /**
   * Merges of this computer's changes with the account's copy, by
   * `${forkTip}:${head}`: the merge to push, or why none could be shared.
   */
  private shares = new Map<string, Share>();
  private notShared: "conflict" | "build" | null = null;
  private sharing = false;
  private shareAgain = false;
  private upstreamTracked = false;
  /** Whether this checkout is a linked worktree of another one; unknown until checked. */
  private linkedCheckout: boolean | null = null;
  private linkedCheck: Promise<void> | null = null;
  private merge: MergeRecord | null | undefined;
  private offers = new Map<string, Offer>();
  private catchingUp = false;
  private caughtUp = new Set<string>();
  private skipped: Set<string> | null = null;
  private offeredKeys: string[] = [];
  private disposed = false;
  private timeline: { last: number; startedAt: number; steps: string[] } | null =
    null;
  private readonly onFocus = () => void this.refresh();
  private readonly rejected = new Map<string, string>();
  private readonly autoTried = new Set<string>();
  private readonly toldTasks = new Set<string>();
  private autoTimer: NodeJS.Timeout | null = null;
  private reloadTimer: NodeJS.Timeout | null = null;
  private readonly preparer: UpdatePreparer;
  private update: AppSourceUpdate | null = null;
  private updateWatch: { baseUrl: string; stop: () => void } | null = null;
  private intent: UpdateIntent | null = null;
  private intentWrites: Promise<void> = Promise.resolve();
  private plan: { paid: boolean | null; at: number } | null = null;
  private readonly claimTried = new Map<string, number>();
  private readonly reported = new Set<string>();
  private fetchingResult: string | null = null;
  /** A shared merge result checked here and found to carry changes this checkout lacks. */
  private resultUnusable: string | null = null;
  private wantTimer: NodeJS.Timeout | null = null;
  /** The version whose merge is prepared and can be applied at once. */
  private versionReady: string | null = null;
  private versionConflicts: AppSourceConflicts | null = null;

  constructor(options: AppSourceServiceOptions) {
    this.options = options;
    this.preparer = new UpdatePreparer({
      cwd: options.stellaAppDir,
      root: `${options.updateScratchDir}-prepared`,
      scratch: `${options.updateScratchDir}-prepare`,
      log: options.log,
      onPrepared: () => void this.refresh(),
      model: () => options.modelResolve ?? null,
    });
    this.releases = new ReleaseChannel({
      onPublished: (version) => this.onPublished(version),
      log: (event, data) => options.log(event, data ?? {}),
    });
  }

  start() {
    if (this.disposed || this.timers.length > 0) return;
    app.on("browser-window-focus", this.onFocus);
    const poll = setInterval(() => {
      if (this.options.isAnyWindowVisible()) void this.refresh();
      this.followBackend();
      void this.followOwner();
      if (this.syncWanted && Date.now() >= this.syncNotBefore) void this.syncFork();
    }, STATE_POLL_MS);
    poll.unref?.();
    this.timers = [poll];
    this.syncNotBefore = Date.now() + LAUNCH_SYNC_DELAY_MS;
    this.wantSync("launch");
    void this.checkLinkedCheckout().then(() => this.followBackend());
    void installCheckoutGuard(this.options.stellaAppDir, this.options.log).catch(
      (error: unknown) =>
        this.options.log("app-source.checkout-guard-failed", {
          error: error instanceof Error ? error.message : String(error),
        }),
    );
    void this.rememberResolutions();
    void this.refresh();
  }

  /**
   * A linked worktree shares its main checkout's refs and git files, so a
   * Stella run from one (a test copy beside the installed app) would rewrite
   * the installed copy's view of its updates when it fetches, shares or
   * announces, even from another account or backend. Such a copy keeps to
   * itself: its drafts work, nothing is synced.
   */
  private checkLinkedCheckout(): Promise<void> {
    this.linkedCheck ??= this.readLinkedCheckout();
    return this.linkedCheck;
  }

  private async readLinkedCheckout() {
    const dirs = await gitRaw(this.options.stellaAppDir, [
      "rev-parse",
      "--path-format=absolute",
      "--git-dir",
      "--git-common-dir",
    ]).catch(() => null);
    const [gitDir = "", commonDir = ""] = dirs?.code === 0 ? dirs.stdout.trim().split("\n") : [];
    this.linkedCheckout = Boolean(gitDir && commonDir && path.resolve(gitDir) !== path.resolve(commonDir));
    if (this.linkedCheckout) this.options.log("app-source.linked-worktree", { commonDir });
  }

  /** The backend this checkout syncs its updates with; none for a linked worktree or before that is known. */
  private backendUrl(): string | null {
    return this.linkedCheckout === false ? this.options.getBackendUrl() : null;
  }

  /**
   * Every merge resolved in this checkout (by a task in a draft, or here) is
   * remembered by git, so the same conflict is never resolved twice.
   */
  private async rememberResolutions() {
    const cwd = this.options.stellaAppDir;
    const current = await gitRaw(cwd, ["config", "--get", "rerere.enabled"]).catch(() => null);
    if (!current || current.stdout.trim() !== "") return;
    await gitRaw(cwd, ["config", "rerere.enabled", "true"]).catch(() => undefined);
  }

  dispose() {
    this.disposed = true;
    this.preparer.pause();
    app.removeListener("browser-window-focus", this.onFocus);
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = null;
    if (this.autoTimer) clearTimeout(this.autoTimer);
    this.autoTimer = null;
    if (this.wantTimer) clearTimeout(this.wantTimer);
    this.wantTimer = null;
    this.updateWatch?.stop();
    this.updateWatch = null;
    if (this.reloadTimer) clearInterval(this.reloadTimer);
    this.reloadTimer = null;
    this.releases.dispose();
    this.forkWatch?.stop();
    this.forkWatch = null;
    this.backend?.client.dispose();
  }

  getState(): AppSourceState {
    void this.refresh();
    return this.state;
  }

  applyDraft(name: string) {
    return this.exclusive((cwd) => this.takeDraft(cwd, name));
  }

  private async takeDraft(cwd: string, name: string, after?: (to: string) => Promise<void>) {
    if (!isDraftName(name)) throw new PlainFailure("gone", "Unknown draft.");
    const ref = `${DRAFT_REF_PREFIX}${name}`;
    const [worktrees, subject] = await Promise.all([
      listWorktrees(cwd),
      git(cwd, ["log", "-1", "--format=%s", `${ref}^{commit}`]),
    ]);
    if (worktrees.some((tree) => tree.branch === ref)) {
      throw new PlainFailure("in-progress", `The draft "${name}" is still being worked on.`);
    }
    return await this.take(cwd, {
      kind: "draft",
      ref,
      emptyMessage: "That change is already in this version.",
      subject,
      trustIdenticalTree: false,
      brief: (plan, head, gateOutput) =>
        staleDraftBrief(plan, head, name, gateOutput),
      pendingDraft: name,
      pendingDraftExists: true,
      settle: async (to) => {
        const agentId = await this.agentOf(cwd, DRAFT_AGENTS_DIR, name);
        await git(cwd, ["branch", "-D", `draft/${name}`]);
        if (!isStellaDraft(name)) await this.rememberAgent(cwd, name, to);
        else if (agentId) await this.writeChange(cwd, to, agentId, false);
        await this.shareTaskMerge(name, to);
        await after?.(to);
      },
      wanted: { kind: "draft", name, at: Date.now() },
    });
  }

  private async rememberAgent(cwd: string, name: string, sha: string) {
    const from = path.join(await this.commonDir(cwd), DRAFT_AGENTS_DIR, name);
    const agentId = await this.agentOf(cwd, DRAFT_AGENTS_DIR, name);
    if (!agentId) return;
    await this.writeChange(cwd, sha, agentId, false);
    await fs.rm(from, { force: true });
    const tag = await gitRaw(
      cwd,
      [
        "tag",
        "--force",
        "--annotate",
        `--message=${deviceName()}`,
        `${CHANGE_TAG}${Buffer.from(agentId).toString("hex")}`,
        sha,
      ],
      { env: await this.identityEnv(cwd) },
    );
    if (tag.code !== 0) {
      this.options.log("app-source.change-tag-failed", { message: tag.stderr.trim() });
    }
  }

  private async writeChange(cwd: string, sha: string, agentId: string, undone: boolean) {
    const dir = path.join(await this.commonDir(cwd), COMMIT_AGENTS_DIR);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, sha), `${agentId}\n${undone ? "undone\n" : ""}`);
  }

  private async changeOf(cwd: string, sha: string) {
    const file = path.join(await this.commonDir(cwd), COMMIT_AGENTS_DIR, sha);
    const [agentId = "", flag = ""] = (await fs.readFile(file, "utf8").catch(() => ""))
      .split("\n")
      .map((line) => line.trim());
    return agentId ? { agentId, undone: flag === "undone" } : null;
  }

  private commonDirPath: string | null = null;
  private async commonDir(cwd: string) {
    this.commonDirPath ??= await git(cwd, [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ]);
    return this.commonDirPath;
  }

  private async agentOf(cwd: string, dir: string, key: string) {
    const file = path.join(await this.commonDir(cwd), dir, key);
    const agentId = (await fs.readFile(file, "utf8").catch(() => "")).trim();
    return agentId || undefined;
  }

  private async draftShape(cwd: string, head: string, sha: string) {
    const paths = (await git(cwd, ["diff", "--name-only", `${head}...${sha}`]))
      .split("\n")
      .filter(Boolean);
    const rejected = this.rejected.get(sha);
    return {
      files: paths.length,
      restart: relaunches(paths),
      interfaceOnly: interfaceOnly(paths),
      ...(rejected ? { problem: rejected } : {}),
    };
  }

  undo(sha: string) {
    return this.exclusive(async (cwd) => {
      if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha)) {
        throw new PlainFailure("gone", "Unknown change.");
      }
      const head = await git(cwd, ["rev-parse", "HEAD"]);
      if (!(await isAncestor(cwd, sha, head))) {
        throw new PlainFailure("gone", "That change is not part of the current version.");
      }
      const row = (await this.readRecent(cwd, await this.recentLog(cwd))).find(
        (entry) => entry.commit.sha === sha,
      );
      const base = row?.base ?? (await git(cwd, ["rev-parse", `${sha}^`]));
      const subject = await git(cwd, ["log", "-1", "--format=%s", sha]);
      const merge = await gitRaw(cwd, [
        "merge-tree",
        "--write-tree",
        "--merge-base",
        sha,
        head,
        base,
      ]);
      if (merge.code === 1) {
        return await this.dispatchUndo(
          cwd,
          { sha, base, subject, head, conflicts: conflictedPaths(merge.stdout) },
        );
      }
      if (merge.code !== 0) {
        throw new Error(merge.stderr.trim() || "Could not compute the undo.");
      }
      const tree = merge.stdout.split("\n")[0]!.trim();
      this.mark("plan");
      const revert = await git(
        cwd,
        ["commit-tree", tree, "-p", head, "-m", `Revert "${subject}"`],
        { env: await this.identityEnv(cwd) },
      );
      const gate = await checkMergedUpdate(
        cwd,
        revert,
        this.options.updateScratchDir,
        this.options.log,
      );
      this.mark("gate");
      if (!gate.ok) {
        return await this.dispatchUndo(cwd, {
          sha,
          base,
          subject,
          head,
          conflicts: [],
          buildOutput: gate.output,
        });
      }
      await this.swapIn(cwd, head, revert, async () => {
        const change = await this.changeOf(cwd, sha);
        if (change) await this.writeChange(cwd, revert, change.agentId, !change.undone);
        await this.saveIntent((intent) => {
          const arrived = intent.arrived;
          if (arrived?.sha === sha) arrived.revert = revert;
          else if (arrived?.revert === sha) {
            arrived.sha = revert;
            delete arrived.revert;
          }
        });
      });
    });
  }

  applyRemote() {
    return this.exclusive(async (cwd) => {
      if (!this.forkBranch)
        throw new PlainFailure("nothing", "No changes from your other computers.");
      const ref = `${FORK_REF_PREFIX}${this.forkBranch}`;
      const tip = await git(cwd, ["rev-parse", "--verify", `${ref}^{commit}`]);
      return await this.take(cwd, {
        wanted: { kind: "draft", name: remoteMergeDraftName(tip), at: Date.now() },
        kind: "remote",
        ref,
        emptyMessage: "No changes from your other computers.",
        subject: `Merge the changes from another computer ${tip.slice(0, 12)}`,
        trustIdenticalTree: false,
        brief: (plan, head, gateOutput) =>
          remoteMergeBrief(plan, head, ref, gateOutput),
        pendingDraft: remoteMergeDraftName(tip),
        pendingDraftExists: false,
      });
    });
  }

  /**
   * The user's Update. `targets` are the other computers it is for too (null:
   * every one, []: this one only); they apply it by themselves. Here it is
   * applied at once when it is prepared. When it isn't yet (a merge that
   * still needs resolving), the press is the go-ahead: it is applied by
   * itself once it is ready, with no second press.
   */
  applyUpstream(targets: string[] | null = null) {
    return this.exclusive(async (cwd) => {
      if (!this.upstreamTracked) throw new PlainFailure("nothing", "No update is available.");
      const version = await git(cwd, ["rev-parse", "--verify", `${UPSTREAM_REF}^{commit}`]);
      const head = await git(cwd, ["rev-parse", "HEAD"]);
      if (await isAncestor(cwd, version, head)) throw new PlainFailure("nothing", "No update is available.");
      await this.announceApply(version, targets);
      const target = await this.updateTarget(cwd, head, version);
      const prepared = await this.preparer.recordFor(head, target.tip);
      const found = prepared ?? (await this.preparer.peek(head, target.tip));
      const wanted: Wanted = { kind: "version", version, from: null, at: Date.now() };
      if (!prepared && found?.plan?.kind === "conflict") {
        const modelTried = found.resolve === "model" || Boolean(this.update?.version === version && this.update.unresolved);
        if (this.waitingOnOther(version) || (!modelTried && this.options.modelResolve)) {
          await this.want(wanted);
          this.options.log("app-source.update-wanted", { version: version.slice(0, 12) });
          return { background: true as const };
        }
      }
      return await this.takeUpstream(cwd);
    });
  }

  private async take(
    cwd: string,
    source: TakeSource,
  ): Promise<void | { background: true }> {
    const head = await git(cwd, ["rev-parse", "HEAD"]);
    const tip = (
      await gitRaw(cwd, ["rev-parse", "--verify", "--quiet", `${source.ref}^{commit}`])
    ).stdout.trim();
    const prepared = tip ? await this.preparer.recordFor(head, tip) : null;
    const plan = prepared?.plan ?? (await classifyUpdate(cwd, head, source.ref));
    this.mark("plan");
    this.options.log("app-source.take-planned", {
      from: source.kind,
      kind: plan.kind,
      prepared: Boolean(prepared),
      ...(plan.kind === "clean"
        ? { identical: plan.identical, localChanges: plan.localChanges }
        : {}),
      ...(plan.kind === "conflict" ? { conflicts: plan.conflicts.length } : {}),
    });
    if (plan.kind === "none") throw new PlainFailure("nothing", source.emptyMessage);
    let to = plan.kind === "fast-forward" ? plan.tip : "";
    if (plan.kind === "conflict" && !prepared?.to) {
      return await this.dispatchMerge(cwd, source, source.brief(plan, head));
    }
    if (plan.kind !== "fast-forward" && prepared?.to) {
      to = prepared.to;
      if (prepared.gate && !prepared.gate.ok) {
        return await this.dispatchMerge(
          cwd,
          source,
          source.brief(plan, head, prepared.gate.output),
        );
      }
    } else if (plan.kind === "clean") {
      to = await git(
        cwd,
        [
          "commit-tree",
          plan.tree,
          "-p",
          head,
          "-p",
          plan.tip,
          "-m",
          source.subject,
        ],
        { env: await this.identityEnv(cwd) },
      );
      if (!(source.trustIdenticalTree && plan.identical)) {
        const gate = await checkMergedUpdate(
          cwd,
          to,
          this.options.updateScratchDir,
          this.options.log,
        );
        this.mark("gate");
        if (!gate.ok) {
          return await this.dispatchMerge(
            cwd,
            source,
            source.brief(plan, head, gate.output),
          );
        }
      }
    }
    try {
      await this.swapIn(
        cwd,
        head,
        to,
        source.settle && (() => source.settle!(to)),
        prepared,
      );
      this.rejected.delete(tip);
    } catch (error) {
      if (error instanceof RendererRejected) {
        this.rejected.set(tip, error.message);
        if (source.kind === "draft") await this.tellItsTask(cwd, source.pendingDraft, tip, error.detail);
      }
      throw error;
    }
  }

  private async dispatchMerge(
    cwd: string,
    source: TakeSource,
    brief: AgentBrief,
  ): Promise<{ background: true }> {
    const dispatch = this.options.dispatchAgentBrief;
    if (!dispatch) {
      throw new PlainFailure("not-ready", "Stella isn't ready to make that change yet.");
    }
    const name = source.pendingDraft;
    let draft = await this.draftOf(cwd, name);
    const current = await this.mergeRecord(cwd);
    if (draft.state === "worktree") {
      const running =
        current?.draft === name && current.agent
          ? await this.agentRunning(current.agent)
          : false;
      if (running !== false) return { background: true };
      await removeWorktree(cwd, draft.path);
      this.options.log("app-source.orphaned-draft-dropped", { draft: name });
      draft = await this.draftOf(cwd, name);
    }
    if (draft.state === "stale" && !source.pendingDraftExists) {
      await git(cwd, ["branch", "-D", `draft/${name}`]);
      this.options.log("app-source.leftover-draft-dropped", { draft: name });
      draft = { state: "none" };
    }
    let agent: DispatchedAgent | null = null;
    if (source.pendingDraftExists || draft.state === "none") {
      agent = await dispatch(brief);
      this.options.log("app-source.brief-dispatched", {
        from: source.kind,
        draft: name,
      });
    }
    await this.setMerge(cwd, {
      draft: name,
      from: source.kind,
      tip: "tip" in draft ? draft.tip : "",
      since: Date.now(),
      agent,
    });
    if (source.wanted) await this.want(source.wanted);
    return { background: true };
  }

  private async draftOf(
    cwd: string,
    name: string,
  ): Promise<
    | { state: "worktree"; path: string }
    | { state: "ready" | "stale"; tip: string }
    | { state: "none" }
  > {
    const ref = `${DRAFT_REF_PREFIX}${name}`;
    const tree = (await listWorktrees(cwd)).find((entry) => entry.branch === ref);
    if (tree) return { state: "worktree", path: tree.path };
    const tip = (
      await gitRaw(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])
    ).stdout.trim();
    if (!tip) return { state: "none" };
    return { state: (await isAncestor(cwd, "HEAD", tip)) ? "ready" : "stale", tip };
  }

  private async agentRunning(agent: DispatchedAgent) {
    return (await this.options.agentRunning?.(agent).catch(() => null)) ?? null;
  }

  private async mergeRecord(cwd: string) {
    if (this.merge === undefined) this.merge = await readMergeRecord(await this.commonDir(cwd));
    return this.merge;
  }

  private async setMerge(cwd: string, record: MergeRecord | null) {
    this.merge = record;
    await writeMergeRecord(await this.commonDir(cwd), record).catch((error: unknown) =>
      this.options.log("app-source.merge-record-failed", { message: errorMessage(error) }),
    );
  }

  /** Where the recorded merge stands; a settled one is cleared. */
  private async mergeStatus(
    cwd: string,
    head: string,
    worktreeBranches: Set<string | null>,
    offered: (name: string) => boolean,
  ): Promise<{ record: MergeRecord; status: MergeStatus } | null> {
    const record = await this.mergeRecord(cwd);
    if (!record) return null;
    const ref = `${DRAFT_REF_PREFIX}${record.draft}`;
    const tip =
      (await gitRaw(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])).stdout.trim() ||
      null;
    const worktree = worktreeBranches.has(ref);
    const descendsFromHead = tip !== null && (await isAncestor(cwd, head, tip));
    const settledByGit = !worktree && tip !== null && (descendsFromHead || record.from !== "draft" || tip !== record.tip);
    const status = classifyMerge(record, {
      worktree,
      tip,
      descendsFromHead,
      offered: offered(record.draft),
      agentRunning: record.agent && !settledByGit ? await this.agentRunning(record.agent) : null,
      now: Date.now(),
    });
    if (!isMerging(status) && this.merge === record) {
      this.options.log("app-source.merge-settled", {
        draft: record.draft,
        status,
        ms: Date.now() - record.since,
      });
      await this.setMerge(cwd, null);
    }
    return { record, status };
  }

  private async dispatchUndo(
    cwd: string,
    args: {
      sha: string;
      base: string;
      subject: string;
      head: string;
      conflicts: string[];
      buildOutput?: string;
    },
  ): Promise<{ background: true }> {
    const dispatch = this.options.dispatchAgentBrief;
    if (!dispatch) {
      throw new PlainFailure("not-ready", "Stella isn't ready to undo that yet.");
    }
    await dispatch(undoBrief(args));
    this.options.log("app-source.brief-dispatched", {
      from: "undo",
      sha: args.sha,
      conflicts: args.conflicts.length,
      build: args.buildOutput !== undefined,
    });
    return { background: true };
  }


  private exclusive(
    task: (cwd: string) => Promise<void | { background: true }>,
  ): Promise<AppSourceActionResult> {
    const requestedAt = performance.now();
    const result = this.queue.then(async (): Promise<AppSourceActionResult> => {
      this.timeline = { startedAt: requestedAt, last: requestedAt, steps: [] };
      await this.waitForRecording();
      this.mark("queued");
      this.setBusy(true);
      this.preparer.pause();
      try {
        await this.options.beforeAction?.(this.options.stellaAppDir);
        this.mark("verify");
        const outcome = await task(this.options.stellaAppDir);
        this.pushToFork();
        this.logTimeline(outcome ? "background" : "applied");
        return { ok: true, ...(outcome ?? {}) };
      } catch (error) {
        this.options.log("app-source.action-failed", {
          message: errorMessage(error),
        });
        this.logTimeline("failed");
        return { ok: false, error: errorMessage(error), ...failureOf(error) };
      } finally {
        this.timeline = null;
        this.setBusy(false);
        this.preparer.resume();
        void this.refresh();
      }
    });
    this.queue = result;
    return result;
  }

  private mark(step: string) {
    const timeline = this.timeline;
    if (!timeline) return;
    const now = performance.now();
    timeline.steps.push(`${step} ${Math.round(now - timeline.last)}`);
    timeline.last = now;
  }

  private logTimeline(outcome: string) {
    const timeline = this.timeline;
    if (!timeline || timeline.steps.length === 0) return;
    this.options.log("app-source.timing", {
      outcome,
      totalMs: Math.round(performance.now() - timeline.startedAt),
      steps: timeline.steps.join(" | "),
    });
    timeline.steps = [];
  }

  private async swapIn(
    cwd: string,
    from: string,
    to: string,
    settle?: () => Promise<void>,
    prepared?: PreparedUpdate | null,
  ) {
    const paths = (await git(cwd, ["diff", "--name-only", from, to]))
      .split("\n")
      .filter(Boolean);
    this.mark("diff");
    const install = installs(paths);
    const restart = relaunches(paths);
    let bundles = prepared?.bundles && prepared.to === to ? prepared.dir : undefined;
    if (restart && !bundles) {
      bundles = `${this.options.updateScratchDir}-apply-bundles`;
      const built = await buildOnScratch({
        cwd,
        commit: to,
        scratch: `${this.options.updateScratchDir}-apply`,
        keep: bundles,
      });
      this.mark("build");
      if (!built.ok) {
        this.options.log("app-source.apply-build-failed", { to: to.slice(0, 12), output: built.output });
        throw new PlainFailure("would-not-start", "This version of Stella would not start, so it wasn't applied.");
      }
    }
    const visible =
      !restart &&
      paths.some(
        (file) =>
          !file.startsWith("packages/runtime/") &&
          !file.startsWith("packages/desktop/"),
      );
    const covering = visible ? this.options.coverRenderer?.() ?? null : null;
    let phase: ApplyPhase = "planned";
    let holding: Promise<RelaunchHold | null> | null = null;
    if (restart && (install || restartsRuntime(paths)) && (await this.waitForReply())) this.mark("reply");
    try {
      await this.moveHead(cwd, from, to);
      phase = "signed";
      this.mark("sign");
      const settled = () =>
        (settle?.() ?? Promise.resolve()).catch((error: unknown) =>
          this.options.log("app-source.settle-failed", { message: errorMessage(error) }),
        );
      if (restart) {
        const settling = settled();
        this.options.log("app-source.applied", { files: paths.length });
        holding = this.options.beforeRelaunch?.() ?? Promise.resolve(null);
        phase = "holding";
        if (install) {
          await this.install(cwd);
          this.mark("install");
        }
        phase = "installed";
        const [, setUp] = await Promise.all([
          prebuildElectronBundles(
            cwd,
            `${this.options.updateScratchDir}-prebuild.mjs`,
            this.options.log,
            bundles,
          ),
          this.options.launcherPreparesOnRelaunch
            ? prepareInstallAhead(cwd, this.options.log)
            : false,
        ]);
        this.mark("prebuild");
        if (this.options.launcherPreparesOnRelaunch) {
          this.options.reportPrepared?.({
            ...(install
              ? {
                  lockHash: createHash("sha256")
                    .update(await fs.readFile(path.join(cwd, "bun.lock")))
                    .digest("hex"),
                }
              : {}),
            ...(setUp ? { head: to } : {}),
          });
        }
        await settling;
        await (await holding)?.commit();
        this.mark("hold");
        phase = "relaunching";
        this.logTimeline("relaunch");
        this.options.relaunch({ keepRuntime: !install && !restartsRuntime(paths) });
        return;
      }
      const covered = await covering;
      this.mark("cover");
      const swap = async () => {
        const outcome = (await this.options.applyRendererChanges(paths)) ?? { mode: "none" as const };
        if (outcome.mode === "failed") await this.takeBack(cwd, from, to, paths, outcome);
        return outcome;
      };
      const outcome = await (covered ? covered.reveal(swap) : swap());
      this.mark("reveal");
      if (outcome.mode === "failed") {
        throw new RendererRejected(
          "This change stopped Stella from showing, so it was taken back.",
          outcome.error,
        );
      }
      this.options.log("app-source.applied", {
        files: paths.length,
        renderer: outcome.mode,
        ...(outcome.mode === "reload" && outcome.reason ? { reason: outcome.reason } : {}),
      });
      if (restartsRuntime(paths)) {
        this.options.requestRuntimeRestart();
      }
      if (outcome.mode === "swap" && outcome.swaps >= SWAPS_BEFORE_RELOAD) this.reloadWhenAway();
      await settled();
    } catch (error) {
      this.options.log("app-source.apply-stopped", { phase, message: errorMessage(error) });
      if (phase !== "relaunching") {
        await (await holding)?.release();
        await (await covering)?.cancel();
      }
      throw error;
    }
  }

  /**
   * The windows refused the change: the checkout goes back to where it was
   * and the windows are given those files again, by a reload when the change
   * already cost them one or cannot be taken out in place.
   */
  private async takeBack(
    cwd: string,
    from: string,
    to: string,
    paths: string[],
    failure: Extract<RendererApplyOutcome, { mode: "failed" }>,
  ) {
    await git(cwd, ["reset", "--keep", from]);
    await this.options.afterApply?.(cwd);
    let restored = (await this.options.applyRendererChanges(paths, { reload: failure.reloaded })) ?? {
      mode: "none" as const,
    };
    if (restored.mode === "failed" && !restored.reloaded) {
      restored = (await this.options.applyRendererChanges(paths, { reload: true })) ?? restored;
    }
    this.options.log("app-source.renderer-rejected", {
      to: to.slice(0, 12),
      error: failure.error,
      reloaded: failure.reloaded,
      restored: restored.mode,
    });
  }

  /** The task that made a change the window refused hears why, once per commit, so it can fix it. */
  private async tellItsTask(cwd: string, name: string, tip: string, detail: string) {
    if (isStellaDraft(name) || this.toldTasks.has(tip)) return;
    this.toldTasks.add(tip);
    const agentId = await this.agentOf(cwd, DRAFT_AGENTS_DIR, name);
    const told = agentId
      ? await this.options
          .tellAgent?.(agentId, `draft-rejected:${tip}`, rejectedDraftNote(name, detail))
          .catch(() => false)
      : false;
    this.options.log("app-source.rejection-sent", { draft: name, told: told === true });
  }

  /**
   * Every change taken in place leaves the modules it replaced in memory. Once
   * enough have piled up, the windows load again the next time nobody is
   * looking; until then nothing is checked.
   */
  private reloadWhenAway() {
    if (this.reloadTimer || this.disposed) return;
    const timer = setInterval(() => {
      if (this.busy || !this.options.isUserAway?.()) return;
      clearInterval(timer);
      this.reloadTimer = null;
      this.queue = this.queue.then(async () => {
        const covered = (await this.options.coverRenderer?.()) ?? null;
        const reload = async () => {
          const outcome = await this.options.applyRendererChanges([], { reload: true });
          this.options.log("app-source.renderer-refreshed", { outcome: outcome?.mode ?? "none" });
        };
        await (covered ? covered.reveal(reload) : reload()).catch((error: unknown) =>
          this.options.log("app-source.renderer-refresh-failed", { message: errorMessage(error) }),
        );
      });
    }, RELOAD_WHEN_AWAY_POLL_MS);
    timer.unref?.();
    this.reloadTimer = timer;
  }

  /**
   * A finished change that only touches the interface is added without a
   * click, once, as soon as the user's hands are off Stella. One that fails
   * stays in Updates with what went wrong.
   */
  private considerAutoApply(state: AppSourceState) {
    if (this.autoTimer || this.disposed || state.busy || state.merging) return;
    const offer = state.waiting.find(
      (entry): entry is AppSourceDraftOffer =>
        entry.kind === "draft" &&
        entry.interfaceOnly &&
        !entry.stale &&
        !entry.adding &&
        !this.autoTried.has(entry.sha),
    );
    if (!offer) return;
    const attempt = async () => {
      this.autoTimer = null;
      if (this.disposed) return;
      const current = this.state.waiting.find(
        (entry) => entry.kind === "draft" && entry.sha === offer.sha && !entry.adding,
      );
      if (!current || this.state.merging) return;
      const quiet = this.busy ? 0 : ((await this.options.userQuietFor?.()) ?? Infinity);
      if (quiet < AUTO_APPLY_QUIET_MS) {
        this.autoTimer = setTimeout(() => void attempt(), AUTO_APPLY_RETRY_MS);
        this.autoTimer.unref?.();
        return;
      }
      this.autoTried.add(offer.sha);
      const result = await this.applyDraft(offer.name);
      this.options.log("app-source.auto-applied", {
        draft: offer.name,
        ok: result.ok,
        ...(result.ok ? {} : { error: result.error }),
      });
    };
    this.autoTimer = setTimeout(() => void attempt(), 0);
  }

  /** A HEAD the launcher refuses to sign is moved back, so Stella never runs on an unsigned version. */
  private async moveHead(cwd: string, from: string, to: string) {
    await git(cwd, ["merge", "--ff-only", to]);
    this.mark("merge");
    try {
      await this.options.afterApply?.(cwd);
    } catch (error) {
      const restored = await gitRaw(cwd, ["reset", "--keep", from]);
      this.options.log("app-source.apply-rolled-back", {
        to: to.slice(0, 12),
        restored: restored.code === 0,
        ...(restored.code === 0 ? {} : { message: restored.stderr.trim() }),
      });
      throw error;
    }
  }

  private async install(cwd: string) {
    const bun = process.env.STELLA_BUN_PATH?.trim() || "bun";
    const result = await run(bun, ["install"], {
      cwd,
      env: this.options.launcherPreparesOnRelaunch
        ? { STELLA_SKIP_BROWSER_HYDRATE: "1", STELLA_SKIP_OFFICE_HYDRATE: "1" }
        : undefined,
      timeoutMs: 10 * 60_000,
    });
    if (result.code !== 0) {
      throw new Error(
        `The change is applied, but bun install failed: ${result.stderr.trim().slice(-400)}`,
      );
    }
  }

  private async identityEnv(
    cwd: string,
  ): Promise<NodeJS.ProcessEnv | undefined> {
    if ((await gitRaw(cwd, ["var", "GIT_COMMITTER_IDENT"])).code === 0) {
      return undefined;
    }
    return {
      GIT_AUTHOR_NAME: "Stella",
      GIT_AUTHOR_EMAIL: "stella@localhost",
      GIT_COMMITTER_NAME: "Stella",
      GIT_COMMITTER_EMAIL: "stella@localhost",
    };
  }

  /**
   * An update waits while a screen recording or its finish card is open:
   * swapping or reloading the windows would end the recording.
   */
  private async waitForRecording() {
    if (!this.options.recordingOpen?.()) return;
    this.heldForRecording = true;
    this.publish({ ...this.state, heldForRecording: true });
    this.options.log("app-source.held-for-recording", {});
    // Bounded, so a recording that never settles can't hold updates forever.
    const until = Date.now() + RECORDING_HOLD_MAX_MS;
    while (!this.disposed && Date.now() < until && this.options.recordingOpen?.()) await delay(500);
    this.heldForRecording = false;
    const { heldForRecording: _held, ...rest } = this.state;
    this.publish(rest);
  }

  /**
   * An update that restarts the runtime waits while Stella is mid-reply here: the restart would cut the reply off
   * between a tool call and its result. Bounded, so a reply that never ends can't hold updates forever; one cut off
   * then resumes after the restart.
   */
  private async waitForReply() {
    const replying = this.options.replying;
    if (!replying || !(await replying().catch(() => false))) return false;
    this.heldForReply = true;
    this.publish({ ...this.state, heldForReply: true });
    this.options.log("app-source.held-for-reply", {});
    const startedAt = Date.now();
    const until = startedAt + REPLY_HOLD_MAX_MS;
    while (!this.disposed && Date.now() < until && (await replying().catch(() => false))) await delay(500);
    this.heldForReply = false;
    const { heldForReply: _held, ...rest } = this.state;
    this.publish(rest);
    this.options.log("app-source.reply-hold-ended", { ms: Date.now() - startedAt });
    return true;
  }

  private setBusy(busy: boolean) {
    this.busy = busy;
    this.publish({ ...this.state, busy });
  }

  private publish(next: AppSourceState) {
    this.state = next;
    const json = JSON.stringify(next);
    if (json === this.publishedState) return;
    this.publishedState = json;
    this.options.broadcast(next);
  }

  refresh(): Promise<void> {
    if (this.disposed || this.busy) return Promise.resolve();
    if (this.refreshing) {
      this.refreshAgain = true;
      return this.refreshing;
    }
    const refreshing = (async () => {
      do {
        this.refreshAgain = false;
        try {
          const next = await this.readState();
          this.publish({
            ...next,
            busy: this.busy,
            ...(this.heldForRecording ? { heldForRecording: true } : {}),
            ...(this.heldForReply ? { heldForReply: true } : {}),
          });
          this.considerAutoApply(this.state);
          this.considerWanted(this.state);
        } catch (error) {
          this.options.log("app-source.refresh-failed", {
            message: errorMessage(error),
          });
        }
      } while (this.refreshAgain && !this.disposed);
    })().finally(() => {
      this.refreshing = null;
    });
    this.refreshing = refreshing;
    return refreshing;
  }

  private async readState(): Promise<Omit<AppSourceState, "busy">> {
    const cwd = this.options.stellaAppDir;
    const [head, worktrees, refs, log] = await Promise.all([
      git(cwd, ["rev-parse", "HEAD"]),
      listWorktrees(cwd),
      git(cwd, [
        "for-each-ref",
        "--format=%(refname)%00%(objectname)%00%(subject)",
        DRAFT_REF_PREFIX,
      ]),
      this.recentLog(cwd),
    ]);
    const inProgress = new Set(worktrees.map((tree) => tree.branch));
    const drafts: FoundDraft[] = [];
    for (const line of refs.split("\n").filter(Boolean)) {
      const [refname = "", sha = "", subject = ""] = line.split("\0");
      const name = refname.slice(DRAFT_REF_PREFIX.length);
      if (!isDraftName(name) || inProgress.has(refname) || sha === head)
        continue;
      const ahead = await isAncestor(cwd, head, sha);
      if (!ahead && (await isAncestor(cwd, sha, head))) continue;
      const agentId = await this.agentOf(cwd, DRAFT_AGENTS_DIR, name);
      drafts.push({
        name,
        subject,
        sha,
        stale: !ahead,
        ...(agentId ? { agentId } : {}),
        ...(await this.draftShape(cwd, head, sha)),
      });
    }
    const recent = (await this.readRecent(cwd, log)).map((row) => row.commit);
    const forkRef = this.forkBranch ? `${FORK_REF_PREFIX}${this.forkBranch}` : null;
    const upstreamOffer = this.upstreamTracked
      ? await this.offerFrom(cwd, head, UPSTREAM_REF, null)
      : null;
    const forkOffer = forkRef
      ? await this.offerFrom(
          cwd,
          head,
          forkRef,
          upstreamOffer?.real ? UPSTREAM_REF : null,
        )
      : null;
    const drafting = worktrees.some((tree) =>
      tree.branch?.startsWith(DRAFT_REF_PREFIX),
    );
    if (drafting) {
      // Its base must not move under the agent; caught up once it is done.
    } else if (forkRef && forkOffer?.catchUp) {
      this.catchUpLater(forkRef, forkOffer.tip, head);
    } else if (upstreamOffer?.catchUp) {
      this.catchUpLater(UPSTREAM_REF, upstreamOffer.tip, head);
    }
    const skippedNow = await this.skippedKeys(cwd);
    const jobs: PrepareJob[] = [];
    const identityEnv = () => this.identityEnv(cwd);
    const preparedFor = async (
      job: Omit<PrepareJob, "head" | "identityEnv">,
      keys: string[],
    ) => {
      if (keys.some((key) => skippedNow.has(key))) return true;
      jobs.push({ ...job, head, identityEnv });
      return await this.preparer.isReady(head, job.tip, job.resolve);
    };
    const shown: FoundDraft[] = [];
    for (const draft of drafts) {
      const prepared = await preparedFor(
        {
          tip: draft.sha,
          ref: `${DRAFT_REF_PREFIX}${draft.name}`,
          subject: draft.subject,
          trustIdenticalTree: false,
        },
        [`draft:${draft.sha}`, `version:${draft.sha}`],
      );
      if (prepared) shown.push(draft);
    }
    const readyShown = shown.filter((draft) => !draft.stale);
    const intent = await this.loadIntent();
    let upstreamShown = false;
    let conflicts: AppSourceConflicts | undefined;
    this.versionReady = null;
    this.versionConflicts = null;
    const version = upstreamOffer?.real ? upstreamOffer.tip : null;
    if (version) {
      const target = await this.updateTarget(cwd, head, version);
      const resolve = await this.resolveLevel(head, version, target.tip);
      const ready = await preparedFor(
        {
          tip: target.tip,
          ref: target.ref,
          subject: `${UPSTREAM_MERGE_SUBJECT} ${version.slice(0, 12)}`,
          trustIdenticalTree: true,
          resolve,
        },
        [`version:${version}`],
      );
      const record = await this.preparer.peek(head, target.tip);
      if (record) void this.shareResult(version, head, record);
      if (ready && record?.plan?.kind === "conflict" && !record.to) {
        conflicts = this.conflictsToShow(version, record);
        upstreamShown = conflicts !== undefined;
        this.versionConflicts = conflicts ?? null;
      } else {
        upstreamShown = ready;
        if (ready && record?.to) this.versionReady = version;
      }
    }
    const wantedVersion =
      version !== null &&
      intent.wanted.some((entry) => entry.kind === "version" && entry.version === version);
    // Named by the newest change it brings, not by the other computer's tip:
    // that tip also moves when the other computer only takes a version, and a
    // change skipped or dismissed here must not come back for that.
    const forkChange =
      forkRef && forkOffer?.real ? await this.forkChange(cwd, head, forkOffer.tip) : null;
    const forkKey = forkChange ? `other:${forkChange.sha}` : null;
    const forkShown =
      forkRef && forkOffer?.real && forkKey
        ? await preparedFor(
            {
              tip: forkOffer.tip,
              ref: forkRef,
              subject: `${REMOTE_MERGE_SUBJECT} ${forkOffer.tip.slice(0, 12)}`,
              trustIdenticalTree: false,
            },
            [forkKey],
          )
        : false;
    void this.preparer.want(jobs);
    const [remote, upstream] = await Promise.all([
      forkRef && forkShown ? this.compareRef(cwd, head, forkRef) : null,
      upstreamShown ? this.compareRef(cwd, head, UPSTREAM_REF) : null,
    ]);
    const merge = await this.mergeStatus(
      cwd,
      head,
      inProgress,
      (name) => readyShown.some((draft) => draft.name === name),
    );
    const pending = merge && isMerging(merge.status) ? merge.record : null;
    const merging = pending?.from ?? null;
    const offered: AppSourceWaiting[] = [];
    const versionTip = version && (upstreamShown || wantedVersion) ? version : null;
    const updateDraft = readyShown.find((draft) =>
      versionTip
        ? draft.name === mergeDraftName(versionTip)
        : isUpdateDraft(draft.name),
    );
    if (versionTip || updateDraft) {
      const agentId =
        updateDraft?.agentId ??
        (pending?.from === "upstream" ? pending.agent?.threadId : undefined);
      offered.push({
        kind: "version",
        key: `version:${versionTip ?? updateDraft!.sha}`,
        adding: merging === "upstream" || wantedVersion,
        ...(updateDraft ? { draft: updateDraft.name } : {}),
        ...(agentId ? { agentId } : {}),
        ...(conflicts && !updateDraft && merging !== "upstream" && !wantedVersion ? { conflicts } : {}),
      });
    }
    if (forkRef && forkOffer?.real && forkShown && forkChange && forkKey) {
      const summary = forkChange.subject;
      const device = await this.forkDevice(cwd);
      const forkDraft = readyShown.find(
        (draft) => draft.name === remoteMergeDraftName(forkOffer.tip),
      );
      const agentId =
        forkDraft?.agentId ?? (pending?.from === "remote" ? pending.agent?.threadId : undefined);
      offered.push({
        kind: "other-computer",
        key: forkKey,
        adding:
          merging === "remote" ||
          (forkDraft !== undefined &&
            intent.wanted.some((entry) => entry.kind === "draft" && entry.name === forkDraft.name)),
        device,
        summary,
        ...(forkDraft ? { draft: forkDraft.name } : {}),
        ...(agentId ? { agentId } : {}),
      });
    }
    for (const draft of shown) {
      if (isStellaDraft(draft.name)) continue;
      const { subject, ...rest } = draft;
      offered.push({
        kind: "draft",
        key: `draft:${draft.sha}`,
        adding:
          (merging === "draft" && pending?.draft === draft.name) ||
          (!draft.stale &&
            intent.wanted.some((entry) => entry.kind === "draft" && entry.name === draft.name)),
        summary: subject || draft.name,
        ...rest,
      });
    }
    if (
      pending?.from === "draft" &&
      !offered.some((offer) => offer.kind === "draft" && offer.name === pending.draft)
    ) {
      const subject = (
        await gitRaw(cwd, ["log", "-1", "--format=%s", `${DRAFT_REF_PREFIX}${pending.draft}`])
      ).stdout.trim();
      const agentId = await this.agentOf(cwd, DRAFT_AGENTS_DIR, pending.draft);
      offered.push({
        kind: "draft",
        key: `draft:${pending.tip}`,
        adding: true,
        name: pending.draft,
        summary: subject || pending.draft,
        sha: pending.tip,
        stale: true,
        files: 0,
        restart: false,
        interfaceOnly: false,
        ...(agentId ? { agentId } : {}),
      });
    }
    this.offeredKeys = offered.map((offer) => offer.key);
    const skipped = skippedNow;
    await this.pruneWanted(cwd, head, intent, drafts, worktrees);
    // Only while it is still the latest thing that happened here: after any
    // later change, its Undo would no longer mean "back to before this update".
    const arrived =
      intent.arrived && (intent.arrived.revert ?? intent.arrived.sha) === head
        ? intent.arrived
        : null;
    return {
      ...(arrived && Date.now() - arrived.at < WANTED_MAX_AGE_MS
        ? {
            arrived: {
              sha: arrived.sha,
              from: arrived.from,
              date: arrived.at,
              undone: Boolean(arrived.revert),
              flip: arrived.revert ?? arrived.sha,
            },
          }
        : {}),
      remote: remote
        ? { status: remote.status, count: remote.count }
        : { status: "none", count: 0 },
      upstream: upstream ?? NO_UPSTREAM,
      recent,
      ...(this.notShared ? { notShared: this.notShared } : {}),
      waiting: offered.filter((offer) => offer.adding || !skipped.has(offer.key)),
      skipped: offered.filter((offer) => !offer.adding && skipped.has(offer.key)),
      ...(pending ? { merging: { from: pending.from, draft: pending.draft } } : {}),
    };
  }

  private async loadIntent(): Promise<UpdateIntent> {
    if (!this.intent) {
      this.intent = await readIntent(await this.commonDir(this.options.stellaAppDir));
    }
    return this.intent;
  }

  /**
   * Writes go one at a time: an update landing notes its arrival and prunes
   * what was asked for at the same moment, and each write is the whole file.
   */
  private async saveIntent(change: (intent: UpdateIntent) => void) {
    const intent = await this.loadIntent();
    change(intent);
    const commonDir = await this.commonDir(this.options.stellaAppDir);
    const write = this.intentWrites.then(() =>
      writeIntent(commonDir, intent).catch((error: unknown) =>
        this.options.log("app-source.intent-write-failed", { message: errorMessage(error) }),
      ),
    );
    this.intentWrites = write;
    await write;
  }

  private want(entry: Wanted) {
    return this.saveIntent((intent) => {
      intent.wanted = [
        ...intent.wanted.filter((other) =>
          entry.kind === "version"
            ? other.kind !== "version"
            : !(other.kind === "draft" && other.name === entry.name),
        ),
        entry,
      ];
    });
  }

  /** Drops what was asked for once it is in, or can no longer arrive. */
  private async pruneWanted(
    cwd: string,
    head: string,
    intent: UpdateIntent,
    ready: FoundDraft[],
    worktrees: Awaited<ReturnType<typeof listWorktrees>>,
  ) {
    const kept: Wanted[] = [];
    let arrived: Extract<Wanted, { kind: "version" }> | null = null;
    for (const entry of intent.wanted) {
      if (Date.now() - entry.at >= WANTED_MAX_AGE_MS) continue;
      if (entry.kind === "version") {
        if (await isAncestor(cwd, entry.version, head)) {
          // It came in another way (catching up with the computer that
          // merged it); still say so, as if it came in by itself.
          arrived = entry;
          continue;
        }
      } else {
        const ref = `${DRAFT_REF_PREFIX}${entry.name}`;
        const exists = (await gitRaw(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])).code === 0;
        const drafting = worktrees.some((tree) => tree.branch === ref);
        const merging = this.merge?.draft === entry.name;
        if (!exists && !drafting && !merging) continue;
        if (!drafting && !merging && ready.some((draft) => draft.name === entry.name && draft.stale)) continue;
      }
      kept.push(entry);
    }
    if (kept.length !== intent.wanted.length) {
      await this.saveIntent((current) => {
        current.wanted = kept;
        if (arrived && current.arrived?.version !== arrived.version) {
          current.arrived = {
            sha: head,
            version: arrived.version,
            from: arrived.from?.device ?? null,
            at: Date.now(),
          };
        }
      });
    }
  }

  /**
   * Where this computer gets `version` from: the merge the account already
   * made of it when that merge brings nothing this checkout lacks but the
   * version itself (the same personal changes, so the same answer); then the
   * fork, when another computer already took it; else the published version.
   */
  private async updateTarget(cwd: string, head: string, version: string) {
    const result = this.update?.version === version ? this.update.result : null;
    const own = result ? await this.preparer.peek(head, version) : null;
    if (result && own?.to !== result.sha) {
      const known = (await gitRaw(cwd, ["cat-file", "-e", `${result.sha}^{commit}`])).code === 0;
      if (!known) {
        void this.fetchResult(version, result.sha);
      } else if (await this.usableResult(cwd, head, result.sha, version)) {
        return { ref: result.sha, tip: result.sha };
      } else {
        this.resultUnusable = result.sha;
      }
    }
    const ref = (await this.mergedElsewhere(cwd, version)) ?? UPSTREAM_REF;
    return {
      ref,
      tip: ref === UPSTREAM_REF ? version : await git(cwd, ["rev-parse", "--verify", `${ref}^{commit}`]),
    };
  }

  /** `merged` holds `version` and nothing but changes this checkout already has (by content). */
  private async usableResult(cwd: string, head: string, merged: string, version: string) {
    if (!(await isAncestor(cwd, version, merged))) return false;
    const extra = await gitRaw(cwd, [
      "rev-list",
      "--no-merges",
      "--right-only",
      "--cherry-pick",
      "--max-count=1",
      `${head}...${merged}`,
      `^${version}`,
    ]);
    return extra.code === 0 && extra.stdout.trim() === "";
  }

  private async fetchResult(version: string, sha: string) {
    if (this.fetchingResult === sha || this.disposed) return;
    this.fetchingResult = sha;
    const cwd = this.options.stellaAppDir;
    try {
      const fork = (await this.sourceAccess())?.fork;
      if (!fork) return;
      await git(
        cwd,
        [
          "fetch",
          "--quiet",
          "--no-tags",
          "--no-write-fetch-head",
          fork.remote,
          `+refs/tags/${updateResultTag(version)}:${RESULT_REF}`,
        ],
        { env: fetchEnv(fork.token), timeoutMs: 5 * 60_000 },
      );
      this.options.log("app-source.update-result-fetched", { version: version.slice(0, 12) });
      void this.refresh();
    } catch (error) {
      this.options.log("app-source.update-result-fetch-failed", { message: errorMessage(error) });
    } finally {
      this.fetchingResult = null;
    }
  }

  /**
   * How far preparing may take a conflicting merge of `version`. Resolutions
   * git already knows are free and always used. A model only when the user
   * said yes (an Update press, here or for this computer elsewhere), or in the
   * background on a paid plan when this is the one computer on the account
   * that merges this version.
   */
  private async resolveLevel(head: string, version: string, tip: string): Promise<ResolveLevel> {
    const record = await this.preparer.peek(head, tip);
    const rerereFailed =
      record?.plan?.kind === "conflict" && !record.to && record.resolve !== undefined && record.resolve !== "none";
    if (!rerereFailed || !this.options.modelResolve) return "rerere";
    if (this.waitingOnOther(version)) return "rerere";
    // Another computer with these same changes already asked a model and it
    // was not sure; asking again here would spend the same for the same answer.
    const update = this.update?.version === version ? this.update : null;
    const me = this.options.getDeviceId?.();
    if (update?.unresolved && update.preparer && update.preparer.deviceId !== me && update.preparer.base === head) {
      return "rerere";
    }
    const intent = await this.loadIntent();
    if (intent.wanted.some((entry) => entry.kind === "version" && entry.version === version)) {
      return "model";
    }
    return (await this.mayMergeInBackground(version, head)) ? "model" : "rerere";
  }

  private async paidPlan(): Promise<boolean | null> {
    if (this.plan && Date.now() - this.plan.at < PLAN_TTL_MS) return this.plan.paid;
    const baseUrl = this.backendUrl();
    if (!baseUrl || !this.options.hasConnectedAccount()) return null;
    try {
      const status = await this.backendClient(baseUrl).read("billing.status", {}, { timeoutMs: 15_000 });
      this.plan = { paid: status.plan !== "free", at: Date.now() };
    } catch (error) {
      this.options.log("app-source.plan-unknown", { message: errorMessage(error) });
      this.plan = { paid: null, at: Date.now() - PLAN_TTL_MS + 60_000 };
    }
    return this.plan.paid;
  }

  private ownsMerge(version: string) {
    const me = this.options.getDeviceId?.();
    const update = this.update;
    return Boolean(
      me && update?.version === version && update.preparer?.deviceId === me && !update.result && !update.unresolved,
    );
  }

  /** Another computer on the account is merging `version` right now; this one waits for it. */
  private waitingOnOther(version: string) {
    const me = this.options.getDeviceId?.();
    const update = this.update;
    const preparer = update?.version === version ? update.preparer : null;
    return Boolean(
      preparer &&
        preparer.deviceId !== me &&
        !update!.result &&
        !update!.unresolved &&
        Date.now() - preparer.at < UPDATE_PREPARER_STALE_MS,
    );
  }

  private async mayMergeInBackground(version: string, head: string) {
    const me = this.options.getDeviceId?.();
    const baseUrl = this.backendUrl();
    if (!me || !baseUrl || !this.options.hasConnectedAccount()) return false;
    if ((await this.paidPlan()) !== true) return false;
    if (this.ownsMerge(version)) return true;
    const update = this.update?.version === version ? this.update : null;
    if (update?.result || update?.unresolved || this.waitingOnOther(version)) return false;
    const last = this.claimTried.get(version) ?? 0;
    if (Date.now() - last < CLAIM_RETRY_MS) return false;
    this.claimTried.set(version, Date.now());
    try {
      const { update: claimed } = await this.backendClient(baseUrl).call("appSource.claimUpdate", {
        version,
        deviceId: me,
        device: accountDeviceName(),
        base: head,
      });
      this.update = claimed;
      const mine = this.ownsMerge(version);
      this.options.log("app-source.merge-claimed", { version: version.slice(0, 12), mine });
      return mine;
    } catch (error) {
      this.options.log("app-source.merge-claim-failed", { message: errorMessage(error) });
      return false;
    }
  }

  /**
   * A merge preparing could not finish is shown (with what conflicts), except
   * while another computer on the account is merging the same version: its
   * result is what this one will take.
   */
  private conflictsToShow(version: string, record: PreparedUpdate): AppSourceConflicts | undefined {
    const files = record.unresolved ?? [];
    if (record.resolve === "model") return { files, why: "unsure" };
    if (this.waitingOnOther(version) || this.ownsMerge(version)) return undefined;
    const update = this.update?.version === version ? this.update : null;
    if (update?.unresolved) return { files: files.length ? files : update.unresolved, why: "unsure" };
    if (this.plan?.paid === false) return { files, why: "allowance" };
    if (this.plan?.paid === true && this.options.modelResolve && !update?.result) {
      const last = this.claimTried.get(version);
      if (last === undefined || Date.now() - last < CLAIM_RETRY_MS) return undefined;
    }
    return { files, why: "unsure" };
  }

  /** A version merged here goes to the account, so other computers with the same changes take it as is. */
  private async shareResult(version: string, head: string, record: PreparedUpdate) {
    const me = this.options.getDeviceId?.();
    const baseUrl = this.backendUrl();
    if (!me || !baseUrl || !this.options.hasConnectedAccount()) return;
    const merged = Boolean(record.to && record.resolvedBy);
    const gaveUp = !record.to && record.resolve === "model";
    if (!merged && !gaveUp) return;
    const key = `${version}:${record.to ?? "unresolved"}`;
    if (this.reported.has(key)) return;
    const update = this.update?.version === version ? this.update : null;
    if (update?.result || (gaveUp && !this.ownsMerge(version))) return;
    this.reported.add(key);
    if (!(await this.publishResult(version, head, merged ? record.to : null, record.unresolved))) {
      this.reported.delete(key);
    }
  }

  private async publishResult(version: string, base: string, to: string | null, unresolved?: string[]) {
    const me = this.options.getDeviceId?.();
    const baseUrl = this.backendUrl();
    if (!me || !baseUrl || !this.options.hasConnectedAccount()) return false;
    try {
      if (to) {
        const fork = (await this.sourceAccess())?.fork;
        if (!fork) throw new Error("No fork to share the merged version through.");
        await git(
          this.options.stellaAppDir,
          ["push", "--quiet", fork.remote, `+${to}:refs/tags/${updateResultTag(version)}`],
          { env: pushEnv(fork.token), timeoutMs: 5 * 60_000 },
        );
      }
      const { update: next } = await this.backendClient(baseUrl).call("appSource.updatePrepared", {
        version,
        deviceId: me,
        device: accountDeviceName(),
        base,
        result: to,
        ...(to ? {} : { unresolved: (unresolved ?? []).slice(0, 200) }),
      });
      this.update = next;
      this.options.log("app-source.update-shared", { version: version.slice(0, 12), merged: Boolean(to) });
      return true;
    } catch (error) {
      this.options.log("app-source.update-share-failed", { message: errorMessage(error) });
      return false;
    }
  }

  /** A version a task merged here goes to the account too, before Stella relaunches into it. */
  private async shareTaskMerge(name: string, to: string) {
    if (!isUpdateDraft(name)) return;
    const cwd = this.options.stellaAppDir;
    const version = (await gitRaw(cwd, ["rev-parse", "--verify", "--quiet", `${UPSTREAM_REF}^{commit}`])).stdout.trim();
    if (!version || mergeDraftName(version) !== name || !(await isAncestor(cwd, version, to))) return;
    const update = this.update?.version === version ? this.update : null;
    if (update?.result) return;
    const base = (await gitRaw(cwd, ["rev-parse", "--verify", "--quiet", `${to}^1`])).stdout.trim();
    if (!base) return;
    await Promise.race([this.publishResult(version, base, to), delay(6_000)]);
  }

  private onUpdate(update: AppSourceUpdate | null) {
    const before = JSON.stringify(this.update);
    this.update = update;
    void this.takeIncoming(update).catch((error: unknown) =>
      this.options.log("app-source.incoming-failed", { message: errorMessage(error) }),
    );
    if (before !== JSON.stringify(update)) void this.refresh();
  }

  /** Update pressed on another computer, for this one too: it is applied here by itself. */
  private async takeIncoming(update: AppSourceUpdate | null) {
    const apply = update?.apply;
    const me = this.options.getDeviceId?.();
    if (!update || !apply || !me || apply.deviceId === me) return;
    if (apply.targets && !apply.targets.includes(me)) return;
    const key = `${update.version}:${apply.at}`;
    const intent = await this.loadIntent();
    if (intent.handled.includes(key)) return;
    const cwd = this.options.stellaAppDir;
    const head = await git(cwd, ["rev-parse", "HEAD"]);
    const fresh = Date.now() - apply.at < WANTED_MAX_AGE_MS;
    const already = await isAncestor(cwd, update.version, head);
    await this.saveIntent((current) => {
      current.handled = [...current.handled, key];
      if (fresh && !already) {
        current.wanted = [
          ...current.wanted.filter((entry) => entry.kind !== "version"),
          {
            kind: "version",
            version: update.version,
            from: { deviceId: apply.deviceId, device: apply.device },
            at: Date.now(),
          },
        ];
      }
    });
    this.options.log("app-source.update-requested-elsewhere", {
      version: update.version.slice(0, 12),
      taken: fresh && !already,
    });
    if (fresh && !already) {
      this.wantSync("update");
      void this.refresh();
    }
  }

  private async announceApply(version: string, targets: string[] | null) {
    if (targets && targets.length === 0) return;
    const me = this.options.getDeviceId?.();
    const baseUrl = this.backendUrl();
    if (!me || !baseUrl || !this.options.hasConnectedAccount()) return;
    try {
      const call = this.backendClient(baseUrl).call("appSource.applyUpdate", {
        version,
        deviceId: me,
        device: accountDeviceName(),
        targets,
      });
      const { update } = await Promise.race([
        call,
        delay(APPLY_ANNOUNCE_TIMEOUT_MS).then(() => {
          throw new Error("timed out");
        }),
      ]);
      this.update = update;
      this.options.log("app-source.update-announced", {
        version: version.slice(0, 12),
        targets: targets === null ? "all" : targets.length,
      });
    } catch (error) {
      this.options.log("app-source.update-announce-failed", { message: errorMessage(error) });
    }
  }

  /**
   * What was asked for is applied as soon as it is ready, when the user's
   * hands are off Stella (or they're away), one at a time.
   */
  private considerWanted(state: AppSourceState) {
    if (this.wantTimer || this.disposed || state.busy || state.merging) return;
    const intent = this.intent;
    if (!intent || intent.wanted.length === 0) return;
    let action: (() => Promise<AppSourceActionResult>) | null = null;
    let label = "";
    for (const entry of intent.wanted) {
      if (entry.kind === "version") {
        const offer = state.waiting.find(
          (candidate): candidate is Extract<AppSourceWaiting, { kind: "version" }> =>
            candidate.kind === "version" && candidate.key === `version:${entry.version}`,
        );
        if (!offer) continue;
        if (offer.draft) {
          const name = offer.draft;
          action = () => this.applyDraftFor(name, entry);
        } else if (this.versionReady === entry.version) {
          action = () => this.exclusive((cwd) => this.takeUpstream(cwd, entry));
        } else if (!entry.task && this.versionNeedsTask(entry)) {
          action = async () => {
            // Things may have moved while waiting for a quiet moment.
            if (!this.versionNeedsTask(entry)) return { ok: true };
            await this.want({ ...entry, task: true });
            return await this.exclusive((cwd) => this.takeUpstream(cwd, entry));
          };
        }
        label = `version:${entry.version.slice(0, 12)}`;
      } else {
        const ready = state.waiting.some(
          (offer) =>
            (offer.kind === "draft" && offer.name === entry.name && !offer.stale) ||
            (offer.kind === "other-computer" && offer.draft === entry.name),
        );
        if (ready) action = () => this.applyDraftFor(entry.name, entry);
        label = `draft:${entry.name}`;
      }
      if (action) break;
    }
    if (!action) return;
    const run = action;
    const attempt = async () => {
      this.wantTimer = null;
      if (this.disposed || this.state.merging) return;
      const quiet = this.busy ? 0 : ((await this.options.userQuietFor?.()) ?? Infinity);
      if (quiet < AUTO_APPLY_QUIET_MS) {
        this.wantTimer = setTimeout(() => void attempt(), AUTO_APPLY_RETRY_MS);
        this.wantTimer.unref?.();
        return;
      }
      const result = await run();
      this.options.log("app-source.wanted-applied", {
        what: label,
        ok: result.ok,
        ...(result.ok ? {} : { error: result.error }),
      });
      if (!result.ok) {
        await this.saveIntent((intent) => {
          intent.wanted = intent.wanted.filter((entry) =>
            label.startsWith("version:") ? entry.kind !== "version" : !(entry.kind === "draft" && label === `draft:${entry.name}`),
          );
        });
        void this.refresh();
      }
    };
    this.wantTimer = setTimeout(() => void attempt(), 0);
  }

  /**
   * The background merge was not sure, so a task merges it (the press was the
   * go-ahead). A press from another computer first waits for that computer's
   * result: with the same changes here it is taken as is, and only a computer
   * whose own changes differ merges it itself.
   */
  private versionNeedsTask(entry: Extract<Wanted, { kind: "version" }>) {
    if (this.versionConflicts?.why !== "unsure" || this.waitingOnOther(entry.version)) return false;
    const update = this.update?.version === entry.version ? this.update : null;
    const waited = Date.now() - entry.at >= MERGE_WAIT_MS;
    if (entry.from && !update?.result && !waited) return false;
    // A merge from another computer is on its way: fetch and check it first,
    // and merge here only when it carries changes this checkout lacks.
    if (update?.result && this.resultUnusable !== update.result.sha && !waited) return false;
    return true;
  }

  private async noteArrived(entry: Wanted | undefined, to: string) {
    await this.saveIntent((intent) => {
      if (entry?.kind === "version") {
        intent.arrived = { sha: to, version: entry.version, from: entry.from?.device ?? null, at: Date.now() };
      }
      intent.wanted = intent.wanted.filter((other) =>
        entry?.kind === "draft"
          ? !(other.kind === "draft" && other.name === entry.name)
          : other.kind !== "version",
      );
    });
  }

  private applyDraftFor(name: string, entry: Wanted) {
    return this.exclusive((cwd) => this.takeDraft(cwd, name, (to) => this.noteArrived(entry, to)));
  }

  private async takeUpstream(cwd: string, wanted?: Wanted) {
    if (!this.upstreamTracked) throw new PlainFailure("nothing", "No update is available.");
    const version = await git(cwd, ["rev-parse", "--verify", `${UPSTREAM_REF}^{commit}`]);
    const head = await git(cwd, ["rev-parse", "HEAD"]);
    const target = await this.updateTarget(cwd, head, version);
    const entry: Extract<Wanted, { kind: "version" }> =
      wanted?.kind === "version" ? wanted : { kind: "version", version, from: null, at: Date.now() };
    return await this.take(cwd, {
      kind: "upstream",
      ref: target.ref,
      emptyMessage: "No update is available.",
      subject: `Merge the published Stella update ${version.slice(0, 12)}`,
      trustIdenticalTree: true,
      brief: upstreamMergeBrief,
      pendingDraft: mergeDraftName(version),
      pendingDraftExists: false,
      ...(wanted ? { settle: (to: string) => this.noteArrived(entry, to) } : {}),
      wanted: { ...entry, task: true },
    });
  }

  private recentLog(cwd: string) {
    return git(cwd, [
      "log",
      "--first-parent",
      `-n${RECENT_COUNT * 4}`,
      "--format=%H%x00%s%x00%ct%x00%T%x00%P",
      "HEAD",
    ]);
  }

  /**
   * Every commit HEAD moved to, with where it moved from and when (the most
   * recent such move). Read from HEAD's reflog file, which keeps the old
   * value that `git reflog`'s formats leave out.
   */
  private async headMoves(cwd: string): Promise<Map<string, HeadMove>> {
    const moves = new Map<string, HeadMove>();
    const file = await gitRaw(cwd, [
      "rev-parse",
      "--path-format=absolute",
      "--git-path",
      "logs/HEAD",
    ]);
    if (file.code !== 0) return moves;
    const text = await fs.readFile(file.stdout.trim(), "utf8").catch(() => "");
    for (const line of text.split("\n")) {
      // `<old> <new> <name> <<email>> <unix time> <zone>\t<message>`
      const match = /^([0-9a-f]+) ([0-9a-f]+) .* (\d+) [-+]\d{4}$/.exec(
        line.split("\t")[0] ?? "",
      );
      if (match) {
        moves.set(match[2]!, { from: match[1]!, at: Number(match[3]) * 1000 });
      }
    }
    return moves;
  }

  private async readRecent(cwd: string, log: string): Promise<RecentRow[]> {
    const published = new Set(
      (await gitRaw(cwd, ["rev-list", "-n", "5000", UPSTREAM_REF])).stdout.split("\n"),
    );
    const moves = await this.headMoves(cwd);
    const lines = log.split("\n").filter(Boolean).map((line) => line.split("\0"));
    const position = new Map(lines.map(([sha = ""], index) => [sha, index]));
    const rows: RecentRow[] = [];
    let arrival: number | undefined;
    let move: { last: number; row: RecentRow | null } | null = null;
    for (const [index, line] of lines.entries()) {
      const [sha = "", subject = "", seconds = "0", tree = "", parents = ""] = line;
      const [firstParent = "", ...others] = parents.split(" ").filter(Boolean);
      const moved = moves.get(sha);
      if (moved) {
        arrival = moved.at;
        const from = position.get(moved.from);
        move = { last: from !== undefined && from > index ? from - 1 : index, row: null };
      } else if (move && index > move.last) {
        move = null;
      }
      const parentTree = lines[index + 1]?.[3];
      if (parentTree !== undefined && parentTree === tree) continue;
      const kind: AppSourceCommit["kind"] =
        subject.startsWith(REMOTE_MERGE_SUBJECT)
          ? "other-computer"
          : subject.startsWith(UPSTREAM_MERGE_SUBJECT) ||
              published.has(sha) ||
              others.some((parent) => published.has(parent))
            ? "version"
            : "change";
      const joins =
        move?.row && move.row.commit.kind === kind
          ? move.row
          : kind === "version" && rows.at(-1)?.commit.kind === "version"
            ? rows.at(-1)!
            : null;
      if (joins) {
        joins.base = firstParent;
        continue;
      }
      if (rows.length >= RECENT_COUNT) break;
      const change = await this.changeOf(cwd, sha);
      const row: RecentRow = {
        commit: {
          sha,
          subject,
          date: arrival ?? Number(seconds) * 1000,
          kind,
          ...(change
            ? { agentId: change.agentId, ...(change.undone ? { undone: true } : {}) }
            : {}),
        },
        base: firstParent,
      };
      rows.push(row);
      if (move) move.row = row;
    }
    return rows;
  }

  private async mergedTree(cwd: string, onto: string, tip: string) {
    if (await isAncestor(cwd, tip, onto)) {
      return await git(cwd, ["rev-parse", `${onto}^{tree}`]);
    }
    if (await isAncestor(cwd, onto, tip)) {
      return await git(cwd, ["rev-parse", `${tip}^{tree}`]);
    }
    const merge = await gitRaw(cwd, ["merge-tree", "--write-tree", onto, tip]);
    if (merge.code === 1) return null;
    if (merge.code !== 0) {
      throw new Error(merge.stderr.trim() || "Could not work out the merge.");
    }
    return merge.stdout.split("\n")[0]!.trim();
  }

  private async offerFrom(
    cwd: string,
    head: string,
    ref: string,
    published: string | null,
  ): Promise<Offer | null> {
    const tip = (
      await gitRaw(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])
    ).stdout.trim();
    if (!tip || tip === head || (await isAncestor(cwd, tip, head))) return null;
    const tipOf = async (name: string) =>
      (await gitRaw(cwd, ["rev-parse", "--verify", "--quiet", `${name}^{commit}`]))
        .stdout.trim();
    const publishedTip = published ? await tipOf(published) : "";
    const fork = ref !== UPSTREAM_REF;
    const upstreamTip = fork && this.upstreamTracked ? await tipOf(UPSTREAM_REF) : "";
    const key = `${head}:${tip}:${publishedTip}:${upstreamTip}`;
    const known = this.offers.get(key);
    if (known) return known;
    const headTree = await git(cwd, ["rev-parse", `${head}^{tree}`]);
    const merged = await this.mergedTree(cwd, head, tip);
    let offer: Offer;
    if (merged === headTree) {
      offer = { tip, real: false, catchUp: true };
    } else if (fork && !(await this.bringsChange(cwd, head, tip, upstreamTip || null))) {
      offer = {
        tip,
        real: false,
        catchUp:
          !(await isAncestor(cwd, head, tip)) &&
          !(await this.bringsChange(cwd, head, tip, null)),
      };
    } else if (
      merged !== null &&
      publishedTip &&
      (await this.coveredBy(cwd, head, publishedTip, tip))
    ) {
      offer = { tip, real: false, catchUp: false };
    } else {
      offer = { tip, real: true, catchUp: false };
    }
    if (this.offers.size > 16) this.offers.clear();
    this.offers.set(key, offer);
    return offer;
  }

  private async bringsChange(
    cwd: string,
    head: string,
    tip: string,
    published: string | null,
  ) {
    const found = await git(cwd, [
      "rev-list",
      "--no-merges",
      "--max-count=1",
      tip,
      `^${head}`,
      ...(published ? [`^${published}`] : []),
    ]);
    return found !== "";
  }

  private async mergedElsewhere(cwd: string, tip: string) {
    if (!this.forkBranch) return null;
    const ref = `${FORK_REF_PREFIX}${this.forkBranch}`;
    const forkTip = (
      await gitRaw(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])
    ).stdout.trim();
    if (!forkTip) return null;
    const head = await git(cwd, ["rev-parse", "HEAD"]);
    if (
      !(await isAncestor(cwd, head, forkTip)) ||
      !(await isAncestor(cwd, tip, forkTip)) ||
      (await this.bringsChange(cwd, head, forkTip, tip))
    ) {
      return null;
    }
    return ref;
  }

  private async coveredBy(cwd: string, head: string, published: string, tip: string) {
    const withPublished = await this.mergedTree(cwd, head, published);
    if (withPublished === null) return false;
    const onto = (await isAncestor(cwd, published, head))
      ? head
      : (await isAncestor(cwd, head, published))
        ? published
        : await git(
            cwd,
            [
              "commit-tree",
              withPublished,
              "-p",
              head,
              "-p",
              published,
              "-m",
              UPSTREAM_MERGE_SUBJECT,
            ],
            { env: await this.identityEnv(cwd) },
          );
    return (await this.mergedTree(cwd, onto, tip)) === withPublished;
  }

  /** The newest change of the user's own that the other computer's `tip` brings. */
  private async forkChange(cwd: string, head: string, tip: string) {
    const out = await git(cwd, [
      "log",
      "--no-merges",
      "-n1",
      "--format=%H%x00%s",
      tip,
      `^${head}`,
      ...(this.upstreamTracked ? [`^${UPSTREAM_REF}`] : []),
    ]);
    const [sha = "", subject = ""] = out.trim().split("\0");
    return { sha: sha || tip, subject: subject.trim() };
  }

  private async forkDevice(cwd: string) {
    const [all, merged, own] = await Promise.all([
      git(cwd, [
        "for-each-ref",
        "--sort=-*committerdate",
        "--format=%(refname)%00%(contents:subject)",
        FORK_CHANGES_PREFIX,
      ]),
      git(cwd, ["for-each-ref", "--merged=HEAD", "--format=%(refname)", FORK_CHANGES_PREFIX]),
      git(cwd, ["for-each-ref", "--format=%(refname)", CHANGE_TAG_PREFIX]),
    ]);
    const here = new Set(merged.split("\n"));
    const mine = new Set(
      own.split("\n").map((ref) => ref.slice(CHANGE_TAG_PREFIX.length)),
    );
    for (const line of all.split("\n").filter(Boolean)) {
      const [refname = "", device = ""] = line.split("\0");
      const key = refname.slice(FORK_CHANGES_PREFIX.length);
      if (here.has(refname) || mine.has(key)) continue;
      if (device.trim()) return device.trim();
    }
    return "";
  }

  private catchUpLater(ref: string, tip: string, head: string) {
    if (this.catchingUp || this.busy || this.disposed) return;
    if (this.state.merging) return;
    const attempt = `${head}:${tip}`;
    if (this.caughtUp.has(attempt)) return;
    if (this.caughtUp.size > 64) this.caughtUp.clear();
    this.caughtUp.add(attempt);
    this.catchingUp = true;
    void this.exclusive(async (cwd) => {
      if (!(await this.catchUp(cwd, ref, tip))) this.caughtUp.delete(attempt);
    }).finally(() => {
      this.catchingUp = false;
    });
  }

  private async catchUp(cwd: string, ref: string, tip: string) {
    const worktrees = await listWorktrees(cwd);
    if (worktrees.some((tree) => tree.branch?.startsWith(DRAFT_REF_PREFIX))) {
      return false;
    }
    const head = await git(cwd, ["rev-parse", "HEAD"]);
    if (await isAncestor(cwd, tip, head)) return true;
    const tree = await git(cwd, ["rev-parse", `${head}^{tree}`]);
    const ahead = await isAncestor(cwd, head, tip);
    if (
      (await this.mergedTree(cwd, head, tip)) !== tree &&
      (ref === UPSTREAM_REF || ahead || (await this.bringsChange(cwd, head, tip, null)))
    ) {
      return true;
    }
    const to = ahead
      ? tip
      : await git(
          cwd,
          ["commit-tree", tree, "-p", head, "-p", tip, "-m", CATCH_UP_SUBJECT],
          { env: await this.identityEnv(cwd) },
        );
    await this.moveHead(cwd, head, to);
    this.options.log("app-source.caught-up", {
      from: ref === UPSTREAM_REF ? "upstream" : "remote",
    });
    return true;
  }

  private async skippedKeys(cwd: string) {
    if (!this.skipped) {
      const file = path.join(await this.commonDir(cwd), SKIPPED_FILE);
      let saved: unknown = [];
      try {
        saved = JSON.parse(await fs.readFile(file, "utf8"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          this.options.log("app-source.skipped-unreadable", {
            message: errorMessage(error),
          });
        }
      }
      this.skipped = new Set(
        Array.isArray(saved)
          ? saved.filter((key): key is string => typeof key === "string")
          : [],
      );
    }
    return this.skipped;
  }

  async skip(key: string): Promise<AppSourceActionResult> {
    if (!SKIP_KEY.test(key)) return { ok: false, error: "Unknown update." };
    const cwd = this.options.stellaAppDir;
    try {
      const skipped = await this.skippedKeys(cwd);
      skipped.add(key);
      const offered = new Set(this.offeredKeys);
      this.skipped = new Set([...skipped].filter((entry) => entry === key || offered.has(entry)));
      const file = path.join(await this.commonDir(cwd), SKIPPED_FILE);
      await fs.writeFile(`${file}.tmp`, JSON.stringify([...this.skipped]));
      await fs.rename(`${file}.tmp`, file);
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
    void this.refresh();
    return { ok: true };
  }

  private async compareRef(cwd: string, head: string, ref: string) {
    const tip = (
      await gitRaw(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])
    ).stdout.trim();
    if (!tip || tip === head || (await isAncestor(cwd, tip, head))) return null;
    const [count, subject, ahead] = await Promise.all([
      git(cwd, ["rev-list", "--count", `${head}..${tip}`]),
      git(cwd, ["log", "-1", "--format=%s", tip]),
      isAncestor(cwd, head, tip),
    ]);
    return {
      status: ahead ? ("ahead" as const) : ("diverged" as const),
      count: Number(count),
      subject,
    };
  }

  private followBackend() {
    if (this.disposed) return;
    const baseUrl = this.backendUrl();
    this.releases.follow(baseUrl);
    const watchFork = baseUrl && this.options.hasConnectedAccount() ? baseUrl : null;
    this.followUpdates(watchFork);
    if (this.forkWatch?.baseUrl === watchFork) return;
    this.forkWatch?.stop();
    this.forkWatch = null;
    if (!watchFork) return;
    this.forkPushSeen = null;
    const client = this.backendClient(watchFork);
    const stop = client.watch(
      "appSource.fork",
      {},
      (value) => this.onForkPush(value.pushedAt),
      (error) =>
        this.options.log("app-source.fork-watch-failed", {
          message: errorMessage(error),
        }),
    );
    this.forkWatch = { baseUrl: watchFork, stop };
  }

  /** The account's record of the published version on its way to its computers. */
  private followUpdates(baseUrl: string | null) {
    if (this.updateWatch?.baseUrl === baseUrl) return;
    this.updateWatch?.stop();
    this.updateWatch = null;
    this.update = null;
    if (!baseUrl) return;
    const stop = this.backendClient(baseUrl).watch(
      "appSource.update",
      {},
      (value) => this.onUpdate(value.update),
      (error) =>
        this.options.log("app-source.update-watch-failed", {
          message: errorMessage(error),
        }),
    );
    this.updateWatch = { baseUrl, stop };
  }

  private async currentOwner() {
    if (!this.options.hasConnectedAccount()) return null;
    return tokenSubject(await this.options.getAuthToken()) ?? "";
  }

  private async followOwner() {
    if (!this.access || this.disposed) return;
    const owner = await this.currentOwner().catch(() => this.access?.owner ?? null);
    if (this.access && owner !== this.access.owner) {
      this.forgetAccount();
      this.wantSync("account");
    }
  }

  private forgetAccount() {
    this.options.log("app-source.account-changed", {});
    this.access = null;
    this.forkBranch = null;
    this.forkUnrelated = false;
    this.shares.clear();
    this.notShared = null;
    this.forkPushSeen = null;
    this.ownForkPushes.clear();
    this.forkPushHeld = null;
    this.forkWatch?.stop();
    this.forkWatch = null;
    this.updateWatch?.stop();
    this.updateWatch = null;
    this.update = null;
    this.followBackend();
  }

  private onPublished(version: string | null) {
    this.published = version;
    if (!version || version === this.syncedFor) return;
    void gitRaw(this.options.stellaAppDir, ["rev-parse", "--verify", "--quiet", UPSTREAM_REF])
      .then((result) => {
        if (result.code === 0 && result.stdout.trim() === version) {
          this.syncedFor = version;
          return;
        }
        this.options.log("app-source.published", { version });
        this.wantSync("published");
      })
      .catch(() => this.wantSync("published"));
  }

  private onForkPush(pushedAt: number | null) {
    if (pushedAt === null || pushedAt === this.forkPushSeen) return;
    const first = this.forkPushSeen === null;
    this.forkPushSeen = pushedAt;
    if (first) {
      if (!this.forkUnrelated) this.wantSync("fork");
      return;
    }
    if (this.forkReports > 0) {
      this.forkPushHeld = pushedAt;
      return;
    }
    this.onOthersForkPush(pushedAt);
  }

  private onOthersForkPush(pushedAt: number) {
    if (this.ownForkPushes.has(pushedAt) || this.forkUnrelated) return;
    this.options.log("app-source.fork-pushed", { pushedAt });
    this.wantSync("fork");
  }

  private wantSync(reason: string) {
    if (!this.syncWanted) this.syncReason = reason;
    this.syncWanted = true;
    const wait = this.syncNotBefore - Date.now();
    if (wait <= 0) {
      void this.syncFork();
      return;
    }
    if (this.syncTimer) return;
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      if (this.syncWanted) void this.syncFork();
    }, wait);
    this.syncTimer.unref?.();
  }

  async syncFork() {
    if (this.disposed || this.busy || this.syncing) return;
    this.syncing = true;
    const cwd = this.options.stellaAppDir;
    const target = this.published;
    let outcome: "done" | "deferred" | "failed" = "failed";
    try {
      const worktrees = await listWorktrees(cwd);
      if (worktrees.some((tree) => tree.branch?.startsWith(DRAFT_REF_PREFIX))) {
        outcome = "deferred";
        return;
      }
      this.syncWanted = false;
      this.options.log("app-source.sync", { reason: this.syncReason });
      this.forkUnrelated = false;
      const access = await this.sourceAccess();
      if (!access) {
        outcome = "done";
        return;
      }
      if (access.fork) {
        await this.syncWithFork(cwd, access.fork).catch((error) => {
          this.options.log("app-source.fork-sync-failed", {
            message: errorMessage(error),
          });
        });
      }
      await this.fetchUpstream(cwd, access.upstream);
      outcome = "done";
    } catch (error) {
      this.options.log("app-source.sync-failed", {
        message: errorMessage(error),
      });
    } finally {
      this.syncing = false;
      if (outcome === "done") {
        this.syncFailures = 0;
        this.syncedFor = target;
      } else if (outcome === "failed") {
        this.syncWanted = true;
        this.syncReason = "retry";
        this.syncNotBefore =
          Date.now() + Math.min(SYNC_RETRY_MAX_MS, SYNC_RETRY_MS * 2 ** this.syncFailures);
        this.syncFailures += 1;
      }
      void this.refresh();
      if (outcome !== "deferred" && this.syncWanted) this.wantSync(this.syncReason);
    }
  }

  private async syncWithFork(cwd: string, fork: ForkAccess) {
    const ref = `${FORK_REF_PREFIX}${fork.branch}`;
    await git(
      cwd,
      [
        "fetch",
        "--quiet",
        "--no-tags",
        "--no-write-fetch-head",
        fork.remote,
        `+refs/heads/${fork.branch}:${INCOMING_REF}`,
        `+${CHANGE_TAG_PREFIX}*:${FORK_CHANGES_PREFIX}*`,
      ],
      { env: fetchEnv(fork.token), timeoutMs: 5 * 60_000 },
    );
    if (!(await this.adoptFetched(cwd, ref))) {
      this.forkUnrelated = true;
      this.forkBranch = null;
      this.options.log("app-source.fork-unrelated", {});
      return;
    }
    this.forkBranch = fork.branch;
    await this.pushIfAhead(cwd, fork);
  }

  private async fetchUpstream(cwd: string, upstream: AppSourceRemote) {
    await git(
      cwd,
      [
        "fetch",
        "--quiet",
        "--no-tags",
        "--no-write-fetch-head",
        upstream.remote,
        `+refs/heads/main:${INCOMING_REF}`,
      ],
      { env: fetchEnv(upstream.token), timeoutMs: 5 * 60_000 },
    );
    if (!(await this.adoptFetched(cwd, UPSTREAM_REF))) {
      this.upstreamTracked = false;
      this.options.log("app-source.upstream-unrelated", {});
      return;
    }
    this.upstreamTracked = true;
  }

  /**
   * Moves `ref` to what was just fetched, only when that shares history with
   * this checkout: unrelated history (another backend's copy) never replaces
   * what is tracked here.
   */
  private async adoptFetched(cwd: string, ref: string) {
    try {
      if ((await gitRaw(cwd, ["merge-base", "HEAD", INCOMING_REF])).code !== 0) return false;
      await git(cwd, ["update-ref", ref, INCOMING_REF]);
      return true;
    } finally {
      await gitRaw(cwd, ["update-ref", "-d", INCOMING_REF]).catch(() => undefined);
    }
  }

  private pushToFork() {
    if (!this.forkBranch) return;
    void (async () => {
      const fork = (await this.sourceAccess())?.fork;
      if (fork) await this.pushIfAhead(this.options.stellaAppDir, fork);
    })()
      .catch((error) => {
        this.options.log("app-source.fork-push-failed", {
          message: errorMessage(error),
        });
      })
      .finally(() => void this.refresh());
  }

  private async pushIfAhead(cwd: string, fork: ForkAccess) {
    const ref = `${FORK_REF_PREFIX}${fork.branch}`;
    const head = await git(cwd, ["rev-parse", "HEAD"]);
    const forkTip = await git(cwd, ["rev-parse", "--verify", ref]);
    let pushed = false;
    if (forkTip === head || (await isAncestor(cwd, head, forkTip))) {
      this.notShared = null;
    } else if (!(await isAncestor(cwd, forkTip, head))) {
      // Another computer's change is on the account's copy and not here
      // (skipped, or not taken yet): this computer's own changes can only
      // reach it inside a merge of the two.
      this.shareLater(cwd, fork);
    } else {
      this.notShared = null;
      await git(
        cwd,
        ["push", "--quiet", fork.remote, `HEAD:refs/heads/${fork.branch}`],
        { env: pushEnv(fork.token), timeoutMs: 5 * 60_000 },
      );
      await git(cwd, ["update-ref", ref, head]);
      pushed = true;
      const onPushed = this.options.onPushed;
      if (onPushed) {
        void Promise.resolve()
          .then(() => onPushed(cwd))
          .catch((error) => {
            this.options.log("app-source.on-pushed-failed", {
              message: errorMessage(error),
            });
          });
      }
    }
    if ((await this.pushChangeTags(cwd, fork, ref)) || pushed) {
      this.reportForkPush(await git(cwd, ["rev-parse", ref]));
    }
  }

  /** Shares this computer's changes in the background: a merge is checked by building it first. */
  private shareLater(cwd: string, fork: ForkAccess) {
    if (this.sharing) {
      this.shareAgain = true;
      return;
    }
    this.sharing = true;
    void this.shareMerge(cwd, fork)
      .catch((error) => {
        this.options.log("app-source.fork-share-failed", {
          message: errorMessage(error),
        });
      })
      .finally(() => {
        this.sharing = false;
        void this.refresh();
        if (this.shareAgain && !this.disposed) {
          this.shareAgain = false;
          this.pushToFork();
        }
      });
  }

  private async shareMerge(cwd: string, fork: ForkAccess) {
    const ref = `${FORK_REF_PREFIX}${fork.branch}`;
    const [head, forkTip] = await Promise.all([
      git(cwd, ["rev-parse", "HEAD"]),
      git(cwd, ["rev-parse", "--verify", ref]),
    ]);
    if (
      forkTip === head ||
      (await isAncestor(cwd, head, forkTip)) ||
      (await isAncestor(cwd, forkTip, head))
    ) {
      return;
    }
    const key = `${forkTip}:${head}`;
    let share = this.shares.get(key);
    if (!share) {
      share = await this.mergeToShare(cwd, forkTip, head);
      if (this.shares.size >= 32) this.shares.clear();
      this.shares.set(key, share);
    }
    if (share.kind !== "merge") {
      this.notShared = share.kind === "nothing" ? null : share.kind;
      return;
    }
    await git(
      cwd,
      ["push", "--quiet", fork.remote, `${share.merge}:refs/heads/${fork.branch}`],
      { env: pushEnv(fork.token), timeoutMs: 5 * 60_000 },
    );
    await git(cwd, ["update-ref", ref, share.merge, forkTip]);
    this.notShared = null;
    this.options.log("app-source.fork-shared", { merge: share.merge, head });
    await this.pushChangeTags(cwd, fork, ref);
    this.reportForkPush(share.merge);
  }

  /**
   * The account's copy with this computer's changes merged in, built first
   * like any merge Stella makes: the other computers take it as it is. A
   * clash, or a merge that would not build, is held back, so this computer's
   * changes stay here as they did before, and the Updates tab says so.
   */
  private async mergeToShare(cwd: string, forkTip: string, head: string): Promise<Share> {
    const merged = await gitRaw(cwd, ["merge-tree", "--write-tree", forkTip, head]);
    if (merged.code === 1) {
      this.options.log("app-source.fork-share-held", {
        reason: "conflict",
        files: conflictedPaths(merged.stdout).length,
      });
      return { kind: "conflict" };
    }
    if (merged.code !== 0) {
      throw new Error(merged.stderr.trim() || "Could not work out the merge.");
    }
    const tree = merged.stdout.split("\n")[0]!.trim();
    if (tree === (await git(cwd, ["rev-parse", `${forkTip}^{tree}`]))) {
      return { kind: "nothing" };
    }
    const merge = await git(
      cwd,
      [
        "commit-tree",
        tree,
        "-p",
        forkTip,
        "-p",
        head,
        "-m",
        `${REMOTE_MERGE_SUBJECT} ${head.slice(0, 12)}`,
      ],
      { env: await this.identityEnv(cwd) },
    );
    const gate = await checkMergedUpdate(
      cwd,
      merge,
      `${this.options.updateScratchDir}-share`,
      this.options.log,
      { background: true },
    );
    if (!gate.ok) {
      this.options.log("app-source.fork-share-held", {
        reason: "build",
        output: gate.output.slice(-400),
      });
      return { kind: "build" };
    }
    return { kind: "merge", merge };
  }

  private reportForkPush(tip: string) {
    const baseUrl = this.backendUrl();
    if (!baseUrl || !this.options.hasConnectedAccount()) return;
    this.forkReports += 1;
    void this.backendClient(baseUrl)
      .call("appSource.forkPushed", { tip })
      .then(({ pushedAt }) => {
        this.ownForkPushes.add(pushedAt);
        if (this.ownForkPushes.size > 50) {
          this.ownForkPushes.delete(this.ownForkPushes.values().next().value!);
        }
      })
      .catch((error) => {
        this.options.log("app-source.fork-push-report-failed", {
          message: errorMessage(error),
        });
      })
      .finally(() => {
        this.forkReports -= 1;
        const held = this.forkPushHeld;
        if (this.forkReports > 0 || held === null) return;
        this.forkPushHeld = null;
        this.onOthersForkPush(held);
      });
  }

  private async pushChangeTags(
    cwd: string,
    fork: ForkAccess,
    forkRef: string,
  ): Promise<boolean> {
    const format = "--format=%(refname)%00%(objectname)";
    const [own, pushed] = await Promise.all([
      git(cwd, ["for-each-ref", `--merged=${forkRef}`, format, CHANGE_TAG_PREFIX]),
      git(cwd, ["for-each-ref", format, FORK_CHANGES_PREFIX]),
    ]);
    const onFork = new Set(
      pushed.split("\n").map((line) => line.slice(FORK_CHANGES_PREFIX.length)),
    );
    const tags = own
      .split("\n")
      .filter((line) => line && !onFork.has(line.slice(CHANGE_TAG_PREFIX.length)))
      .map((line) => line.split("\0") as [string, string]);
    if (tags.length === 0) return false;
    await git(
      cwd,
      ["push", "--quiet", fork.remote, ...tags.map(([name]) => `+${name}:${name}`)],
      { env: pushEnv(fork.token), timeoutMs: 5 * 60_000 },
    );
    for (const [name, object] of tags) {
      const key = name.slice(CHANGE_TAG_PREFIX.length);
      await git(cwd, ["update-ref", `${FORK_CHANGES_PREFIX}${key}`, object]);
    }
    return true;
  }

  private async sourceAccess(): Promise<SourceAccess | null> {
    await this.checkLinkedCheckout();
    const baseUrl = this.backendUrl();
    if (!baseUrl) return null;
    const owner = await this.currentOwner();
    const cached = this.access;
    if (cached && cached.owner !== owner) this.forgetAccount();
    if (
      cached &&
      cached.owner === owner &&
      Math.min(cached.upstream.expiresAt, cached.fork?.expiresAt ?? Infinity) -
        60_000 >
        Date.now()
    ) {
      return cached;
    }
    const access: SourceAccess =
      owner !== null
        ? { owner, ...(await this.accountAccess(baseUrl)) }
        : { owner, fork: null, upstream: await this.bootstrapAccess(baseUrl) };
    if (owner !== (await this.currentOwner())) {
      throw new Error("The account changed while checking for updates.");
    }
    this.access = access;
    return access;
  }

  private async bootstrapAccess(baseUrl: string): Promise<AppSourceRemote> {
    const response = await fetch(
      `${baseUrl.replace(/\/+$/, "")}${BOOTSTRAP_PATH}`,
      { method: "POST", signal: AbortSignal.timeout(30_000) },
    );
    if (!response.ok) {
      throw new Error(`Update check failed (${response.status}).`);
    }
    const body = (await response.json()) as { upstream?: AppSourceRemote };
    const upstream = body.upstream;
    if (
      typeof upstream?.remote !== "string" ||
      typeof upstream.token !== "string" ||
      typeof upstream.expiresAt !== "number"
    ) {
      throw new Error("Update check returned an unexpected response.");
    }
    return upstream;
  }

  private backendClient(baseUrl: string): BackendClient {
    if (this.backend?.baseUrl !== baseUrl) {
      this.backend?.client.dispose();
      this.forkWatch = null;
      this.updateWatch = null;
      this.backend = {
        baseUrl,
        client: new BackendClient({
          baseUrl,
          getToken: () => this.options.getAuthToken(),
        }),
      };
    }
    return this.backend.client;
  }

  private async accountAccess(
    baseUrl: string,
  ): Promise<Omit<SourceAccess, "owner">> {
    const client = this.backendClient(baseUrl);
    for (let attempt = 1; ; attempt += 1) {
      try {
        const { fork, upstream } = await client.call(
          "appSource.access",
          {},
        );
        return {
          fork: {
            remote: fork.remote,
            branch: fork.defaultBranch,
            token: fork.token,
            expiresAt: fork.expiresAt,
          },
          upstream,
        };
      } catch (error) {
        if (
          attempt < ACCESS_ATTEMPTS &&
          error instanceof BackendRequestError &&
          error.code === "UNAVAILABLE" &&
          error.retryable &&
          !this.disposed
        ) {
          await delay(error.retryAfterMs ?? 2_000);
          continue;
        }
        throw error;
      }
    }
  }
}
