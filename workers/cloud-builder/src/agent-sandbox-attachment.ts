import type { ExecutionSession, Process } from "./sandbox-client.js";
import { Effect } from "effect";
import { runToolEffect } from "@stella/runtime/kernel/tools/effect-runtime.js";
import {
  ATTACHED_TOOL_PROTOCOL_VERSION,
  ATTACHED_TOOL_RESPONSE_MAX_BYTES,
  attachedToolPathsForDirectory,
  decodeAttachedToolFrame,
  encodeAttachedToolFrame,
  parseAttachedToolControlResponse,
  parseAttachedToolResponse,
  type AttachedToolControlRequest,
  type AttachedToolControlResponse,
  type AttachedToolRequest,
  type AttachedToolResponse,
} from "@stella/executor-cloud/attached-tool-protocol";
import { SANDBOX_EXECUTOR } from "./sandbox-code.js";
import type { TurnExecutionContext } from "./turn-cancellation.js";
import type { InstanceSize } from "./instance-size.js";

export type AttachBoot = Readonly<{
  coldStartMs: number;
  restoreMs: number;
}>;

export type SandboxAttachment = Readonly<{
  boot(args: {
    sandboxId: string;
    instanceSize: InstanceSize;
    sessionId: string;
    daemonDirectory: string;
  }): Promise<AttachBoot>;
  callTool(args: {
    sandboxId: string;
    request: AttachedToolRequest;
  }): Promise<AttachedToolResponse>;
  control(args: {
    sandboxId: string;
    control: "boot_report" | "quiesce";
    turnId: string;
    attemptGeneration: number;
    linkedPaths?: readonly string[];
  }): Promise<AttachedToolControlResponse>;
  release(args: {
    sandboxId: string;
    instanceSize: InstanceSize;
    sessionId: string;
    daemonDirectory: string;
  }): Promise<void>;
  destroy(args: {
    sandboxId: string;
    instanceSize: InstanceSize;
  }): Promise<void>;
}>;

const DAEMON_ARGV = [SANDBOX_EXECUTOR, "--attached-tool-host"] as const;

const CLIENT_ARGV = [SANDBOX_EXECUTOR, "--attached-tool-client"] as const;

const EXECUTOR_ROOT = "/opt/stella";

const READINESS_POLL_MS = 250;
const READINESS_ATTEMPTS = 240;


const DAEMON_STDERR_EXCERPT_CHARS = 400;

const DAEMON_TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "failed",
  "killed",
  "error",
]);

const DAEMON_RPC_DEADLINE_MS = 5_000;
const bounded = async <T>(
  work: Promise<T> | undefined,
  fallback: T,
): Promise<T> => {
  if (!work) return fallback;
  const settled = work.then(
    (value) => value,
    () => fallback,
  );
  return await runToolEffect(
    Effect.raceFirst(
      Effect.tryPromise({ try: () => settled, catch: () => fallback }),
      Effect.sleep(DAEMON_RPC_DEADLINE_MS).pipe(Effect.map(() => fallback)),
    ),
  );
};

const describeDaemon = async (
  daemon: Process | undefined,
  daemonStderrPath: string | undefined,
  session?: ExecutionSession,
  knownStatus?: string,
): Promise<{ status: string; stderr: string }> => {
  if (!daemon) return { status: "unknown", stderr: "" };
  const [status, logs] = await Promise.all([
    knownStatus
      ? Promise.resolve(knownStatus)
      : bounded(daemon.getStatus?.(), "unknown"),
    bounded(daemon.getLogs?.(), null),
  ]);
  let stderr = (logs?.stderr ?? "").replace(/\s+/gu, " ").trim();
  if (!stderr && session && daemonStderrPath) {
    const persisted = await session
      .exec(
        `tail -c ${DAEMON_STDERR_EXCERPT_CHARS} ${quoted([daemonStderrPath])}`,
      )
      .catch(() => null);
    if (persisted?.success) {
      stderr = persisted.stdout.replace(/\s+/gu, " ").trim();
    }
  }
  return { status, stderr: stderr.slice(-DAEMON_STDERR_EXCERPT_CHARS) };
};

export class AttachedToolHostUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachedToolHostUnavailableError";
  }
}

export type AttachedToolHostHandoff = Readonly<{
  turnId: string;
  attemptGeneration: number;
  threadId: string;
  prompt: string;
  workspaceRestored: boolean;
  turnBroker: Readonly<{ credentialsPath: string }>;
  world: Readonly<{
    origin: string;
    name: string;
    capability: string;
  }>;
}>;

export type AgentSandboxAttachmentDeps = Readonly<{
  context: TurnExecutionContext;
  attachWorld(args: {
    sandboxId: string;
    instanceSize: InstanceSize;
    sessionId: string;
  }): Promise<
    Readonly<{
      session: ExecutionSession;
      coldContainerStartMs: number;
      restoreMs: number;
    }>
  >;
  prepareBrokerHandoff(args: {
    session: ExecutionSession;
  }): Promise<AttachedToolHostHandoff>;
  startDaemon: (
    command: string,
    options: Readonly<{ cwd: string; processId: string }>,
  ) => Promise<Process>;
  release(args: {
    sandboxId: string;
    instanceSize: InstanceSize;
    sessionId: string;
    daemonDirectory: string;
  }): Promise<void>;
  destroy(args: {
    sandboxId: string;
    instanceSize: InstanceSize;
  }): Promise<void>;
  emitEvent?: (kind: string, payload: unknown) => void;
}>;

const quoted = (argv: readonly string[]): string =>
  argv
    .map((token) => {
      if (token.includes("\0")) {
        throw new Error("Attached tool argv contains a NUL byte.");
      }
      return `'${token.replace(/'/gu, `'"'"'`)}'`;
    })
    .join(" ");

const readBoundedFrame = async (
  session: ExecutionSession,
  path: string,
): Promise<unknown> => {
  const size = await session.exec(`wc -c < ${quoted([path])}`);
  if (!size.success) {
    throw new AttachedToolHostUnavailableError(
      "The workspace did not return a result for that call.",
    );
  }
  const bytes = Number.parseInt(size.stdout.trim(), 10);
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new AttachedToolHostUnavailableError(
      "The workspace returned an unreadable result for that call.",
    );
  }
  if (bytes > ATTACHED_TOOL_RESPONSE_MAX_BYTES) {
    throw new AttachedToolHostUnavailableError(
      "That call produced more output than the workspace bridge can carry.",
    );
  }
  const read = await session.readFile(path, { encoding: "base64" });
  return decodeAttachedToolFrame(
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
      Uint8Array.from(atob(read.content), (character) =>
        character.charCodeAt(0),
      ),
    ),
    ATTACHED_TOOL_RESPONSE_MAX_BYTES,
  );
};

const DAEMON_UNREACHABLE =
  /ECONNREFUSED|ENOENT|EPIPE|ECONNRESET|unreachable|socket closed/iu;

export const createAgentSandboxAttachment = (
  deps: AgentSandboxAttachmentDeps,
): SandboxAttachment => {
  let attached: ExecutionSession | undefined;
  let daemon: Process | undefined;
  let daemonDirectory: string | undefined;
  let daemonLossReported = false;

  const requireSession = (): ExecutionSession => {
    if (!attached) {
      throw new AttachedToolHostUnavailableError(
        "This turn has no workspace attached.",
      );
    }
    return attached;
  };

  const writeProtected = async (
    session: ExecutionSession,
    path: string,
    contents: string,
  ): Promise<void> => {
    await session.writeFile(path, contents);
    const protectedFile = await session.exec(`chmod 600 ${quoted([path])}`);
    if (!protectedFile.success) {
      throw new AttachedToolHostUnavailableError(
        "The workspace bridge handoff could not be protected.",
      );
    }
  };

  const roundTrip = async (
    frame: AttachedToolRequest | AttachedToolControlRequest,
  ): Promise<unknown> => {
    const session = requireSession();
    if (!daemonDirectory) {
      throw new AttachedToolHostUnavailableError(
        "This turn has no workspace bridge directory.",
      );
    }
    const paths = attachedToolPathsForDirectory(daemonDirectory);
    deps.context.assertActive();
    await session.deleteFile(paths.result).catch(() => undefined);
    await writeProtected(
      session,
      paths.request,
      encodeAttachedToolFrame(frame),
    );
    deps.context.assertActive();
    const call = await session.exec(
      quoted([
        ...CLIENT_ARGV,
        "--socket",
        paths.socket,
        "--request",
        paths.request,
        "--result",
        paths.result,
      ]),
      {
        cwd: EXECUTOR_ROOT,
      },
    );
    if (!call.success) {
      throw new AttachedToolHostUnavailableError(
        "The workspace could not run that call.",
      );
    }
    deps.context.assertActive();
    return await readBoundedFrame(session, paths.result);
  };

  const reportDaemonLoss = async (
    response: AttachedToolResponse | AttachedToolControlResponse,
  ): Promise<void> => {
    if (
      daemonLossReported ||
      response.status !== "failed" ||
      !DAEMON_UNREACHABLE.test(response.error)
    ) {
      return;
    }
    daemonLossReported = true;
    const paths = daemonDirectory
      ? attachedToolPathsForDirectory(daemonDirectory)
      : undefined;
    const described = await describeDaemon(
      daemon,
      paths?.daemonStderr,
      attached,
    );
    const inspect = async (command: string): Promise<string> => {
      const result = await attached?.exec(command).catch(() => null);
      return (result?.success ? result.stdout : (result?.stderr ?? ""))
        .replace(/\s+/gu, " ")
        .trim()
        .slice(0, 1_500);
    };
    deps.emitEvent?.("attached_daemon_failed", {
      reason: "The workspace bridge stopped answering",
      status: described.status,
      stderr: described.stderr,
      error: response.error,
      socketDir: await inspect(
        paths
          ? `ls -la --time-style=full-iso ${quoted([paths.directory])}`
          : "true",
      ),
      processes: await inspect("ps -eo pid,ppid,stat,etime,args"),
      memory: await inspect("free -m 2>&1 | head -2"),
      processRecords: await inspect(
        'for f in /tmp/sandbox-processes/*.json; do echo "== $f"; head -c 700 "$f"; echo; done 2>&1 | tail -c 1400',
      ),
      exitCode: String(
        (daemon as { exitCode?: unknown } | undefined)?.exitCode ?? "",
      ),
    });
  };

  const daemonFailure = async (
    daemon: Process | undefined,
    reason: string,
    knownStatus?: string,
  ): Promise<AttachedToolHostUnavailableError> => {
    const described = await describeDaemon(
      daemon,
      daemonDirectory
        ? attachedToolPathsForDirectory(daemonDirectory).daemonStderr
        : undefined,
      attached,
      knownStatus,
    );
    deps.emitEvent?.("attached_daemon_failed", {
      reason,
      status: described.status,
      stderr: described.stderr,
    });
    return new AttachedToolHostUnavailableError(
      described.stderr
        ? `${reason} (${described.status}): ${described.stderr}`
        : `${reason} (${described.status}).`,
    );
  };

  const waitForDaemon = async (
    session: ExecutionSession,
    daemon: Process | undefined,
    socketPath: string,
  ): Promise<void> => {
    for (let attempt = 0; attempt < READINESS_ATTEMPTS; attempt += 1) {
      deps.context.assertActive();
      const listening = await session.exec(`test -S ${quoted([socketPath])}`);
      if (listening.success) return;
      const status = await bounded(daemon?.getStatus?.(), "running");
      if (DAEMON_TERMINAL_STATUSES.has(status)) {
        throw await daemonFailure(
          daemon,
          "The workspace bridge exited before it could listen",
          status,
        );
      }
      await deps.context.cancellation.sleep(READINESS_POLL_MS);
    }
    throw await daemonFailure(
      daemon,
      "The workspace did not finish starting up",
    );
  };

  return {
    boot: async (args): Promise<AttachBoot> => {
      deps.context.assertActive();
      const world = await deps.attachWorld(args);
      attached = world.session;
      daemonDirectory = args.daemonDirectory;
      const paths = attachedToolPathsForDirectory(args.daemonDirectory);
      deps.context.assertActive();
      const directory = await world.session.exec(
        `mkdir -p ${quoted([paths.directory])} && chown 0:0 ${quoted([
          paths.directory,
        ])} && chmod 0700 ${quoted([paths.directory])}`,
      );
      if (!directory.success) {
        throw new AttachedToolHostUnavailableError(
          "The workspace bridge directory could not be prepared.",
        );
      }
      deps.context.assertActive();
      const handoff = await deps.prepareBrokerHandoff({
        session: world.session,
      });
      deps.context.assertActive();
      await writeProtected(
        world.session,
        paths.hostInput,
        JSON.stringify(handoff),
      );
      deps.context.assertActive();
      // The daemon is trusted root code: it holds the broker capability and
      // serves a root-only socket, so it must not be dropped to the tool
      // account the way a model-controlled command is.
      const daemonCommand = `exec setsid --fork --wait ${quoted([
        ...DAEMON_ARGV,
        "--dir",
        paths.directory,
      ])} 2>>${quoted([paths.daemonStderr])}`;
      const processId = `attached-daemon-${args.sessionId}`.slice(0, 64);
      daemon = await deps.startDaemon(daemonCommand, {
        cwd: EXECUTOR_ROOT,
        processId,
      });
      daemonLossReported = false;
      await waitForDaemon(world.session, daemon, paths.socket);
      return {
        coldStartMs: world.coldContainerStartMs,
        restoreMs: world.restoreMs,
      };
    },

    callTool: async (args): Promise<AttachedToolResponse> => {
      const response = parseAttachedToolResponse(await roundTrip(args.request));
      await reportDaemonLoss(response);
      return response;
    },

    control: async (args): Promise<AttachedToolControlResponse> => {
      const response = parseAttachedToolControlResponse(
        await roundTrip(
          args.control === "quiesce"
            ? {
                version: ATTACHED_TOOL_PROTOCOL_VERSION,
                turnId: args.turnId,
                attemptGeneration: args.attemptGeneration,
                control: "quiesce",
                linkedPaths: args.linkedPaths ?? [],
              }
            : {
                version: ATTACHED_TOOL_PROTOCOL_VERSION,
                turnId: args.turnId,
                attemptGeneration: args.attemptGeneration,
                control: "boot_report",
              },
        ),
      );
      if (response.status === "failed") {
        deps.emitEvent?.("attached_control_failed", {
          control: args.control,
          error: response.error,
        });
      }
      await reportDaemonLoss(response);
      return response;
    },

    release: async (args): Promise<void> => {
      const status = await bounded(daemon?.getStatus?.(), "completed");
      if (daemon && !DAEMON_TERMINAL_STATUSES.has(status)) {
        await bounded(daemon.kill("SIGKILL"), undefined);
      }
      attached = undefined;
      daemon = undefined;
      daemonDirectory = undefined;
      await deps.release(args);
    },

    destroy: async (args): Promise<void> => {
      attached = undefined;
      daemon = undefined;
      daemonDirectory = undefined;
      await deps.destroy(args);
    },
  };
};
