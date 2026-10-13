import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { app } from "electron";
import {
  BackendClient,
  BackendRequestError,
} from "@stella/contracts/backend/client";
import type { AppSourceRemote } from "@stella/contracts/backend/app-source";
import type {
  AppSourceActionResult,
  AppSourceCommit,
  AppSourceDraft,
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
import { DRAFT_AGENTS_DIR, installCheckoutGuard } from "./checkout-guard.js";
import { ReleaseChannel } from "./release-channel.js";
import type { CoveredWindow, RelaunchHold } from "./update-transition.js";
import {
  classifyUpdate,
  conflictedPaths,
  installs,
  relaunches,
  restartsRuntime,
  type UpdatePlan,
} from "./update-plan.js";
import {
  checkMergedUpdate,
  prebuildElectronBundles,
  prepareInstallAhead,
} from "./update-gate.js";
import {
  UpdatePreparer,
  type PrepareJob,
  type PreparedUpdate,
} from "./update-prepare.js";
import {
  mergeDraftName,
  remoteMergeBrief,
  staleDraftBrief,
  undoBrief,
  upstreamMergeBrief,
  type AgentBrief,
} from "./app-source-briefs.js";

/**
 * Applies finished drafts to the app's own checkout, undoes recent commits,
 * keeps the checkout in step with the owner's fork on Artifacts, and takes
 * updates from the published app (upstream).
 *
 * The service never polls the backend. It fetches at launch, when the
 * backend's release channel says a new version was published (it says so
 * again on every reconnect), and when the owner's `appSource.fork` view says
 * another computer pushed to the fork.
 *
 * Git is the only bookkeeping: drafts are `draft/<name>` branches (in
 * progress while a worktree has one checked out), "recent" is first-parent
 * history, and the fork and upstream are remote-tracking refs. Every git call
 * is async so main never blocks on one.
 */

type AppSourceServiceOptions = {
  stellaAppDir: string;
  broadcast: (state: AppSourceState) => void;
  isAnyWindowVisible: () => boolean;
  requestRuntimeRestart: () => void;
  applyRendererChanges: (paths: string[]) => Promise<unknown> | undefined;
  /**
   * Quit and start again. With `keepRuntime`, the runtime stays up for the
   * next process to attach to: the update did not change it.
   */
  relaunch: (options?: { keepRuntime?: boolean }) => void;
  hasConnectedAccount: () => boolean;
  getBackendUrl: () => string | null;
  getAuthToken: () => Promise<string | null>;
  log: (event: string, data: Record<string, unknown>) => void;
  /** After a successful push to the fork. Not awaited by the push. */
  onPushed?: (cwd: string) => void | Promise<void>;
  /**
   * After an apply, undo, applyRemote or applyUpstream lands in the checkout,
   * before it is swapped in. A throw fails the action.
   */
  afterApply?: (cwd: string) => void | Promise<void>;
  /**
   * Runs before every action, against the checkout as it stands. A throw
   * refuses the action (the launcher refuses to act on an unsigned HEAD).
   */
  beforeAction?: (cwd: string) => void | Promise<void>;
  /**
   * Picture and cover the window before a renderer swap; the covered window
   * then runs the swap and reveals it. Null runs the swap plain.
   */
  coverRenderer?: () => Promise<CoveredWindow | null>;
  /**
   * Before a relaunch: frost the window on screen while the next process is
   * made ready, committed once the relaunch is certain. Never throws.
   */
  beforeRelaunch?: () => Promise<RelaunchHold | null>;
  /**
   * The launcher prepares the tree again on every relaunch: do that here,
   * while the window is held, so its run finds the work done.
   */
  launcherPreparesOnRelaunch?: boolean;
  /**
   * Before a relaunch, what was made ready here that the launcher would
   * otherwise redo: the dependencies for this lockfile, the setup for this
   * HEAD.
   */
  reportPrepared?: (prepared: { lockHash?: string; head?: string }) => void;
  /**
   * Scratch copy for checking a merged update, removed after each check.
   * Versions prepared before they are offered keep their records next to
   * it (see `UpdatePreparer`).
   */
  updateScratchDir: string;
  /**
   * Hand git work that needs a judgement to a background agent. Absent when
   * no runtime is up, which leaves that work unavailable rather than done
   * unchecked.
   */
  dispatchAgentBrief?: (brief: AgentBrief) => Promise<void>;
};

/**
 * A version this checkout can take, and what taking it means. The published
 * app, the owner's other computer and a finished draft whose base moved differ
 * only in where the commits come from, whether their tree is already known good,
 * and what becomes of the draft afterwards — never in how the merge itself is
 * decided, which is why they share `take`.
 */
type TakeSource = {
  kind: "upstream" | "remote" | "draft";
  /** The ref holding the commits to take. */
  ref: string;
  /** Said when the ref holds nothing this checkout lacks. */
  emptyMessage: string;
  /** Message for the merge commit, when a merge has to be made. */
  subject: string;
  /**
   * A merged tree identical to the ref's own tree needs no check. True only
   * for upstream: that tree is published, and publishing builds it. The fork
   * is another of the owner's computers and a draft is an agent's work;
   * neither tree was ever built by this path, so being identical to one of
   * them proves nothing about it.
   */
  trustIdenticalTree: boolean;
  brief: (
    plan: Extract<UpdatePlan, { kind: "clean" | "conflict" }>,
    head: string,
    gateOutput?: string,
  ) => AgentBrief;
  /** The draft the app takes once an agent has finished it. */
  pendingDraft: string;
  /**
   * That draft already exists before any agent runs (a stale draft of the
   * user's is brought up to date on its own branch). Then only a worktree on
   * it means someone is on it; for a draft the app names, the branch existing
   * at all means an agent has already made it.
   */
  pendingDraftExists: boolean;
  /** Runs with the checkout advanced onto the merge, before the swap. */
  settle?: (to: string) => Promise<void>;
};

type ForkAccess = {
  remote: string;
  branch: string;
  token: string;
  expiresAt: number;
};

/** The fork exists only for a signed-in owner; upstream is always readable. */
type SourceAccess = { fork: ForkAccess | null; upstream: AppSourceRemote };

/** Rereads local git state (drafts, worktrees); never touches the network. */
const STATE_POLL_MS = 10_000;
/** How long "Stella is up to date" stays in the chat after an update lands. */
/** A merge that never arrives stops being announced after this. */
const UPDATE_MERGE_WAIT_MS = 60 * 60_000;
/** The launch sync waits this long, off the startup path. */
const LAUNCH_SYNC_DELAY_MS = 5_000;
/** A failed sync is retried after this, doubling up to the cap. */
const SYNC_RETRY_MS = 30_000;
const SYNC_RETRY_MAX_MS = 10 * 60_000;
const RECENT_COUNT = 20;
/**
 * A history row and what Undo takes out for it: the commits in
 * `base..commit.sha`, which arrived together.
 */
type RecentRow = { commit: AppSourceCommit; base: string };
/** Where HEAD moved to a commit from, most recently, and when. */
type HeadMove = { from: string; at: number };
/** Under the git common dir: offers the user skipped, by key. */
const SKIPPED_FILE = "stella-updates-skipped.json";
const UPSTREAM_MERGE_SUBJECT = "Merge the published Stella update";
const REMOTE_MERGE_SUBJECT = "Merge the changes from another computer";
const CATCH_UP_SUBJECT = "Catch up with Stella on your other computers";
const SKIP_KEY = /^(version|other|draft):[0-9a-f]{40}([0-9a-f]{24})?$/;
const FORK_REF_PREFIX = "refs/remotes/stella-fork/";
const UPSTREAM_REF = "refs/remotes/stella-upstream/main";
/** Under the git common dir: the agent whose draft each applied commit was. */
const COMMIT_AGENTS_DIR = "stella-commits";
/**
 * An agent's change applied here is tagged `stella-change/<hex agent id>`,
 * annotated with this computer's name, and pushed to the fork with main, so
 * the owner's other computers can offer it on that agent's completion.
 */
const CHANGE_TAG = "stella-change/";
const CHANGE_TAG_PREFIX = `refs/tags/${CHANGE_TAG}`;
/** Every computer's change tags, as last fetched from the fork. */
const FORK_CHANGES_PREFIX = "refs/stella/fork-changes/";
/** Public: anonymous users read upstream with a shared, edge-cached token. */
const BOOTSTRAP_PATH = "/api/app-source/bootstrap";
const ACCESS_ATTEMPTS = 5;

const NO_UPSTREAM: AppSourceState["upstream"] = {
  status: "none",
  count: 0,
  subject: "",
};

const EMPTY_STATE: AppSourceState = {
  ready: [],
  stale: [],
  remote: { status: "none", count: 0 },
  upstream: NO_UPSTREAM,
  recent: [],
  waiting: [],
  skipped: [],
  busy: false,
};

/**
 * Another version, judged by the files taking it would change here rather
 * than by its history. `real` is false when it brings nothing this computer
 * lacks; `catchUp` then says the history alone can be joined, silently,
 * because the result is this computer's own tree.
 */
type Offer = { tip: string; real: boolean; catchUp: boolean };

/** This computer, as the owner's other computers name it. */
const deviceName = () =>
  hostname()
    .trim()
    .replace(/\.(local|localdomain|lan|home)$/i, "");

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

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
  private refreshing: Promise<void> | null = null;
  private refreshAgain = false;
  private syncing = false;
  /** A sync was asked for and hasn't run yet (deferred by a draft or an action). */
  private syncWanted = false;
  /** No sync starts before this: the launch delay, or a failure's backoff. */
  private syncNotBefore = 0;
  private syncFailures = 0;
  private syncTimer: NodeJS.Timeout | null = null;
  /** The newest version the release channel announced. */
  private published: string | null = null;
  /** The announced version the last completed sync fetched for. */
  private syncedFor: string | null = null;
  private readonly releases: ReleaseChannel;
  private forkWatch: { baseUrl: string; stop: () => void } | null = null;
  /** `appSource.fork`'s last `pushedAt`, and the ones this computer made. */
  private forkPushSeen: number | null = null;
  private readonly ownForkPushes = new Set<number>();
  private timers: NodeJS.Timeout[] = [];
  private backend: { baseUrl: string; client: BackendClient } | null = null;
  private access: SourceAccess | null = null;
  /** The fork's branch, once fetched and found to share history with HEAD. */
  private forkBranch: string | null = null;
  private forkUnrelated = false;
  /** Upstream was fetched and shares history with HEAD. */
  private upstreamTracked = false;
  private upstreamUnrelated = false;
  /**
   * An official update an agent is merging; "merging" names the draft it is
   * preparing.
   */
  private updateState:
    | { state: "merging"; name: string; since: number; from: TakeSource["kind"] }
    | null = null;
  private offers = new Map<string, Offer>();
  private catchingUp = false;
  private caughtUp = new Set<string>();
  private skipped: Set<string> | null = null;
  private offeredKeys: string[] = [];
  private disposed = false;
  /** The action under way: where its time went, step by step. */
  private timeline: { last: number; startedAt: number; steps: string[] } | null =
    null;
  private readonly onFocus = () => void this.refresh();
  private readonly preparer: UpdatePreparer;

  constructor(options: AppSourceServiceOptions) {
    this.options = options;
    this.preparer = new UpdatePreparer({
      cwd: options.stellaAppDir,
      root: `${options.updateScratchDir}-prepared`,
      scratch: `${options.updateScratchDir}-prepare`,
      log: options.log,
      onPrepared: () => void this.refresh(),
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
      // Local checks only: sign-in or backend changes, and a sync a draft
      // or an action deferred.
      this.followBackend();
      if (this.syncWanted && Date.now() >= this.syncNotBefore) void this.syncFork();
    }, STATE_POLL_MS);
    poll.unref?.();
    this.timers = [poll];
    // The launch sync: the fork, upstream, and a push of anything this
    // computer applied while it couldn't reach the fork.
    this.syncNotBefore = Date.now() + LAUNCH_SYNC_DELAY_MS;
    this.wantSync();
    this.followBackend();
    void installCheckoutGuard(this.options.stellaAppDir, this.options.log).catch(
      (error: unknown) =>
        this.options.log("app-source.checkout-guard-failed", {
          error: error instanceof Error ? error.message : String(error),
        }),
    );
    void this.refresh();
  }

  dispose() {
    this.disposed = true;
    this.preparer.pause();
    app.removeListener("browser-window-focus", this.onFocus);
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = null;
    this.releases.dispose();
    this.forkWatch?.stop();
    this.forkWatch = null;
    this.backend?.client.dispose();
  }

  getState(): AppSourceState {
    void this.refresh();
    return this.state;
  }

  /**
   * Take a finished draft. One made against an older version used to be
   * refused here and sent to an agent as a sentence typed into the chat on
   * the user's behalf; now it merges like anything else, and only a real
   * conflict in the user's own change reaches an agent.
   */
  applyDraft(name: string) {
    return this.exclusive(async (cwd) => {
      if (!isDraftName(name)) throw new Error("Unknown draft.");
      const ref = `${DRAFT_REF_PREFIX}${name}`;
      const [worktrees, subject] = await Promise.all([
        listWorktrees(cwd),
        // Fails for a draft that does not exist.
        git(cwd, ["log", "-1", "--format=%s", `${ref}^{commit}`]),
      ]);
      if (worktrees.some((tree) => tree.branch === ref)) {
        throw new Error(`The draft "${name}" is still being worked on.`);
      }
      return await this.take(cwd, {
        kind: "draft",
        ref,
        emptyMessage: "That change is already in this version.",
        // The change's own subject, so the chat's card and the recent list
        // still name what it does rather than saying "Merge".
        subject,
        trustIdenticalTree: false,
        brief: (plan, head, gateOutput) =>
          staleDraftBrief(plan, head, name, gateOutput),
        pendingDraft: name,
        pendingDraftExists: true,
        settle: async (to) => {
          await git(cwd, ["branch", "-D", `draft/${name}`]);
          // A draft Stella dispatched for itself isn't a change the user
          // asked for: it stays out of the chat and off their other computers.
          if (!isStellaDraft(name)) await this.rememberAgent(cwd, name, to);
        },
      });
    });
  }

  /** Carry a draft's agent over to the commit that applied it. */
  private async rememberAgent(cwd: string, name: string, sha: string) {
    const from = path.join(await this.commonDir(cwd), DRAFT_AGENTS_DIR, name);
    const agentId = await this.agentOf(cwd, DRAFT_AGENTS_DIR, name);
    if (!agentId) return;
    await this.writeChange(cwd, sha, agentId, false);
    await fs.rm(from, { force: true });
    // Best-effort: without the tag the change only goes unannounced elsewhere.
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

  /** Note a commit as applying (or undoing) an agent's change. */
  private async writeChange(cwd: string, sha: string, agentId: string, undone: boolean) {
    const dir = path.join(await this.commonDir(cwd), COMMIT_AGENTS_DIR);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, sha), `${agentId}\n${undone ? "undone\n" : ""}`);
  }

  /** The agent change a commit applied or undid, if it was one. */
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

  /** The agent noted in `dir` under `key`, if any. */
  private async agentOf(cwd: string, dir: string, key: string) {
    const file = path.join(await this.commonDir(cwd), dir, key);
    const agentId = (await fs.readFile(file, "utf8").catch(() => "")).trim();
    return agentId || undefined;
  }

  /** What a draft changes against `head`: file count, and whether it relaunches. */
  private async draftShape(cwd: string, head: string, sha: string) {
    const paths = (await git(cwd, ["diff", "--name-only", `${head}...${sha}`]))
      .split("\n")
      .filter(Boolean);
    return {
      files: paths.length,
      restart: relaunches(paths),
    };
  }

  undo(sha: string) {
    return this.exclusive(async (cwd) => {
      if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha)) {
        throw new Error("Unknown change.");
      }
      const head = await git(cwd, ["rev-parse", "HEAD"]);
      if (!(await isAncestor(cwd, sha, head))) {
        throw new Error("That change is not part of the current version.");
      }
      // The history row is the unit: everything that arrived with `sha`
      // (a draft's commits fast-forwarded together, a catch-up with the
      // fork) comes out together, since the earlier commits of one arrival
      // can need the later ones to build. Anything else is its one commit.
      const row = (await this.readRecent(cwd, await this.recentLog(cwd))).find(
        (entry) => entry.commit.sha === sha,
      );
      const base = row?.base ?? (await git(cwd, ["rev-parse", `${sha}^`]));
      const subject = await git(cwd, ["log", "-1", "--format=%s", sha]);
      // Three-way merge with the change as base and what it started from as
      // "theirs": HEAD minus the change, computed without touching the
      // working tree.
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
      // No text conflict is not the same as working: later work can still
      // import what the change added. An undo is checked like a merged
      // update, so it never lands a Stella that cannot start; one that fails
      // goes to an agent like a conflict does.
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
        // Undoing an agent's change (or an undo of it) stays that agent's.
        const change = await this.changeOf(cwd, sha);
        if (change) await this.writeChange(cwd, revert, change.agentId, !change.undone);
      });
    });
  }

  /**
   * Take the changes the owner made on another of their computers.
   *
   * Diverged used to be refused outright here, and the card then typed
   * "Merge the changes from my other computer." into the chat as though the
   * user had asked for it. Both sides are the user's own work and a clean
   * merge of them needs nobody: it applies, with the same check an update
   * gets.
   */
  applyRemote() {
    return this.exclusive(async (cwd) => {
      if (!this.forkBranch)
        throw new Error("No changes from your other computers.");
      const ref = `${FORK_REF_PREFIX}${this.forkBranch}`;
      const tip = await git(cwd, ["rev-parse", "--verify", `${ref}^{commit}`]);
      return await this.take(cwd, {
        kind: "remote",
        ref,
        emptyMessage: "No changes from your other computers.",
        subject: `Merge the changes from another computer ${tip.slice(0, 12)}`,
        trustIdenticalTree: false,
        brief: (plan, head, gateOutput) =>
          remoteMergeBrief(plan, head, ref, gateOutput),
        pendingDraft: mergeDraftName(tip),
        pendingDraftExists: false,
      });
    });
  }

  /** Take the published app's update. */
  applyUpstream() {
    return this.exclusive(async (cwd) => {
      if (!this.upstreamTracked) throw new Error("No update is available.");
      const tip = await git(cwd, [
        "rev-parse",
        "--verify",
        `${UPSTREAM_REF}^{commit}`,
      ]);
      // Another computer may already have merged this update into the
      // user's changes: take that merge rather than resolving the same
      // conflict again here, and differently.
      return await this.take(cwd, {
        kind: "upstream",
        ref: (await this.mergedElsewhere(cwd, tip)) ?? UPSTREAM_REF,
        emptyMessage: "No update is available.",
        subject: `Merge the published Stella update ${tip.slice(0, 12)}`,
        trustIdenticalTree: true,
        brief: upstreamMergeBrief,
        pendingDraft: mergeDraftName(tip),
        pendingDraftExists: false,
      });
    });
  }

  /**
   * Advance the checkout onto another version.
   *
   * A fast-forward applies. A diverged side that git merges without a
   * conflict also applies, by itself: the merge is computed into the object
   * database, checked on a scratch worktree, and only then fast-forwarded in.
   * Divergence on its own is not a reason to involve anybody — history whose
   * shape differs while its tree does not has no merge judgement in it to
   * make. Only a real textual conflict, or a merge that does not build, goes
   * to an agent.
   */
  private async take(
    cwd: string,
    source: TakeSource,
  ): Promise<void | { background: true }> {
    const head = await git(cwd, ["rev-parse", "HEAD"]);
    // Prepared before it was offered: the plan, the merge and its check are
    // already done, for exactly this HEAD and this tip.
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
    if (plan.kind === "none") throw new Error(source.emptyMessage);
    let to = plan.kind === "fast-forward" ? plan.tip : "";
    if (plan.kind === "conflict") {
      return await this.dispatchMerge(cwd, source, source.brief(plan, head));
    }
    if (plan.kind === "clean" && prepared?.to) {
      to = prepared.to;
      if (prepared.gate && !prepared.gate.ok) {
        return await this.dispatchMerge(
          cwd,
          source,
          source.brief(plan, head, prepared.gate.output),
        );
      }
    } else if (plan.kind === "clean") {
      // The merge exists as objects only: nothing is checked out and the
      // checkout's branch has not moved, so giving up here leaves no state.
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
      // Nothing of this checkout's own survived into the result that the
      // other side had not already published: there is nothing left to check.
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
    // No line in the chat for this: it applied while the user watched the
    // button, exactly like a fast-forward. The two lines belong to the work
    // that had to go on in the background.
    await this.swapIn(
      cwd,
      head,
      to,
      source.settle && (() => source.settle!(to)),
      prepared,
    );
  }

  /**
   * Hand a merge to a background agent and report the action as going on in
   * the background. No user turn is fabricated for it: the brief carries the
   * shas, the divergence and the conflicting files the app already knows, so
   * nothing has to be re-derived from a sentence the user never typed.
   */
  private async dispatchMerge(
    cwd: string,
    source: TakeSource,
    brief: AgentBrief,
  ): Promise<{ background: true }> {
    const dispatch = this.options.dispatchAgentBrief;
    if (!dispatch) {
      throw new Error("Stella isn't ready to make that change yet.");
    }
    const name = source.pendingDraft;
    // Already under way (an earlier press, or a relaunch that forgot it):
    // wait for that one instead of putting a second agent on the same work.
    if (!(await this.draftUnderWay(cwd, name, !source.pendingDraftExists))) {
      await dispatch(brief);
      this.options.log("app-source.brief-dispatched", {
        from: source.kind,
        draft: name,
      });
    }
    this.updateState = {
      state: "merging",
      name,
      since: Date.now(),
      from: source.kind,
    };
    return { background: true };
  }

  /**
   * Someone is already on this draft. A worktree holding it means an agent is
   * working now; for a draft the app names itself, the branch merely existing
   * means an agent already finished one.
   */
  private async draftUnderWay(
    cwd: string,
    name: string,
    branchCounts: boolean,
  ) {
    const ref = `${DRAFT_REF_PREFIX}${name}`;
    if ((await listWorktrees(cwd)).some((tree) => tree.branch === ref)) {
      return true;
    }
    if (!branchCounts) return false;
    return (
      (await gitRaw(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]))
        .code === 0
    );
  }

  /**
   * An undo that later work conflicts with, or that leaves Stella unable to
   * build.
   *
   * This is the one button whose result the app does not take by itself.
   * Pressing Undo is consent to remove a change; it is not consent to
   * whatever an agent decides the work built on top of it should become, and
   * that is a judgement with no single right answer. So the agent finishes an
   * ordinary draft, the chat shows it the way it shows any change, and the
   * user applies it having seen what it came to. There is no background line
   * either: the agent's own card is the thing to look at, and a line next to
   * it would be saying the same thing twice.
   */
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
      throw new Error("Stella isn't ready to undo that yet.");
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


  /**
   * The agent's merge is ready: stop saying Stella is updating and leave it in
   * Updates. Pressing Update started the merge, but taking it means a relaunch
   * minutes later, and that is the user's call, so it applies only when they
   * press Add on it. A merge that never arrives is forgotten after a while
   * rather than leaving the chat saying Stella is updating forever.
   */
  private settleFinishedMerge(state: Omit<AppSourceState, "busy">) {
    const pending = this.updateState;
    if (pending?.state !== "merging") return;
    if (
      Date.now() - pending.since > UPDATE_MERGE_WAIT_MS ||
      state.ready.some((draft) => draft.name === pending.name)
    ) {
      this.updateState = null;
    }
  }

  private exclusive(
    task: (cwd: string) => Promise<void | { background: true }>,
  ): Promise<AppSourceActionResult> {
    const requestedAt = performance.now();
    const result = this.queue.then(async (): Promise<AppSourceActionResult> => {
      this.timeline = { startedAt: requestedAt, last: requestedAt, steps: [] };
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
        return { ok: false, error: errorMessage(error) };
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

  /** Note how long the step that just ended took. */
  private mark(step: string) {
    const timeline = this.timeline;
    if (!timeline) return;
    const now = performance.now();
    timeline.steps.push(`${step} ${Math.round(now - timeline.last)}`);
    timeline.last = now;
  }

  /** One line per action: every step's milliseconds, and the total. */
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

  /**
   * Advance the checkout from `from` onto `to` and make the change take
   * effect. The window is pictured while the checkout moves and the launcher
   * signs it; `settle` (bookkeeping nothing on screen depends on) runs
   * alongside the swap and is done before the action ends or Stella
   * relaunches.
   */
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
    // Only changes the renderer can show get the transition: the runtime and
    // the desktop shell aren't in the window.
    const visible =
      !restart &&
      paths.some(
        (file) =>
          !file.startsWith("packages/runtime/") &&
          !file.startsWith("packages/desktop/"),
      );
    // Picture the window while the launcher signs the change (nothing on
    // screen moves meanwhile).
    const covering = visible ? this.options.coverRenderer?.() ?? null : null;
    try {
      await git(cwd, ["merge", "--ff-only", to]);
      this.mark("merge");
      await this.options.afterApply?.(cwd);
    } catch (error) {
      await (await covering)?.cancel();
      throw error;
    }
    this.mark("sign");
    const settling = settle?.() ?? Promise.resolve();
    // Failing here leaves the change applied but its swap undone; awaited
    // where it is reported instead.
    settling.catch(() => undefined);
    this.options.log("app-source.applied", { files: paths.length });
    if (restart) {
      // The window is frosted while the next process is made ready, not
      // after: its dependencies installed and main and preload built here, so
      // the relaunch only has to start. The runtime restarts with the app.
      const holding = this.options.beforeRelaunch?.() ?? Promise.resolve(null);
      try {
        if (install) {
          await this.install(cwd);
          this.mark("install");
        }
      } catch (error) {
        await (await holding)?.release();
        throw error;
      }
      // A main that does not build is left to the next launch, which fails
      // the same way and shows the launcher's recovery.
      const [, setUp] = await Promise.all([
        prebuildElectronBundles(
          cwd,
          `${this.options.updateScratchDir}-prebuild.mjs`,
          this.options.log,
          prepared?.bundles && prepared.to === to ? prepared.dir : undefined,
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
      this.logTimeline("relaunch");
      // The runtime outlives the relaunch when the update leaves it and its
      // packages as they are: turns keep running and the next window finds
      // it ready. Not across an install, which changes what it loads.
      this.options.relaunch({ keepRuntime: !install && !restartsRuntime(paths) });
      return;
    }
    if (restartsRuntime(paths)) {
      this.options.requestRuntimeRestart();
    }
    const covered = await covering;
    this.mark("cover");
    const swap = async () => {
      await this.options.applyRendererChanges(paths);
    };
    await (covered ? covered.reveal(swap) : swap());
    this.mark("reveal");
    await settling;
  }

  private async install(cwd: string) {
    const bun = process.env.STELLA_BUN_PATH?.trim() || "bun";
    const result = await run(bun, ["install"], {
      cwd,
      // The browser and office downloads are prepare-install.mjs's job when
      // the launcher prepares the relaunch (run ahead of it here); the
      // postinstall would only check them a second time.
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
    // Mid-action the checkout is in flux (a draft's branch is already gone
    // while its change is still swapping in); the action refreshes when it
    // ends, so the chat never sees a half-applied state.
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
          this.publish({ ...next, busy: this.busy });
          this.settleFinishedMerge(next);
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
    const ready: AppSourceDraft[] = [];
    const stale: AppSourceDraft[] = [];
    for (const line of refs.split("\n").filter(Boolean)) {
      const [refname = "", sha = "", subject = ""] = line.split("\0");
      const name = refname.slice(DRAFT_REF_PREFIX.length);
      if (!isDraftName(name) || inProgress.has(refname) || sha === head)
        continue;
      const list = (await isAncestor(cwd, head, sha))
        ? ready
        : (await isAncestor(cwd, sha, head))
          ? null
          : stale;
      if (!list) continue;
      const agentId = await this.agentOf(cwd, DRAFT_AGENTS_DIR, name);
      list.push({
        name,
        subject,
        sha,
        ...(agentId ? { agentId } : {}),
        ...(await this.draftShape(cwd, head, sha)),
      });
    }
    const recent = (await this.readRecent(cwd, log)).map((row) => row.commit);
    const forkRef = this.forkBranch ? `${FORK_REF_PREFIX}${this.forkBranch}` : null;
    const upstreamOffer = this.upstreamTracked
      ? await this.offerFrom(cwd, head, UPSTREAM_REF, null)
      : null;
    // What the other computer would bring beyond the published version: a
    // fork that only took the official update is that update, not a change
    // of the user's.
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
    // A version is offered once it is prepared, so pressing Update only has
    // to swap it in. One the user skipped is not prepared; it can still be
    // added, the slower way.
    const skippedNow = await this.skippedKeys(cwd);
    const jobs: PrepareJob[] = [];
    const identityEnv = () => this.identityEnv(cwd);
    const preparedFor = async (
      job: Omit<PrepareJob, "head" | "identityEnv">,
      keys: string[],
    ) => {
      if (keys.some((key) => skippedNow.has(key))) return true;
      jobs.push({ ...job, head, identityEnv });
      return await this.preparer.isReady(head, job.tip);
    };
    const shownDrafts = async (drafts: AppSourceDraft[]) => {
      const shown: AppSourceDraft[] = [];
      for (const draft of drafts) {
        const ready = await preparedFor(
          {
            tip: draft.sha,
            ref: `${DRAFT_REF_PREFIX}${draft.name}`,
            subject: draft.subject,
            trustIdenticalTree: false,
          },
          [`draft:${draft.sha}`, `version:${draft.sha}`],
        );
        if (ready) shown.push(draft);
      }
      return shown;
    };
    const readyShown = await shownDrafts(ready);
    const staleShown = await shownDrafts(stale);
    let upstreamShown = false;
    if (upstreamOffer?.real) {
      const ref = (await this.mergedElsewhere(cwd, upstreamOffer.tip)) ?? UPSTREAM_REF;
      upstreamShown = await preparedFor(
        {
          tip:
            ref === UPSTREAM_REF
              ? upstreamOffer.tip
              : await git(cwd, ["rev-parse", "--verify", `${ref}^{commit}`]),
          ref,
          subject: `${UPSTREAM_MERGE_SUBJECT} ${upstreamOffer.tip.slice(0, 12)}`,
          trustIdenticalTree: true,
        },
        [`version:${upstreamOffer.tip}`],
      );
    }
    const forkShown =
      forkRef && forkOffer?.real
        ? await preparedFor(
            {
              tip: forkOffer.tip,
              ref: forkRef,
              subject: `${REMOTE_MERGE_SUBJECT} ${forkOffer.tip.slice(0, 12)}`,
              trustIdenticalTree: false,
            },
            [`other:${forkOffer.tip}`],
          )
        : false;
    void this.preparer.want(jobs);
    const [remote, upstream] = await Promise.all([
      forkRef && forkShown ? this.compareRef(cwd, head, forkRef) : null,
      upstreamShown ? this.compareRef(cwd, head, UPSTREAM_REF) : null,
    ]);
    const merging =
      this.updateState?.state === "merging" ? this.updateState.from : null;
    const offered: AppSourceWaiting[] = [];
    const updateDraft = readyShown.find((draft) => isUpdateDraft(draft.name));
    if ((upstreamOffer?.real && upstreamShown) || updateDraft) {
      offered.push({
        kind: "version",
        key: `version:${upstreamOffer?.real && upstreamShown ? upstreamOffer.tip : updateDraft!.sha}`,
        adding: merging === "upstream",
        ...(updateDraft ? { draft: updateDraft.name } : {}),
      });
    }
    if (forkRef && forkOffer?.real && forkShown) {
      const [summary, device] = await Promise.all([
        this.forkSummary(cwd, head, forkOffer.tip),
        this.forkDevice(cwd),
      ]);
      offered.push({
        kind: "other-computer",
        key: `other:${forkOffer.tip}`,
        adding: merging === "remote",
        device,
        summary,
      });
    }
    for (const draft of [...readyShown, ...staleShown]) {
      if (isStellaDraft(draft.name)) continue;
      offered.push({
        kind: "draft",
        key: `draft:${draft.sha}`,
        adding:
          this.updateState?.state === "merging" &&
          this.updateState.from === "draft" &&
          this.updateState.name === draft.name,
        name: draft.name,
        summary: draft.subject || draft.name,
      });
    }
    // A change of the user's that an agent is bringing up to date is off
    // the ready list while it works; it stays in the list as being added.
    const pending = this.updateState?.state === "merging" ? this.updateState : null;
    if (
      pending?.from === "draft" &&
      !offered.some((offer) => offer.kind === "draft" && offer.name === pending.name)
    ) {
      const subject = (
        await gitRaw(cwd, ["log", "-1", "--format=%s", `${DRAFT_REF_PREFIX}${pending.name}`])
      ).stdout.trim();
      offered.push({
        kind: "draft",
        key: `adding:${pending.name}`,
        adding: true,
        name: pending.name,
        summary: subject || pending.name,
      });
    }
    this.offeredKeys = offered.map((offer) => offer.key);
    const skipped = skippedNow;
    return {
      ready: readyShown,
      stale: staleShown,
      remote: remote
        ? { status: remote.status, count: remote.count }
        : { status: "none", count: 0 },
      upstream: upstream ?? NO_UPSTREAM,
      recent,
      waiting: offered.filter((offer) => offer.adding || !skipped.has(offer.key)),
      skipped: offered.filter((offer) => !offer.adding && skipped.has(offer.key)),
      ...(this.updateState
        ? { update: { state: this.updateState.state } }
        : {}),
    };
  }

  /** First-parent history for `readRecent`, newest first. */
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

  /**
   * First-parent history in the user's terms, one row per thing that
   * arrived. The commits one move of HEAD brought (a draft's commits
   * fast-forwarded together, a catch-up with the owner's fork) are one row,
   * and Undo takes out the whole row. Commits that changed no files are
   * left out: catching up with another computer's history, or a merge of a
   * version this computer already had, is nothing to them.
   */
  private async readRecent(cwd: string, log: string): Promise<RecentRow[]> {
    // The ref as last fetched, even before this launch has synced: until
    // then a published version must not read as a change that can be undone.
    const published = new Set(
      (await gitRaw(cwd, ["rev-list", "-n", "5000", UPSTREAM_REF])).stdout.split("\n"),
    );
    const moves = await this.headMoves(cwd);
    const lines = log.split("\n").filter(Boolean).map((line) => line.split("\0"));
    const position = new Map(lines.map(([sha = ""], index) => [sha, index]));
    const rows: RecentRow[] = [];
    // When the checkout arrived at each commit: a version published days
    // ago but taken just now was applied just now. Commits between two
    // places HEAD stopped at arrived together, when the newer one did.
    let arrival: number | undefined;
    /** The move under way: the last line it brought, and its newest row. */
    let move: { last: number; row: RecentRow | null } | null = null;
    for (const [index, line] of lines.entries()) {
      const [sha = "", subject = "", seconds = "0", tree = "", parents = ""] = line;
      const [firstParent = "", ...others] = parents.split(" ").filter(Boolean);
      const moved = moves.get(sha);
      if (moved) {
        arrival = moved.at;
        // Only a move from an older first-parent commit brought a range.
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
      // Arrived with the row above, and the same kind of thing: one row.
      // Published versions taken one after another are one new version.
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

  /** The tree taking `tip` onto `onto` makes, or null when it conflicts. */
  private async mergedTree(cwd: string, onto: string, tip: string) {
    if (await isAncestor(cwd, tip, onto)) {
      return await git(cwd, ["rev-parse", `${onto}^{tree}`]);
    }
    if (await isAncestor(cwd, onto, tip)) {
      return await git(cwd, ["rev-parse", `${tip}^{tree}`]);
    }
    // The same merge `classifyUpdate` makes when it is taken, so what is
    // offered is exactly what Add applies.
    const base = await git(cwd, ["merge-base", onto, tip]);
    const merge = await gitRaw(cwd, [
      "merge-tree",
      "--write-tree",
      "--merge-base",
      base,
      onto,
      tip,
    ]);
    if (merge.code === 1) return null;
    if (merge.code !== 0) {
      throw new Error(merge.stderr.trim() || "Could not work out the merge.");
    }
    return merge.stdout.split("\n")[0]!.trim();
  }

  /**
   * What taking `ref` would really change here. Commits HEAD lacks are not
   * enough: two computers that each merged the same official update hold
   * different commits with the same files. Only a different resulting tree
   * is something to offer. With `published`, a ref whose every change is
   * already in the published version offers nothing of its own either.
   */
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
      // Nothing beyond the published app but merges: the other computer's
      // own way of taking an update this one takes too. Taking the update
      // here covers it, so it is never offered. Once it holds no version
      // this computer lacks, its history is joined, keeping these files.
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

  /**
   * Whether `tip` holds a commit HEAD lacks that is not a merge (nor in
   * `published`, when given): a change somebody made. A merge only settles
   * what its sides already held, so two computers that each merged the same
   * update into the same changes differ by nothing but how each resolved
   * it, and that resolution is each computer's own.
   */
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

  /**
   * The fork, when another computer has already merged the published `tip`
   * into exactly what this computer has: a fast-forward from HEAD that holds
   * `tip` and no change beyond it.
   */
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

  /** Everything `tip` would bring here is in the published version. */
  private async coveredBy(cwd: string, head: string, published: string, tip: string) {
    const withPublished = await this.mergedTree(cwd, head, published);
    if (withPublished === null) return false;
    // The published version taken here, as objects only, so the other side
    // can be merged onto it.
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

  /** The newest change the other computer has that is not the published app. */
  private async forkSummary(cwd: string, head: string, tip: string) {
    const out = await git(cwd, [
      "log",
      "--no-merges",
      "-n1",
      "--format=%s",
      tip,
      `^${head}`,
      ...(this.upstreamTracked ? [`^${UPSTREAM_REF}`] : []),
    ]);
    return out.trim();
  }

  /**
   * The computer the newest change came from, as its change tag names it.
   * Empty when the other computer's changes weren't made by an agent there.
   */
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

  /**
   * Join another side's history when it brings no files this computer lacks,
   * or only its own merges of what this computer already has, so it never
   * shows as something to add. The checkout ends on its own tree: nothing on
   * screen changes and nothing restarts. Once per head and tip, so a refused
   * attempt is not retried on every poll.
   */
  private catchUpLater(ref: string, tip: string, head: string) {
    if (this.catchingUp || this.busy || this.disposed) return;
    if (this.updateState?.state === "merging") return;
    const attempt = `${head}:${tip}`;
    if (this.caughtUp.has(attempt)) return;
    if (this.caughtUp.size > 64) this.caughtUp.clear();
    this.caughtUp.add(attempt);
    this.catchingUp = true;
    void this.exclusive(async (cwd) => {
      // Deferred, not refused: the next poll tries again.
      if (!(await this.catchUp(cwd, ref, tip))) this.caughtUp.delete(attempt);
    }).finally(() => {
      this.catchingUp = false;
    });
  }

  /** False when it has to wait: a draft is in progress. */
  private async catchUp(cwd: string, ref: string, tip: string) {
    // A draft in progress: its base must not move under the agent.
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
      // Another computer's merge of what this one has keeps these files;
      // anything else that would change them is the user's to add.
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
    await git(cwd, ["merge", "--ff-only", to]);
    await this.options.afterApply?.(cwd);
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

  /**
   * Set one offer aside until something newer arrives; it can still be added. Only what is offered now is
   * kept, so the list never outgrows the offers themselves.
   */
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

  /** A remote-tracking ref that has commits HEAD lacks, or null. */
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

  /**
   * Follow the backend's release channel, and the owner's fork view while
   * signed in. Cheap and idempotent: the poll calls it to notice sign-in and
   * backend changes.
   */
  private followBackend() {
    if (this.disposed) return;
    const baseUrl = this.options.getBackendUrl();
    this.releases.follow(baseUrl);
    const watchFork = baseUrl && this.options.hasConnectedAccount() ? baseUrl : null;
    if (this.forkWatch?.baseUrl === watchFork) return;
    this.forkWatch?.stop();
    this.forkWatch = null;
    if (!watchFork) return;
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

  /** The release channel's version: on connect, and on every publish. */
  private onPublished(version: string | null) {
    this.published = version;
    if (!version || version === this.syncedFor) return;
    // A dev checkout doesn't follow upstream.
    if (this.forkUnrelated || this.upstreamUnrelated) return;
    void gitRaw(this.options.stellaAppDir, ["rev-parse", "--verify", "--quiet", UPSTREAM_REF])
      .then((result) => {
        if (result.code === 0 && result.stdout.trim() === version) {
          this.syncedFor = version;
          return;
        }
        this.options.log("app-source.published", { version });
        this.wantSync();
      })
      .catch(() => this.wantSync());
  }

  /** Another computer pushed to the fork (its main or change tags). */
  private onForkPush(pushedAt: number | null) {
    if (pushedAt === null || pushedAt === this.forkPushSeen) return;
    this.forkPushSeen = pushedAt;
    if (this.ownForkPushes.has(pushedAt) || this.forkUnrelated) return;
    this.options.log("app-source.fork-pushed", { pushedAt });
    this.wantSync();
  }

  /** Ask for a sync: now, or when the launch delay or a backoff ends. */
  private wantSync() {
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

  /**
   * Fetch the fork and upstream; push to the fork when this computer is
   * ahead. Runs when asked (`wantSync`), never on a timer of its own.
   */
  async syncFork() {
    if (this.disposed || this.busy || this.syncing) return;
    this.syncing = true;
    const cwd = this.options.stellaAppDir;
    const target = this.published;
    let outcome: "done" | "deferred" | "failed" = "failed";
    try {
      // A draft in progress: its base must not move under the agent. The
      // poll tries again once it is gone.
      const worktrees = await listWorktrees(cwd);
      if (worktrees.some((tree) => tree.branch?.startsWith(DRAFT_REF_PREFIX))) {
        outcome = "deferred";
        return;
      }
      this.syncWanted = false;
      const access = await this.sourceAccess();
      if (!access) {
        outcome = "done";
        return;
      }
      if (access.fork && !this.forkUnrelated) {
        await this.syncWithFork(cwd, access.fork).catch((error) => {
          this.options.log("app-source.fork-sync-failed", {
            message: errorMessage(error),
          });
        });
      }
      // A checkout unrelated to the fork is unrelated to upstream too.
      if (!this.forkUnrelated && !this.upstreamUnrelated) {
        await this.fetchUpstream(cwd, access.upstream);
      }
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
        // Retried with backoff until it works; the channel's next connect
        // or announcement asks again anyway.
        this.syncWanted = true;
        this.syncNotBefore =
          Date.now() + Math.min(SYNC_RETRY_MAX_MS, SYNC_RETRY_MS * 2 ** this.syncFailures);
        this.syncFailures += 1;
      }
      void this.refresh();
      // Asked again while this one ran: a newer version, or another push.
      if (outcome !== "deferred" && this.syncWanted) this.wantSync();
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
        `+refs/heads/${fork.branch}:${ref}`,
        `+${CHANGE_TAG_PREFIX}*:${FORK_CHANGES_PREFIX}*`,
      ],
      { env: fetchEnv(fork.token), timeoutMs: 5 * 60_000 },
    );
    // The dev repo's history is unrelated to the published fork; only
    // checkouts cloned from the fork sync with it.
    if ((await gitRaw(cwd, ["merge-base", "HEAD", ref])).code !== 0) {
      this.forkUnrelated = true;
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
        `+refs/heads/main:${UPSTREAM_REF}`,
      ],
      { env: fetchEnv(upstream.token), timeoutMs: 5 * 60_000 },
    );
    if ((await gitRaw(cwd, ["merge-base", "HEAD", UPSTREAM_REF])).code !== 0) {
      this.upstreamUnrelated = true;
      this.upstreamTracked = false;
      this.options.log("app-source.upstream-unrelated", {});
      return;
    }
    this.upstreamTracked = true;
  }

  /** Best-effort, never awaited by an action. */
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
    // Only fast-forwards: a diverged fork is merged by an agent, never forced.
    if (forkTip !== head && (await isAncestor(cwd, forkTip, head))) {
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

  /** Tell the owner's other computers to fetch. Best-effort. */
  private reportForkPush(tip: string) {
    const baseUrl = this.options.getBackendUrl();
    if (!baseUrl || !this.options.hasConnectedAccount()) return;
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
      });
  }

  /**
   * Push this computer's change tags whose change the fork's main now has;
   * true when it pushed any.
   */
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
    // A tag moves when the same agent's next change is applied.
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

  /**
   * A signed-in owner gets their fork (write) and upstream (read) from
   * `appSource.access`; anyone else reads upstream through the public
   * bootstrap endpoint.
   */
  private async sourceAccess(): Promise<SourceAccess | null> {
    const baseUrl = this.options.getBackendUrl();
    if (!baseUrl) return null;
    const signedIn = this.options.hasConnectedAccount();
    const cached = this.access;
    if (
      cached &&
      (cached.fork !== null) === signedIn &&
      Math.min(cached.upstream.expiresAt, cached.fork?.expiresAt ?? Infinity) -
        60_000 >
        Date.now()
    ) {
      return cached;
    }
    this.access = signedIn
      ? await this.accountAccess(baseUrl)
      : { fork: null, upstream: await this.bootstrapAccess(baseUrl) };
    return this.access;
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
      // Its socket carried the old backend's fork view.
      this.forkWatch = null;
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

  private async accountAccess(baseUrl: string): Promise<SourceAccess> {
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
        // The fork is created on first use; the backend asks to retry.
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
