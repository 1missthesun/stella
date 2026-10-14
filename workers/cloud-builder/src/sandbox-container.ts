import { admitContainerStart, settleContainer, touchContainer } from "./container-cap.js";
import {
  DirectoryBackup,
  Files,
  SandboxBackupError,
  SandboxFileError,
} from "@cloudflare/sandbox";
import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { appBuildEgress, generalAgentEgress } from "./sandbox-egress-policy.js";
import {
  DEPENDENCY_BACKUP_DIR,
  DEPENDENCY_BACKUP_EXCLUDES,
  DEPENDENCY_BACKUP_MAX_BYTES,
  DEPENDENCY_FOREIGN_LIMIT,
  DEPENDENCY_PLACE_TOOL_HOME_SCRIPT,
  DEPENDENCY_PROBE_SCRIPT,
  DEPENDENCY_RESTORE_ROOT,
  DEPENDENCY_TRANSFER_TIMEOUT_MS,
  dependencyBackupPrefix,
  dependencyExcludeForPath,
  parseDependencyProbe,
  type StoredDependencyBackup,
} from "./sandbox-dependencies.js";
import {
  SANDBOX_CODE_HOST,
  SANDBOX_CODE_INSTALL,
  parseSandboxCodeInstall,
  sandboxCode,
  sandboxCodeAssetPath,
  sandboxCodeUrl,
  type SandboxCodeInstall,
} from "./sandbox-code.js";
import type { Env } from "./build-session/shared/env.js";
import type { ContainerSnapshot } from "./world-store.js";
import { diskClass, INSTANCE_TIERS, type InstanceSize } from "./instance-size.js";
import {
  CPU_READ_COMMAND,
  METER_SETTLE_EVERY_MS,
  METER_TICK_MS,
  containerBudgetError,
  containerHold,
  meterInterval,
  meterReservationId,
  parseCpuUsec,
  refusalMessage,
  type ContainerMeter,
} from "./container-meter.js";
import { ownerGateStub } from "./rpc-release.js";
import type { CostOutcome } from "@stella/contracts/billing-tariffs";

export type SandboxInstanceSize = InstanceSize;

export type SandboxEgressPolicy = {
  kind: "slack";
  team: string;
  repo?: string;
  internet: boolean;
};
export type SandboxWorkloadKind = "world" | "app-build";

export type SandboxBoot = {
  size: SandboxInstanceSize;
  workload: SandboxWorkloadKind;
  idleTimeoutMs?: number;
  world?: string;
  // The owner whose budget pays for the container's running time.
  owner?: string;
};

export type SandboxExecRequest = {
  command: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
};

export type SandboxExecResult = {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type SandboxProcessStatus =
  | "starting"
  | "running"
  | "completed"
  | "failed"
  | "killed"
  | "error";

export type SandboxProcessInfo = {
  id: string;
  status: SandboxProcessStatus;
  exitCode?: number;
};

export type SandboxSessionConfig = {
  id: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  commandTimeoutMs?: number;
};

export type SandboxReleaseOptions = {
  warm?: boolean;
  warmMs?: number;
  snapshot?: boolean;
};

export type SandboxState = {
  status: "running" | "stopped";
  size?: SandboxInstanceSize;
};


const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60_000;
const MAX_IDLE_TIMEOUT_MS = 6 * 60 * 60_000;
const READY_DEADLINE_MS = 120_000;
const SESSION_PREFIX = "session:";
const PROCESS_ROOT = "/run/stella-processes";
const WORLD_KEY = "world";
const OWNER_KEY = "billTo";
const METER_KEY = "meter";
const METER_CLOSING_KEY = "meterClosing";
const METER_DUE_KEY = "meterDueAt";
const LAST_ACTIVE_KEY = "lastActiveAt";
const BUDGET_STOP_KEY = "budgetStop";
const LAST_ACTIVE_WRITE_EVERY_MS = 15_000;
const RELEASE_DUE_KEY = "releaseDueAt";
const STOP_PENDING_KEY = "stopPending";
const DEPENDENCY_BASELINE_KEY = "dependencyBaseline";
const STOP_DUE_KEY = "stopDueAt";
const RELEASE_DELAY_MS = 2_000;
const WARM_WINDOW_MS = 45_000;
const DEFAULT_CWD = "/workspace";
const EGRESS_KEY = "egress";
const BOOTED_EGRESS_KEY = "bootedEgress";
const CONTAINERS_CA = "/etc/cloudflare/certs/cloudflare-containers-ca.crt";
const TRUST_CONTAINERS_CA = `for i in $(seq 1 50); do [ -s ${CONTAINERS_CA} ] && break; sleep 0.1; done
[ -s ${CONTAINERS_CA} ] || { echo "The container has no interception CA." >&2; exit 1; }
cp ${CONTAINERS_CA} /usr/local/share/ca-certificates/stella-egress.crt
update-ca-certificates >/dev/null 2>&1`;

/**
 * Commands no longer inherit an environment from a long-lived session shell,
 * and `exec()` inherits only PATH from `start()`. Every command gets this base.
 */
const BASE_ENV: Readonly<Record<string, string>> = Object.freeze({
  PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  HOME: "/root",
  LANG: "C.UTF-8",
  DEBIAN_FRONTEND: "noninteractive",
});

const SIGNALS: Record<string, string> = {
  SIGKILL: "KILL",
  SIGTERM: "TERM",
  SIGINT: "INT",
  SIGHUP: "HUP",
};

const resolvedIdleTimeoutMs = (boot: SandboxBoot): number =>
  Math.min(
    MAX_IDLE_TIMEOUT_MS,
    boot.idleTimeoutMs && boot.idleTimeoutMs > 0
      ? boot.idleTimeoutMs
      : DEFAULT_IDLE_TIMEOUT_MS,
  );

const RUN_SCRIPT = `dir=$1; shift
setsid -w bash -c 'echo "$$" >"$0/pid"; exec "$@"' "$dir" "$@" >"$dir/stdout.log" 2>"$dir/stderr.log"
echo "$?" >"$dir/exit-code.tmp" && mv "$dir/exit-code.tmp" "$dir/exit-code"`;

const STATUS_SCRIPT = `dir=$1
[ -d "$dir" ] || { echo missing; exit 0; }
if [ -e "$dir/exit-code" ]; then echo "exited $(cat "$dir/exit-code")"
elif [ -e "$dir/killed" ] && [ -e "$dir/pid" ] && ! kill -0 "$(cat "$dir/pid")" 2>/dev/null; then echo killed
elif [ ! -e "$dir/pid" ]; then echo starting
elif kill -0 "$(cat "$dir/pid")" 2>/dev/null; then echo "running $(cat "$dir/pid")"
elif [ -e "$dir/exit-code" ]; then echo "exited $(cat "$dir/exit-code")"
else echo lost
fi`;

const WAIT_FOR_EXIT_SCRIPT = `dir=$1
while [ ! -e "$dir/exit-code" ]; do
  if [ -e "$dir/pid" ] && ! kill -0 "$(cat "$dir/pid")" 2>/dev/null && [ ! -e "$dir/exit-code" ]; then echo lost; exit 0; fi
  sleep 0.1
done
cat "$dir/exit-code"`;

const KILL_SCRIPT = `dir=$1; signal=$2
[ -e "$dir/pid" ] || exit 3
pid=$(cat "$dir/pid")
kill -0 "$pid" 2>/dev/null || exit 3
: >"$dir/killed"
kill -s "$signal" -- "-$pid" 2>/dev/null || kill -s "$signal" "$pid"`;

const decoder = new TextDecoder();

const cleanEnv = (
  ...layers: Array<Record<string, string | undefined> | undefined>
): Record<string, string> => {
  const merged: Record<string, string> = {};
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer ?? {})) {
      if (value === undefined) delete merged[key];
      else merged[key] = value;
    }
  }
  return merged;
};

const timeoutArgv = (timeoutMs: number | undefined): string[] =>
  typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0
    ? ["timeout", "-k", "5", `${Math.max(1, Math.ceil(timeoutMs / 1_000))}s`]
    : [];

const processDirectory = (id: string): string => {
  if (!/^[A-Za-z0-9._-]{1,128}$/u.test(id)) {
    throw new TypeError(`Invalid sandbox process id: ${id}`);
  }
  return `${PROCESS_ROOT}/${id}`;
};

const statusFromLine = (
  id: string,
  line: string,
): SandboxProcessInfo | null => {
  const [state, value] = line.trim().split(" ");
  switch (state) {
    case "missing":
      return null;
    case "starting":
      return { id, status: "starting" };
    case "running":
      return { id, status: "running" };
    case "killed":
      return { id, status: "killed", exitCode: 137 };
    case "exited": {
      const exitCode = Number(value);
      if (!Number.isSafeInteger(exitCode)) return { id, status: "error" };
      return {
        id,
        status:
          exitCode === 0 ? "completed" : exitCode > 128 ? "killed" : "failed",
        exitCode,
      };
    }
    default:
      return { id, status: "error" };
  }
};

const base64ToBytes = (value: string): Uint8Array =>
  Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
};

type EgressProps = {
  containerId: string;
  policy: "general" | "sealed" | "slack";
  team?: string;
  repo?: string;
};

export class SandboxEgress extends WorkerEntrypoint<Env, EgressProps> {
  async fetch(request: Request): Promise<Response> {
    const { containerId, policy, team, repo } = this.ctx.props;
    if (policy === "slack" && team) {
      const { slackEgress } = await import("./slack/environment.js");
      return await slackEgress(request, this.env as unknown as Cloudflare.Env, {
        containerId,
        team,
        repo: repo ?? "",
        loopback: (forwarded) => this.ctx.exports.default.fetch(forwarded),
        general: (forwarded) => generalAgentEgress(forwarded, this.env, { containerId }),
      });
    }
    return policy === "sealed"
      ? await appBuildEgress(request)
      : await generalAgentEgress(request, this.env, { containerId });
  }
}

export class SandboxCode extends WorkerEntrypoint<Env, { sha256: string }> {
  async fetch(request: Request): Promise<Response> {
    const { sha256 } = this.ctx.props;
    const { pathname } = new URL(request.url);
    if (
      (request.method !== "GET" && request.method !== "HEAD") ||
      pathname !== `/${sha256}.tar.gz`
    ) {
      return new Response("Not found.\n", { status: 404 });
    }
    // A Sandbox object still running an earlier version asks for that
    // version's bundle, but this entrypoint always runs the current one.
    if (sha256 !== sandboxCode().sha256) {
      return new Response(
        `This deployment serves code bundle ${sandboxCode().sha256}, not ${sha256}.\n`,
        { status: 410 },
      );
    }
    const asset = await this.env.ASSETS.fetch(
      new URL(sandboxCodeAssetPath(sha256), "https://assets.invalid"),
      { method: request.method },
    );
    if (!asset.ok || (request.method === "GET" && !asset.body)) {
      return new Response(
        `This deployment has no code bundle ${sha256} (${asset.status}).\n`,
        { status: 502 },
      );
    }
    return new Response(request.method === "HEAD" ? null : asset.body, {
      headers: { "content-type": "application/octet-stream" },
    });
  }
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

type DependencyBaseline = Pick<StoredDependencyBackup, "mark" | "fingerprint">;

export class Sandbox extends DurableObject<Env> {
  #booting: Promise<void> | null = null;
  #stopping: Promise<void> | null = null;
  #files?: Files;
  #dependencies?: { world: string; backups: DirectoryBackup };
  #inflight = 0;
  #lastActiveAt: number;
  #lastActiveWritten = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const lastActive = ctx.storage.kv.get<number>(LAST_ACTIVE_KEY);
    this.#lastActiveAt = lastActive === undefined ? Date.now() : lastActive + LAST_ACTIVE_WRITE_EVERY_MS;
    if (ctx.container?.running) {
      const boot = ctx.storage.kv.get<SandboxBoot>("boot");
      if (boot) {
        this.#booting = this.#configure(boot).catch(() => {
          this.#booting = null;
        });
      }
    }
  }

  get #container(): Container {
    const container = this.ctx.container;
    if (!container) throw new Error("The sandbox container is not configured.");
    return container;
  }

  get #fs(): Files {
    this.#files ??= new Files(this.#container);
    return this.#files;
  }

  #dependencyBackups(world: string): DirectoryBackup {
    if (this.#dependencies?.world !== world) {
      this.#dependencies = {
        world,
        backups: new DirectoryBackup(
          this.#container,
          this.ctx.exports.DirectoryBackupGateway,
          { binding: "BACKUP_BUCKET", prefix: dependencyBackupPrefix(world) },
        ),
      };
    }
    return this.#dependencies.backups;
  }

  #world(boot: SandboxBoot | undefined) {
    return boot?.world ? this.env.WORLDS.getByName(boot.world) : undefined;
  }

  #egress(boot: SandboxBoot): SandboxEgressPolicy | null {
    if (boot.workload !== "world") return null;
    return this.ctx.storage.kv.get<SandboxEgressPolicy>(EGRESS_KEY) ?? null;
  }

  async setEgress(policy: SandboxEgressPolicy | null): Promise<{ restarted: boolean }> {
    return await this.#active(async () => {
      const kv = this.ctx.storage.kv;
      if (policy) kv.put(EGRESS_KEY, policy);
      else kv.delete(EGRESS_KEY);
      if (this.#booting) await this.#booting.catch(() => undefined);
      if (!this.ctx.container?.running) return { restarted: false };
      const booted = kv.get<SandboxEgressPolicy>(BOOTED_EGRESS_KEY) ?? null;
      const same =
        booted === null
          ? policy === null
          : policy !== null &&
            booted.team === policy.team &&
            (booted.repo ?? "") === (policy.repo ?? "") &&
            booted.internet === policy.internet;
      if (same) return { restarted: false };
      await this.destroy({ keepSnapshot: true });
      return { restarted: true };
    });
  }

  async #configure(boot: SandboxBoot): Promise<void> {
    const container = this.#container;
    const policy = boot.workload === "app-build" ? "sealed" : "general";
    // The archive's and the code bundle's hosts must be registered before the
    // catch-all, which takes every hostname registered after it.
    if (boot.world) await this.#dependencyBackups(boot.world).intercept();
    if (boot.workload === "world") {
      await container.interceptOutboundHttp(
        SANDBOX_CODE_HOST,
        this.ctx.exports.SandboxCode({
          props: { sha256: sandboxCode().sha256 },
        }),
      );
    }
    const egress =
      boot.workload === "world"
        ? (this.ctx.storage.kv.get<SandboxEgressPolicy>(BOOTED_EGRESS_KEY) ?? null)
        : null;
    const handler = this.ctx.exports.SandboxEgress({
      props: egress
        ? { containerId: this.ctx.id.toString(), policy: "slack", team: egress.team, repo: egress.repo ?? "" }
        : { containerId: this.ctx.id.toString(), policy },
    });
    if (egress) await container.interceptOutboundHttps("*", handler);
    await container.interceptAllOutboundHttp(handler);
    await container.setInactivityTimeout(resolvedIdleTimeoutMs(boot));
  }

  async #extendIdleTimeout(boot: SandboxBoot): Promise<void> {
    const stored = this.ctx.storage.kv.get<SandboxBoot>("boot");
    const next = resolvedIdleTimeoutMs(boot);
    const current = stored
      ? resolvedIdleTimeoutMs(stored)
      : DEFAULT_IDLE_TIMEOUT_MS;
    if (current >= next) return;
    this.ctx.storage.kv.put("boot", {
      ...(stored ?? boot),
      idleTimeoutMs: next,
    });
    await this.#container.setInactivityTimeout(next);
  }

  get #snapshotsEnabled(): boolean {
    return this.env.SANDBOX_SNAPSHOTS === "1";
  }

  /**
   * Start from the latest snapshot any of the owner's agent containers of
   * this disk class took (`diskClass`), when it was taken on the image this deploy runs, so a world projection,
   * caches and installed dependencies are already on disk; the world catches
   * up by sync. A snapshot cannot cross images; any other case starts clean,
   * with the owner's caches and dependencies brought back from their archive.
   * The image holds no Stella code, so a deploy of Stella source keeps the
   * image and its snapshots; every agent container installs the code bundle
   * its Worker version names as it starts, from either source.
   */
  async #start(boot: SandboxBoot): Promise<void> {
    const container = this.#container;
    const image = container.images.sandbox!;
    const world = this.#world(boot);
    const stored =
      this.#snapshotsEnabled && world
        ? await world.containerSnapshot(diskClass(boot.size)).catch(() => null)
        : null;
    const snapshot = stored?.image === image ? stored : undefined;
    const startedAt = Date.now();
    let restored = false;
    if (snapshot) {
      try {
        await this.#boot(boot, { containerSnapshot: { id: snapshot.id } });
        restored = true;
      } catch (error) {
        await world
          ?.forgetContainerSnapshot({ id: snapshot.id })
          .catch(() => undefined);
        console.log(
          JSON.stringify({
            level: "error",
            event: "sandbox_snapshot_restore_failed",
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }
    if (!restored) await this.#boot(boot, { image });
    this.ctx.storage.kv.delete(DEPENDENCY_BASELINE_KEY);
    const installing = this.#installCode(boot).then(
      (code) => ({ code }),
      (error: unknown) => ({ error }),
    );
    if (restored) {
      await this.#run(["rm", "-rf", "--", PROCESS_ROOT]);
      const latest = await world
        ?.dependencyBackup(diskClass(boot.size))
        .catch(() => null);
      if (latest) {
        this.ctx.storage.kv.put(DEPENDENCY_BASELINE_KEY, {
          mark: latest.mark,
          fingerprint: latest.fingerprint,
        } satisfies DependencyBaseline);
      }
    } else if (boot.workload === "world" && boot.world) {
      await this.#restoreDependencies(boot.world, boot.size);
    }
    const installed = await installing;
    if ("error" in installed) {
      await this.#container.destroy().catch(() => undefined);
      if (boot.workload === "world" && (await this.#codeSuperseded())) {
        // This object runs an earlier version than the one now deployed,
        // which no longer serves its bundle. Resetting it makes the next call
        // (the turn's own, after its prewarm) run the current version.
        console.log(
          JSON.stringify({
            level: "warn",
            event: "sandbox_code_superseded",
            sandbox: this.ctx.id.toString().slice(0, 12),
            codeBundle: sandboxCode().sha256,
          }),
        );
        this.ctx.abort("This sandbox's code was superseded by a deploy.");
      }
      throw installed.error;
    }
    const { code } = installed;
    if (this.ctx.storage.kv.get<SandboxEgressPolicy>(BOOTED_EGRESS_KEY)) {
      const trusted = await this.#run(["bash", "-c", TRUST_CONTAINERS_CA]);
      if (!trusted.success) {
        await this.#container.destroy().catch(() => undefined);
        throw new Error(
          `The sandbox could not trust its egress certificate: ${trusted.stderr.trim().slice(-300)}`,
        );
      }
    }
    console.log(
      JSON.stringify({
        level: "info",
        event: "sandbox_container_started",
        workload: boot.workload,
        instanceSize: boot.size,
        sandbox: this.ctx.id.toString().slice(0, 12),
        ...(this.ctx.id.name ? { name: this.ctx.id.name.slice(0, 16) } : {}),
        source: restored ? "snapshot" : "image",
        ...(restored
          ? {
              snapshotFrom:
                snapshot!.sandbox === this.ctx.id.toString() ? "self" : "owner",
            }
          : {}),
        ...(stored && !snapshot ? { snapshotSkipped: "image_changed" } : {}),
        ...(code
          ? {
              codeBundle: code.sha256,
              codeSource: code.source,
              codeFetchMs: code.fetchMs,
              codeInstallMs: code.installMs,
            }
          : {}),
        readyMs: Date.now() - startedAt,
      }),
    );
  }

  async #codeSuperseded(): Promise<boolean> {
    const { sha256 } = sandboxCode();
    try {
      const response = await this.ctx.exports
        .SandboxCode({ props: { sha256 } })
        .fetch(new Request(sandboxCodeUrl(sha256), { method: "HEAD" }));
      return response.status === 410;
    } catch {
      return false;
    }
  }

  async #installCode(boot: SandboxBoot): Promise<SandboxCodeInstall | null> {
    if (boot.workload !== "world") return null;
    const { sha256 } = sandboxCode();
    const startedAt = Date.now();
    const result = await this.#run([
      "timeout",
      "-k",
      "5",
      "180s",
      SANDBOX_CODE_INSTALL,
      sha256,
      sandboxCodeUrl(sha256),
    ]);
    const installed = result.success
      ? parseSandboxCodeInstall(result.stdout, sha256)
      : null;
    if (installed) return installed;
    const message =
      result.stderr.trim().slice(-500) ||
      `stella-code-install exited ${result.exitCode}`;
    console.log(
      JSON.stringify({
        level: "error",
        event: "sandbox_code_install_failed",
        sandbox: this.ctx.id.toString().slice(0, 12),
        codeBundle: sha256,
        exitCode: result.exitCode,
        installMs: Date.now() - startedAt,
        message,
      }),
    );
    throw new Error(
      `The sandbox could not install Stella's code bundle ${sha256}: ${message}`,
    );
  }

  async #boot(
    boot: SandboxBoot,
    from: { image: string } | { containerSnapshot: { id: string } },
  ): Promise<void> {
    const container = this.#container;
    const startedAt = Date.now();
    const egress = this.#egress(boot);
    container.start({
      ...from,
      instance: INSTANCE_TIERS[boot.size].instance,
      enableInternet: boot.workload !== "app-build" && (egress?.internet ?? true),
      labels: {
        service: "stella-v2",
        workload: boot.workload,
        size: boot.size,
        ...(this.ctx.id.name ? { sandbox: this.ctx.id.name.slice(0, 16) } : {}),
      },
    } as ContainerStartupOptions);
    this.ctx.storage.kv.put("boot", boot);
    if (egress) this.ctx.storage.kv.put(BOOTED_EGRESS_KEY, egress);
    else this.ctx.storage.kv.delete(BOOTED_EGRESS_KEY);
    try {
      await this.#configure(boot);
      // `start()` returns before the container accepts commands.
      let delayMs = 25;
      while (true) {
        try {
          const probe = await container.exec(["true"]);
          if ((await probe.exitCode) === 0) break;
        } catch (error) {
          if (Date.now() - startedAt > READY_DEADLINE_MS) throw error;
        }
        if (Date.now() - startedAt > READY_DEADLINE_MS) {
          throw new Error("The sandbox container did not become ready.");
        }
        await scheduler.wait(delayMs);
        delayMs = Math.min(500, delayMs * 2);
      }
    } catch (error) {
      await container.destroy().catch(() => undefined);
      throw error;
    }
  }

  async #ensure(boot: SandboxBoot): Promise<void> {
    if (this.ctx.storage.kv.get<boolean>(STOP_PENDING_KEY)) {
      this.ctx.storage.kv.delete(STOP_PENDING_KEY);
      this.ctx.storage.kv.delete(STOP_DUE_KEY);
    }
    if (this.#stopping) await this.#stopping;
    if (this.#booting) {
      await this.#booting;
      if (this.#container.running) {
        await this.#extendIdleTimeout(boot);
        return;
      }
    }
    if (this.#container.running) {
      await touchContainer(this.env, this.ctx.id.toString()).catch(() => undefined);
      await this.#extendIdleTimeout(boot);
      return;
    }
    const sandbox = this.ctx.id.toString();
    const world = this.#withWorld(boot);
    this.#booting = (async () => {
      await this.#openMeter(world);
      try {
        await admitContainerStart(this.env, sandbox);
        await this.#start(world);
      } catch (error) {
        await settleContainer(this.env, sandbox).catch(() => undefined);
        await this.#closeMeter(Date.now(), undefined, "failed");
        throw error;
      }
      await this.#meterBaseline().catch(() => undefined);
    })().finally(() => {
      this.#booting = null;
    });
    await this.#booting;
  }

  #withWorld(input: SandboxBoot): SandboxBoot {
    const kv = this.ctx.storage.kv;
    let boot = input;
    if (boot.owner) {
      if (kv.get<string>(OWNER_KEY) !== boot.owner) kv.put(OWNER_KEY, boot.owner);
    } else {
      const owner = kv.get<string>(OWNER_KEY);
      if (owner) boot = { ...boot, owner };
    }
    if (boot.world) {
      if (this.ctx.storage.kv.get<string>(WORLD_KEY) !== boot.world) {
        this.ctx.storage.kv.put(WORLD_KEY, boot.world);
      }
      return boot;
    }
    const world = this.ctx.storage.kv.get<string>(WORLD_KEY);
    return world ? { ...boot, world } : boot;
  }

  async #run(
    argv: string[],
    options: { cwd?: string; env?: Record<string, string> } = {},
  ): Promise<SandboxExecResult> {
    const process = await this.#container.exec(argv, {
      cwd: options.cwd ?? "/",
      env: cleanEnv(BASE_ENV, options.env),
    });
    const output = await process.output();
    return {
      success: output.exitCode === 0,
      exitCode: output.exitCode,
      stdout: decoder.decode(output.stdout),
      stderr: decoder.decode(output.stderr),
    };
  }

  async state(): Promise<SandboxState> {
    return await this.#active(async () => {
      if (!this.ctx.container?.running) return { status: "stopped" };
      const boot = this.ctx.storage.kv.get<SandboxBoot>("boot");
      return { status: "running", ...(boot ? { size: boot.size } : {}) };
    });
  }

  async ensure(boot: SandboxBoot): Promise<SandboxState> {
    return await this.#active(async () => {
      await this.#ensure(boot);
      return await this.state();
    });
  }

  /**
   * Stop the container. Unless the caller is only resizing it, the owner's
   * latest snapshot is forgotten too when it is this container's, so the next
   * start cannot bring back the state being discarded; another container's
   * newer one is kept. The platform has no snapshot delete; an unreferenced
   * one expires in 30 days.
   */
  async destroy(options: { keepSnapshot?: boolean } = {}): Promise<void> {
    if (!options.keepSnapshot) {
      this.ctx.storage.kv.delete(RELEASE_DUE_KEY);
      this.ctx.storage.kv.delete(STOP_PENDING_KEY);
      this.ctx.storage.kv.delete(STOP_DUE_KEY);
      await this.#world(this.ctx.storage.kv.get<SandboxBoot>("boot"))
        ?.forgetContainerSnapshot({ sandbox: this.ctx.id.toString() })
        .catch(() => undefined);
    }
    if (this.#booting) await this.#booting.catch(() => undefined);
    if (this.ctx.container?.running) {
      const cpuUsec = await this.#readCpu();
      await this.#container.destroy();
      await this.#closeMeter(Date.now(), cpuUsec, "succeeded");
    } else {
      await this.#closeMeter(Date.now(), undefined, "succeeded");
    }
    await settleContainer(this.env, this.ctx.id.toString()).catch(() => undefined);
  }

  async release(options: SandboxReleaseOptions = {}): Promise<void> {
    if (!this.ctx.container?.running) return;
    const kv = this.ctx.storage.kv;
    const warmMs =
      options.warm === false
        ? 0
        : Number.isSafeInteger(options.warmMs) && options.warmMs! >= 0
          ? Math.min(options.warmMs!, MAX_IDLE_TIMEOUT_MS)
          : WARM_WINDOW_MS;
    if (options.snapshot === false) {
      kv.delete(RELEASE_DUE_KEY);
      kv.put(STOP_DUE_KEY, Date.now() + warmMs);
      kv.put(STOP_PENDING_KEY, true);
      await this.#armAlarm();
      return;
    }
    const snapshotDue = Date.now() + RELEASE_DELAY_MS;
    kv.put(RELEASE_DUE_KEY, snapshotDue);
    kv.put(STOP_DUE_KEY, snapshotDue + warmMs);
    this.ctx.storage.kv.put(STOP_PENDING_KEY, true);
    await this.#armAlarm();
  }

  async #armAlarm(): Promise<void> {
    const kv = this.ctx.storage.kv;
    const steps = [
      kv.get<number>(RELEASE_DUE_KEY),
      kv.get<boolean>(STOP_PENDING_KEY) ? kv.get<number>(STOP_DUE_KEY) : undefined,
      kv.get<ContainerMeter>(METER_KEY) || kv.get<unknown[]>(METER_CLOSING_KEY)?.length
        ? kv.get<number>(METER_DUE_KEY) ?? Date.now() + METER_TICK_MS
        : undefined,
    ].filter((due): due is number => due !== undefined);
    if (steps.length === 0) return;
    const due = Math.min(...steps);
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null || alarm > due) await this.ctx.storage.setAlarm(due);
  }

  async alarm(): Promise<void> {
    const kv = this.ctx.storage.kv;
    const snapshotDue = kv.get<number>(RELEASE_DUE_KEY);
    if (snapshotDue !== undefined && snapshotDue <= Date.now()) {
      kv.delete(RELEASE_DUE_KEY);
      await this.#snapshotReleased().catch((error: unknown) => {
        console.log(
          JSON.stringify({
            level: "error",
            event: "sandbox_snapshot_failed",
            sandbox: this.ctx.id.toString().slice(0, 12),
            message: errorText(error),
          }),
        );
      });
    }
    const stopDue = kv.get<number>(STOP_DUE_KEY);
    if (stopDue !== undefined && stopDue <= Date.now()) {
      kv.delete(STOP_DUE_KEY);
      if (kv.get<boolean>(STOP_PENDING_KEY)) {
        kv.delete(STOP_PENDING_KEY);
        await this.#stopReleased();
      }
    }
    const meterDue = kv.get<number>(METER_DUE_KEY);
    if (meterDue === undefined || meterDue <= Date.now()) {
      await this.#meterTick().catch((error: unknown) => {
        console.log(
          JSON.stringify({
            level: "error",
            event: "container_meter_tick_failed",
            sandbox: this.ctx.id.toString().slice(0, 12),
            message: errorText(error),
          }),
        );
        kv.put(METER_DUE_KEY, Date.now() + METER_TICK_MS);
      });
    }
    if (!this.ctx.container?.running) {
      kv.delete(RELEASE_DUE_KEY);
      kv.delete(STOP_DUE_KEY);
      kv.delete(STOP_PENDING_KEY);
    }
    await this.#armAlarm();
  }

  async #active<T>(work: () => Promise<T>): Promise<T> {
    this.#inflight += 1;
    this.#touch();
    try {
      return await work();
    } finally {
      this.#inflight -= 1;
      this.#touch();
    }
  }

  // An alarm counts as Durable Object activity and restarts the platform's
  // inactivity timeout, so while the meter ticks this object stops an idle
  // container itself; that needs when the last call ended.
  #touch(): void {
    const now = Date.now();
    this.#lastActiveAt = now;
    if (now - this.#lastActiveWritten < LAST_ACTIVE_WRITE_EVERY_MS) return;
    this.#lastActiveWritten = now;
    this.ctx.storage.kv.put(LAST_ACTIVE_KEY, now);
  }

  // Processes the meter stopped for want of budget report that, not an
  // out-of-memory kill, so the turn ends with the budget message.
  #throwIfBudgetStopped(): void {
    const message = this.ctx.storage.kv.get<string>(BUDGET_STOP_KEY);
    if (message) throw containerBudgetError(message);
  }

  #gate(owner: string) {
    return ownerGateStub(this.env.OWNER_GATES, owner);
  }

  #meterLog(event: string, fields: Record<string, unknown>): void {
    console.log(
      JSON.stringify({
        level: event.endsWith("_failed") ? "error" : "info",
        event,
        sandbox: this.ctx.id.toString().slice(0, 12),
        ...fields,
      }),
    );
  }

  async #readCpu(): Promise<number | undefined> {
    if (!this.ctx.container?.running) return undefined;
    try {
      const result = await this.#run(CPU_READ_COMMAND);
      return result.success ? parseCpuUsec(result.stdout) : undefined;
    } catch {
      return undefined;
    }
  }

  async #openMeter(boot: SandboxBoot): Promise<void> {
    const kv = this.ctx.storage.kv;
    const stale = kv.get<ContainerMeter>(METER_KEY);
    if (stale) await this.#closeMeter(this.#lostStopTime(stale), undefined, "succeeded");
    await this.#flushClosing();
    if (!boot.owner) {
      this.#meterLog("container_meter_unowned", { workload: boot.workload });
      return;
    }
    const now = Date.now();
    const meter: ContainerMeter = {
      owner: boot.owner,
      size: boot.size,
      run: crypto.randomUUID(),
      startedAt: now,
      settledThrough: now,
      seq: 0,
      lastSeenAt: now,
    };
    const hold = await this.#gate(boot.owner).reserveSpend({
      id: meterReservationId(meter),
      ...containerHold(boot.size, now),
      requireCloudSandbox: true,
    });
    if (!hold.reserved) {
      const message = refusalMessage(hold);
      this.#meterLog("container_start_refused", { instanceSize: boot.size, plan: hold.plan, message });
      throw containerBudgetError(message);
    }
    kv.delete(BUDGET_STOP_KEY);
    kv.put(METER_KEY, meter);
    kv.put(METER_DUE_KEY, now + METER_TICK_MS);
    await this.#armAlarm();
  }

  // The VM's CPU counter starts at its boot; a container that came up long
  // before this run's start (not expected) is measured from now instead.
  async #meterBaseline(): Promise<void> {
    const kv = this.ctx.storage.kv;
    const meter = kv.get<ContainerMeter>(METER_KEY);
    if (!meter) return;
    const reading = await this.#readCpu();
    if (reading === undefined) return;
    const uptime = await this.#run(["cat", "/proc/uptime"])
      .then((result) => Number(result.stdout.trim().split(/\s+/u)[0]))
      .catch(() => Number.NaN);
    const freshBoot = Number.isFinite(uptime) && uptime <= (Date.now() - meter.startedAt) / 1000 + 30;
    kv.put(METER_KEY, { ...meter, cpuUsec: freshBoot ? 0 : reading });
  }

  // A container that stopped without this object (inactivity timeout, crash)
  // stopped between the last tick that saw it and now: charge to the middle.
  #lostStopTime(meter: ContainerMeter): number {
    const now = Date.now();
    return Math.max(meter.settledThrough, Math.min(now, meter.lastSeenAt + (now - meter.lastSeenAt) / 2));
  }

  async #closeMeter(until: number, cpuUsec: number | undefined, outcome: CostOutcome): Promise<void> {
    const kv = this.ctx.storage.kv;
    const meter = kv.get<ContainerMeter>(METER_KEY);
    if (!meter) return;
    const closing = kv.get<Array<{ meter: ContainerMeter; until: number; cpuUsec?: number; outcome: CostOutcome }>>(
      METER_CLOSING_KEY,
    ) ?? [];
    closing.push({ meter, until: Math.max(until, meter.settledThrough), ...(cpuUsec === undefined ? {} : { cpuUsec }), outcome });
    kv.put(METER_CLOSING_KEY, closing);
    kv.delete(METER_KEY);
    await this.#flushClosing();
  }

  async #flushClosing(): Promise<void> {
    const kv = this.ctx.storage.kv;
    const closing = kv.get<Array<{ meter: ContainerMeter; until: number; cpuUsec?: number; outcome: CostOutcome }>>(
      METER_CLOSING_KEY,
    );
    if (!closing?.length) return;
    const left: typeof closing = [];
    for (const entry of closing) {
      const interval = meterInterval(entry.meter, entry.until, entry.cpuUsec, entry.outcome);
      try {
        await this.#gate(entry.meter.owner).settleSpend({
          ...interval,
          reservationId: meterReservationId(entry.meter),
          release: true,
        });
        this.#meterLog("container_meter_closed", {
          run: entry.meter.run,
          instanceType: interval.cost.sku,
          ranSeconds: Math.round((entry.until - entry.meter.startedAt) / 1000),
          intervalSeconds: interval.cost.quantity?.seconds,
          cpuSeconds: interval.cost.quantity?.cpuSeconds,
          basis: interval.cost.basis,
          chargedMicroCents: interval.chargeMicroCents,
          outcome: entry.outcome,
        });
      } catch (error) {
        left.push(entry);
        this.#meterLog("container_meter_settle_failed", { run: entry.meter.run, message: errorText(error) });
      }
    }
    if (left.length) {
      kv.put(METER_CLOSING_KEY, left);
      if (kv.get<number>(METER_DUE_KEY) === undefined) kv.put(METER_DUE_KEY, Date.now() + METER_TICK_MS);
    } else {
      kv.delete(METER_CLOSING_KEY);
    }
  }

  async #meterTick(): Promise<void> {
    const kv = this.ctx.storage.kv;
    kv.delete(METER_DUE_KEY);
    await this.#flushClosing();
    if (this.#booting) await this.#booting.catch(() => undefined);
    const meter = kv.get<ContainerMeter>(METER_KEY);
    if (!meter) return;
    const now = Date.now();
    if (!this.ctx.container?.running) {
      await this.#closeMeter(this.#lostStopTime(meter), undefined, "succeeded");
      return;
    }
    const boot = kv.get<SandboxBoot>("boot");
    const idleMs = boot ? resolvedIdleTimeoutMs(boot) : DEFAULT_IDLE_TIMEOUT_MS;
    const lastActive = this.#lastActiveAt;
    if (this.#inflight === 0 && now - lastActive >= idleMs) {
      await this.#stopReleased("idle");
      return;
    }
    let current: ContainerMeter = { ...meter, lastSeenAt: now };
    if (now - meter.settledThrough >= METER_SETTLE_EVERY_MS) {
      const cpuUsec = await this.#readCpu();
      const interval = meterInterval(meter, now, cpuUsec, "succeeded");
      const gate = this.#gate(meter.owner);
      await gate.settleSpend({ ...interval, reservationId: meterReservationId(meter) });
      const { cpuUsec: _previous, ...rest } = current;
      current = { ...rest, settledThrough: now, seq: meter.seq + 1, ...(cpuUsec === undefined ? {} : { cpuUsec }) };
      kv.put(METER_KEY, current);
      const hold = await gate.reserveSpend({
        id: meterReservationId(meter),
        ...containerHold(meter.size, now),
        requireCloudSandbox: true,
      });
      if (!hold.reserved) {
        kv.put(BUDGET_STOP_KEY, refusalMessage(hold));
        this.#meterLog("container_budget_stop", { run: meter.run, plan: hold.plan, message: refusalMessage(hold) });
        await this.#snapshotReleased().catch(() => undefined);
        await this.#stopReleased("budget");
        return;
      }
    } else {
      kv.put(METER_KEY, current);
    }
    const idleDue = this.#inflight === 0 ? lastActive + idleMs + 1_000 : Number.POSITIVE_INFINITY;
    kv.put(METER_DUE_KEY, Math.max(now + 5_000, Math.min(now + METER_TICK_MS, idleDue)));
  }

  async #snapshotReleased(): Promise<void> {
    if (this.#booting) await this.#booting.catch(() => undefined);
    const container = this.ctx.container;
    if (!container?.running) return;
    const boot = this.ctx.storage.kv.get<SandboxBoot>("boot");
    const world = this.#world(boot);
    try {
      if (this.#snapshotsEnabled && world) {
        const startedAt = Date.now();
        const info = await container.inspect();
        const snapshot = await container.snapshotContainer({
          name: "stella-world",
        });
        await world.recordContainerSnapshot({
          id: snapshot.id,
          size: snapshot.size,
          image: info?.image ?? container.images.sandbox!,
          takenAt: Date.now(),
          sandbox: this.ctx.id.toString(),
        } satisfies ContainerSnapshot, diskClass(boot!.size));
        console.log(
          JSON.stringify({
            level: "info",
            event: "sandbox_snapshot_taken",
            sandbox: this.ctx.id.toString().slice(0, 12),
            sizeBytes: snapshot.size,
            snapshotMs: Date.now() - startedAt,
          }),
        );
      }
    } finally {
      if (boot?.world) await this.#backupDependencies(boot.world, boot.size);
    }
  }

  async #stopReleased(reason: "released" | "idle" | "budget" = "released"): Promise<void> {
    if (this.#booting) await this.#booting.catch(() => undefined);
    if (!this.ctx.container?.running) return;
    const cpuUsec = await this.#readCpu();
    // A stop that fails leaves the inactivity timeout to do it.
    let failure: string | undefined;
    this.#stopping = this.#container
      .destroy()
      .catch((error: unknown) => {
        failure = errorText(error);
      })
      .finally(() => {
        this.#stopping = null;
      });
    await this.#stopping;
    if (!failure) {
      await settleContainer(this.env, this.ctx.id.toString()).catch(() => undefined);
      await this.#closeMeter(Date.now(), cpuUsec, reason === "budget" ? "aborted" : "succeeded");
    }
    console.log(
      JSON.stringify({
        level: failure ? "error" : "info",
        event: failure ? "sandbox_container_stop_failed" : "sandbox_container_stopped",
        sandbox: this.ctx.id.toString().slice(0, 12),
        reason,
        ...(failure ? { message: failure } : {}),
      }),
    );
  }

  async #restoreDependencies(
    worldName: string,
    size: SandboxInstanceSize,
  ): Promise<void> {
    const world = this.env.WORLDS.getByName(worldName);
    const stored = await world
      .dependencyBackup(diskClass(size))
      .catch(() => null);
    if (!stored) return;
    const startedAt = Date.now();
    try {
      await this.#run(["rm", "-rf", "--", DEPENDENCY_RESTORE_ROOT]);
      await this.#dependencyBackups(worldName).restore(stored.record, {
        dir: DEPENDENCY_RESTORE_ROOT,
        signal: AbortSignal.timeout(DEPENDENCY_TRANSFER_TIMEOUT_MS),
      });
      const placed = await this.#run([
        "bash",
        "-c",
        DEPENDENCY_PLACE_TOOL_HOME_SCRIPT,
      ]);
      if (!placed.success) {
        throw new Error(placed.stderr.trim().slice(-500) || "placement failed");
      }
      this.ctx.storage.kv.put(DEPENDENCY_BASELINE_KEY, {
        mark: stored.mark,
        fingerprint: stored.fingerprint,
      } satisfies DependencyBaseline);
      console.log(
        JSON.stringify({
          level: "info",
          event: "sandbox_dependencies_restored",
          sizeBytes: stored.record.size,
          sourceBytes: stored.bytes,
          restoreMs: Date.now() - startedAt,
        }),
      );
    } catch (error) {
      if (
        SandboxBackupError.is(error) &&
        (error.code === "BACKUP_NOT_FOUND" || error.code === "BACKUP_INTEGRITY")
      ) {
        await world
          .forgetDependencyBackup(stored.record.id)
          .catch(() => undefined);
      }
      await this.#run(["rm", "-rf", "--", DEPENDENCY_RESTORE_ROOT]).catch(
        () => undefined,
      );
      console.log(
        JSON.stringify({
          level: "error",
          event: "sandbox_dependencies_restore_failed",
          restoreMs: Date.now() - startedAt,
          message: errorText(error),
        }),
      );
    }
  }

  async #backupDependencies(
    worldName: string,
    size: SandboxInstanceSize,
  ): Promise<void> {
    if (this.ctx.storage.kv.get<SandboxBoot>("boot")?.workload !== "world") {
      return;
    }
    const world = this.env.WORLDS.getByName(worldName);
    const previous = this.ctx.storage.kv.get<DependencyBaseline>(
      DEPENDENCY_BASELINE_KEY,
    );
    const startedAt = Date.now();
    const skipped = (reason: string, fields: Record<string, unknown> = {}) =>
      console.log(
        JSON.stringify({
          level: "info",
          event: "sandbox_dependencies_backup_skipped",
          reason,
          ...fields,
          probeMs: Date.now() - startedAt,
        }),
      );
    try {
      const result = await this.#run(
        [
          "bash",
          "-c",
          DEPENDENCY_PROBE_SCRIPT,
          "probe",
          String(previous?.mark ?? 0),
          previous?.fingerprint ?? "",
        ],
        { cwd: DEPENDENCY_BACKUP_DIR },
      );
      const probe = parseDependencyProbe(result.stdout);
      if (!probe) {
        throw new Error(
          result.stderr.trim().slice(-500) || "the probe printed no result",
        );
      }
      if (probe.state !== "changed") return skipped(probe.state);
      if (probe.bytes > DEPENDENCY_BACKUP_MAX_BYTES) {
        return skipped("over_cap", {
          sourceBytes: probe.bytes,
          capBytes: DEPENDENCY_BACKUP_MAX_BYTES,
        });
      }
      const foreign = probe.foreign.map(dependencyExcludeForPath);
      if (
        probe.foreign.length > DEPENDENCY_FOREIGN_LIMIT ||
        foreign.some((pattern) => pattern === null)
      ) {
        return skipped("foreign_files", { foreignCount: probe.foreign.length });
      }
      const archiveStartedAt = Date.now();
      const backups = this.#dependencyBackups(worldName);
      const record = await backups.backup({
        dir: DEPENDENCY_BACKUP_DIR,
        name: "stella-dependencies",
        exclude: [...DEPENDENCY_BACKUP_EXCLUDES, ...(foreign as string[])],
        signal: AbortSignal.timeout(DEPENDENCY_TRANSFER_TIMEOUT_MS),
      });
      const next: StoredDependencyBackup = {
        record,
        fingerprint: probe.fingerprint,
        mark: probe.now,
        bytes: probe.bytes,
        takenAt: Date.now(),
      };
      // Last writer wins: concurrent releases each replace the one before,
      // and each deletes what it replaced, so no archive is left unnamed.
      const replaced = await world.replaceDependencyBackup(
        next,
        diskClass(size),
      );
      this.ctx.storage.kv.put(DEPENDENCY_BASELINE_KEY, {
        mark: next.mark,
        fingerprint: next.fingerprint,
      } satisfies DependencyBaseline);
      if (replaced && replaced.record.id !== record.id) {
        await backups.delete(replaced.record).catch(() => undefined);
      }
      console.log(
        JSON.stringify({
          level: "info",
          event: "sandbox_dependencies_backed_up",
          sizeBytes: record.size,
          sourceBytes: probe.bytes,
          excludedForeign: probe.foreign.length,
          probeMs: archiveStartedAt - startedAt,
          backupMs: Date.now() - archiveStartedAt,
        }),
      );
    } catch (error) {
      console.log(
        JSON.stringify({
          level: "error",
          event: "sandbox_dependencies_backup_failed",
          backupMs: Date.now() - startedAt,
          message: errorText(error),
        }),
      );
    }
  }

  async putSession(config: SandboxSessionConfig): Promise<void> {
    this.ctx.storage.kv.put(`${SESSION_PREFIX}${config.id}`, config);
  }

  async getSession(id: string): Promise<SandboxSessionConfig | null> {
    return this.ctx.storage.kv.get<SandboxSessionConfig>(
      `${SESSION_PREFIX}${id}`,
    ) ?? null;
  }

  async deleteSession(id: string): Promise<void> {
    this.ctx.storage.kv.delete(`${SESSION_PREFIX}${id}`);
  }

  async exec(
    boot: SandboxBoot,
    request: SandboxExecRequest,
  ): Promise<SandboxExecResult> {
    return await this.#active(async () => {
      await this.#ensure(boot);
      return await this.#run(
        [...timeoutArgv(request.timeoutMs), "bash", "-c", request.command],
        { cwd: request.cwd ?? DEFAULT_CWD, env: cleanEnv(request.env) },
      );
    });
  }

  async readFile(
    boot: SandboxBoot,
    path: string,
    encoding: "base64" | "utf-8" | "none" = "utf-8",
  ): Promise<
    | { success: true; encoding: "base64" | "utf-8"; content: string; size: number }
    | { success: true; encoding: "none"; content: ReadableStream; size: number }
  > {
    return await this.#active(async () => {
      await this.#ensure(boot);
      const stat = await this.#fs.stat(path);
      const response = await this.#fs.readFile(path);
      const size = Number(stat.size);
      if (encoding === "none") {
        return { success: true, encoding, content: response.body!, size };
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      return {
        success: true,
        encoding,
        content: encoding === "base64" ? bytesToBase64(bytes) : decoder.decode(bytes),
        size,
      };
    });
  }

  async writeFile(
    boot: SandboxBoot,
    path: string,
    content: string | ReadableStream<Uint8Array>,
    encoding: "base64" | "utf-8" = "utf-8",
  ): Promise<{ success: true }> {
    return await this.#active(async () => {
      await this.#ensure(boot);
      const bytes =
        typeof content === "string" && encoding === "base64"
          ? base64ToBytes(content)
          : content;
      const parent = path.slice(0, path.lastIndexOf("/")) || "/";
      if (typeof bytes !== "string" && !(bytes instanceof Uint8Array)) {
        await this.#fs.mkdir(parent, { recursive: true });
      }
      try {
        await this.#fs.writeFile(path, bytes);
      } catch (error) {
        // 0.12 created missing parents.
        if (!SandboxFileError.is(error) || error.code !== "ENOENT") throw error;
        await this.#fs.mkdir(parent, { recursive: true });
        await this.#fs.writeFile(path, bytes);
      }
      return { success: true };
    });
  }

  async deleteFile(boot: SandboxBoot, path: string): Promise<{ success: true }> {
    return await this.#active(async () => {
      await this.#ensure(boot);
      await this.#fs.remove(path);
      return { success: true };
    });
  }

  async mkdir(
    boot: SandboxBoot,
    path: string,
    recursive: boolean,
  ): Promise<{ success: true }> {
    return await this.#active(async () => {
      await this.#ensure(boot);
      await this.#fs.mkdir(path, { recursive });
      return { success: true };
    });
  }

  async exists(boot: SandboxBoot, path: string): Promise<boolean> {
    return await this.#active(async () => {
      await this.#ensure(boot);
      try {
        await this.#fs.lstat(path);
        return true;
      } catch (error) {
        if (SandboxFileError.is(error) && error.code === "ENOENT") return false;
        throw error;
      }
    });
  }

  async startProcess(
    boot: SandboxBoot,
    request: SandboxExecRequest & { processId: string },
  ): Promise<SandboxProcessInfo> {
    return await this.#active(async () => {
      await this.#ensure(boot);
      const dir = processDirectory(request.processId);
      const existing = await this.getProcess(request.processId);
      if (existing && (existing.status === "running" || existing.status === "starting")) {
        throw new Error(`Sandbox process ${request.processId} is already running.`);
      }
      await this.#run(["rm", "-rf", "--", dir]);
      await this.#fs.mkdir(dir, { recursive: true });
      await this.#container.exec(
        [
          "bash",
          "-c",
          RUN_SCRIPT,
          "run",
          dir,
          ...timeoutArgv(request.timeoutMs),
          "bash",
          "-c",
          request.command,
        ],
        {
          cwd: request.cwd ?? DEFAULT_CWD,
          env: cleanEnv(BASE_ENV, request.env),
          stdout: "ignore",
          stderr: "ignore",
        },
      );
      return { id: request.processId, status: "running" };
    });
  }

  async getProcess(id: string): Promise<SandboxProcessInfo | null> {
    return await this.#active(async () => {
      // A stopped container took every process with it, most often by running
      // out of memory; 137 is what the OOM handling recognizes.
      if (!this.ctx.container?.running) {
        this.#throwIfBudgetStopped();
        return { id, status: "killed", exitCode: 137 };
      }
      const result = await this.#run([
        "bash",
        "-c",
        STATUS_SCRIPT,
        "status",
        processDirectory(id),
      ]);
      return statusFromLine(id, result.stdout);
    });
  }

  async processLogs(id: string): Promise<{ stdout: string; stderr: string }> {
    return await this.#active(async () => {
      if (!this.ctx.container?.running) return { stdout: "", stderr: "" };
      const dir = processDirectory(id);
      const read = async (name: string) => {
        try {
          return await (await this.#fs.readFile(`${dir}/${name}`)).text();
        } catch (error) {
          if (SandboxFileError.is(error) && error.code === "ENOENT") return "";
          throw error;
        }
      };
      const [stdout, stderr] = await Promise.all([
        read("stdout.log"),
        read("stderr.log"),
      ]);
      return { stdout, stderr };
    });
  }

  async waitForExit(
    id: string,
    timeoutMs: number,
  ): Promise<{ exitCode: number }> {
    return await this.#active(async () => {
      if (!this.ctx.container?.running) {
        this.#throwIfBudgetStopped();
        throw new Error(`Sandbox process ${id} is not running.`);
      }
      const signal = AbortSignal.timeout(Math.max(1, timeoutMs));
      const process = await this.#container.exec(
        ["bash", "-c", WAIT_FOR_EXIT_SCRIPT, "wait", processDirectory(id)],
        { signal, env: { ...BASE_ENV } },
      );
      const output = await process.output();
      if (!this.ctx.container?.running) this.#throwIfBudgetStopped();
      if (signal.aborted) {
        throw new Error(`Sandbox process ${id} did not exit in time.`);
      }
      const value = decoder.decode(output.stdout).trim();
      if (value === "lost") return { exitCode: 137 };
      const exitCode = Number(value);
      if (!Number.isSafeInteger(exitCode)) {
        throw new Error(`Sandbox process ${id} reported no exit code.`);
      }
      return { exitCode };
    });
  }

  async killProcess(id: string, signal = "SIGTERM"): Promise<boolean> {
    return await this.#active(async () => {
      if (!this.ctx.container?.running) return false;
      const name = SIGNALS[signal] ?? signal.replace(/^SIG/u, "");
      const result = await this.#run([
        "bash",
        "-c",
        KILL_SCRIPT,
        "kill",
        processDirectory(id),
        name,
      ]);
      return result.exitCode === 0;
    });
  }
}
