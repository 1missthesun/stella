/**
 * Where a conversation's file and shell tools run when they leave this
 * computer, for any engine whose brain stays here: pi's agents and Stella
 * (`./desktop-execution`), and Claude Code's, whose built-in tools are turned
 * off while their environment is away and whose Stella file and shell tools
 * run through this instead.
 *
 *   another computer: this computer --HTTP--> owner gate --presence socket--> computer
 *   cloud:            this computer --HTTP--> conversation object --> its container
 *
 * Both ends serve the same file and shell tools a cloud agent's container
 * does (`@stella/contracts/turn-plane/device-tools`), so a call leaves here in
 * their shape. Only a conversation stored in the cloud can move its tools.
 */
import { createHash } from "node:crypto";
import {
  DEVICE_TOOL_RUN_TIMEOUT_MS,
  type DeviceToolCall,
  type DeviceToolName,
  type DeviceToolOutcome,
  type DeviceToolResult,
} from "@stella/contracts/turn-plane/device-tools";
import {
  DEVICES_PATH,
  findDeviceDestination,
  type DeviceDestination,
  type DevicesResponse,
} from "@stella/contracts/turn-plane/placement";
import { deviceRefusal, deviceStanding, type DeviceStanding } from "../stella/execution.ts";
import type { StellaPlacement } from "../stella/placement.ts";

/** How long a cloud container is kept for tools that stopped calling it. */
const CLOUD_IDLE_MS = 10 * 60_000;
const LIST_TIMEOUT_MS = 15_000;
const RELEASE_TIMEOUT_MS = 60_000;
/** What a file call, or a shell call past its own wait, has to answer in. */
const CALL_ANSWER_MS = 60_000;
/** A shell call's own wait, as the container's tools default and cap it. */
const SHELL_WAIT_DEFAULT_MS = 120_000;
const STDIN_WAIT_DEFAULT_MS = 30_000;
const SHELL_WAIT_MAX_MS = 600_000;
/** A cloud container comes up on the first call after it was let go. */
const CLOUD_START_MS = 120_000;

/** One file or shell call for tools that run elsewhere. */
export type RemoteToolCall = {
  /**
   * Whose tools these are, stable across calls: a pi conversation's id, or a
   * Claude Code thread's key. It keys the cloud container and the request.
   */
  owner: string;
  /** The agent's thread; absent for Stella herself. */
  threadId?: string;
  callId: string;
  toolName: DeviceToolName;
  params: Record<string, unknown>;
};

/** How this computer reaches the owner's other computers and the cloud, for one conversation stored in the cloud. */
export type DesktopExecutionRemote = {
  /** The owner's computers, as the owner gate lists them. */
  devices(): Promise<DeviceDestination[]>;
  /** One call on a computer, relayed by the owner gate; `signal` withdraws it there too. */
  deviceTool(deviceId: string, requestId: string, call: DeviceToolCall, signal?: AbortSignal): Promise<DeviceToolOutcome>;
  /** One call in the conversation's cloud container for `scope`, which comes up on the first. */
  cloudTool(
    call: { scope: string; threadId: string; callId: string; toolName: DeviceToolName; params: Record<string, unknown> },
    signal?: AbortSignal,
  ): Promise<DeviceToolResult>;
  /** Save the container's work into the world and let it go. */
  releaseCloud(scope: string): Promise<void>;
};

const failureMessage = async (response: Response, what: string): Promise<string> => {
  const body = (await response.json().catch(() => null)) as { error?: unknown; message?: unknown } | null;
  const error = body?.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  if (typeof body?.message === "string") return body.message;
  return `${what} failed (${response.status}).`;
};

/**
 * The owner's other computers and the conversation's cloud container, over
 * HTTP with the user's sign-in, so the gate's consent checks apply to every
 * call as they do to the cloud's. Undefined for a conversation kept on this
 * computer, which runs its tools here only.
 */
export const httpExecutionRemote = (
  conversationId: string,
  auth: () => { baseUrl: string; authToken: string } | null | undefined,
): DesktopExecutionRemote | undefined => {
  if (conversationId.startsWith("local_")) return undefined;
  const signedIn = () => {
    const current = auth();
    if (!current) throw new Error("Sign in to Stella to run tools away from this computer.");
    return { base: current.baseUrl.replace(/\/+$/, ""), token: current.authToken };
  };
  const post = async (path: string, body: unknown, signal: AbortSignal): Promise<Response> => {
    const { base, token } = signedIn();
    return await fetch(`${base}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  };
  const workspacePath = `/conversations/${encodeURIComponent(conversationId)}/pi-workspace`;
  return {
    devices: async () => {
      const { base, token } = signedIn();
      const response = await fetch(`${base}${DEVICES_PATH}`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(await failureMessage(response, "Listing your computers"));
      return ((await response.json()) as DevicesResponse).devices ?? [];
    },
    deviceTool: async (deviceId, requestId, call, signal) => {
      const path = `${DEVICES_PATH}/${encodeURIComponent(deviceId)}/tool-calls`;
      const timeout = AbortSignal.timeout(DEVICE_TOOL_RUN_TIMEOUT_MS + 60_000);
      const stop = () => {
        // The computer stops the call too, not only this wait.
        void post(`${path}/cancel`, { requestId }, AbortSignal.timeout(LIST_TIMEOUT_MS)).catch(() => undefined);
      };
      signal?.addEventListener("abort", stop, { once: true });
      try {
        const response = await post(path, { requestId, call }, signal ? AbortSignal.any([signal, timeout]) : timeout);
        if (!response.ok) {
          return { ok: false, code: "failed", message: await failureMessage(response, "The call") } satisfies DeviceToolOutcome;
        }
        return (await response.json()) as DeviceToolOutcome;
      } finally {
        signal?.removeEventListener("abort", stop);
      }
    },
    cloudTool: async (call, signal) => {
      const timeout = AbortSignal.timeout(DEVICE_TOOL_RUN_TIMEOUT_MS + 60_000);
      const response = await post(workspacePath, { op: "call", ...call }, signal ? AbortSignal.any([signal, timeout]) : timeout);
      if (!response.ok) throw new Error(await failureMessage(response, "The cloud workspace"));
      return ((await response.json()) as { result: DeviceToolResult }).result;
    },
    releaseCloud: async (scope) => {
      const response = await post(workspacePath, { op: "release", scope }, AbortSignal.timeout(RELEASE_TIMEOUT_MS));
      if (!response.ok) throw new Error(await failureMessage(response, "Releasing the cloud workspace"));
    },
  };
};

const failed = (text: string): DeviceToolResult => ({ text, isError: true });

const shellWait = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.min(value, SHELL_WAIT_MAX_MS) : fallback;

/**
 * How long one call may take to come back before it is given up: a file
 * call a minute, a shell call its own wait and that minute, and the cloud
 * the time a container takes to come up as well.
 */
const callDeadlineMs = (placement: Exclude<StellaPlacement, { kind: "local" }>, call: RemoteToolCall): number => {
  const work =
    call.toolName === "Bash" || call.toolName === "exec_command"
      ? call.params.run_in_background === true
        ? 0
        : shellWait(call.params.timeout_ms, SHELL_WAIT_DEFAULT_MS)
      : call.toolName === "write_stdin"
        ? shellWait(call.params.yield_time_ms, STDIN_WAIT_DEFAULT_MS)
        : 0;
  return work + CALL_ANSWER_MS + (placement.kind === "cloud" ? CLOUD_START_MS : 0);
};

const unanswered = (where: string, call: RemoteToolCall, deadlineMs: number): DeviceToolResult =>
  failed(
    `${where} did not answer ${call.toolName} within ${Math.round(deadlineMs / 1000)} s, so the call was given up; it may still have run there. Check before you repeat a change, try again, or switch_destination back to this computer and carry on here.`,
  );

/**
 * One conversation's tools away from this computer: whether a place can take
 * them now (`prepare`), one call there (`run`), and letting a cloud container
 * go once its owner's tools leave it or sit idle. The engine decides which of
 * its tools go through `run`; this only knows where they go.
 */
export const remoteToolEnvironment = (options: {
  /** The Stella conversation. */
  conversationId: string;
  /** This computer: naming it brings tools back here. */
  deviceId?: string;
  remote?: DesktopExecutionRemote;
  report(error: unknown): void;
}) => {
  const { conversationId, remote } = options;
  const idle = new Map<string, ReturnType<typeof setTimeout>>();
  const scopeOf = (owner: string) => `${options.deviceId ?? "desktop"}:${owner}`;

  const releaseScope = async (scope: string) => {
    const timer = idle.get(scope);
    if (timer) clearTimeout(timer);
    idle.delete(scope);
    await remote?.releaseCloud(scope);
  };

  const touch = (scope: string) => {
    const previous = idle.get(scope);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      if (idle.get(scope) !== timer) return;
      void releaseScope(scope).catch((error: unknown) => options.report(error));
    }, CLOUD_IDLE_MS);
    timer.unref?.();
    idle.set(scope, timer);
  };

  /** One call where the tools run now; a failure comes back as the call's error, an abort as a throw. */
  const run = async (
    placement: Exclude<StellaPlacement, { kind: "local" }>,
    call: RemoteToolCall,
    signal?: AbortSignal,
  ): Promise<DeviceToolResult> => {
    if (!remote) return failed("Sign in to Stella to run tools away from this computer.");
    const deadlineMs = callDeadlineMs(placement, call);
    const deadline = AbortSignal.timeout(deadlineMs);
    const callSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    if (placement.kind === "cloud") {
      const scope = scopeOf(call.owner);
      touch(scope);
      try {
        return await remote.cloudTool(
          {
            scope,
            threadId: call.threadId ?? "stella",
            callId: call.callId,
            toolName: call.toolName,
            params: call.params,
          },
          callSignal,
        );
      } catch (error) {
        if (signal?.aborted) throw error;
        if (deadline.aborted) return unanswered("The cloud workspace", call, deadlineMs);
        return failed(
          `The cloud workspace did not run it: ${error instanceof Error ? error.message : String(error)} Try again, or switch_destination back to this computer.`,
        );
      } finally {
        touch(scope);
      }
    }
    const name = placement.label || placement.deviceId;
    // The same call is the same request on every attempt, so a rerun joins it there.
    const requestId = `pt:${createHash("sha256").update(`${conversationId}:${call.owner}:${call.callId}`).digest("hex")}`;
    let outcome: DeviceToolOutcome;
    try {
      outcome = await remote.deviceTool(
        placement.deviceId,
        requestId,
        {
          kind: "tool",
          toolName: call.toolName,
          params: call.params,
          callId: call.callId,
          conversationId,
          ...(call.threadId ? { threadId: call.threadId } : {}),
        },
        callSignal,
      );
    } catch (error) {
      if (signal?.aborted) throw error;
      if (deadline.aborted) return unanswered(name, call, deadlineMs);
      outcome = { ok: false, code: "failed", message: error instanceof Error ? error.message : String(error) };
    }
    if (!outcome.ok) {
      const unreachable = outcome.code === "device_offline" || outcome.code === "not_ready" || outcome.code === "not_enabled";
      return failed(
        `${outcome.message.replace(/^That computer/u, name)}${
          unreachable
            ? ` Your tools are set to run on ${name}. Tell the user, wait for it, or switch_destination back to this computer and carry on here.`
            : ""
        }`,
      );
    }
    if (!("result" in outcome)) return failed(`${name} sent no result.`);
    return outcome.result;
  };

  /**
   * Whether `target` can run tools now, and what an agent is told about it
   * (a computer's name and home, from asking it); else why not. This
   * computer, by "local" or its own device id, is `{ kind: "local" }`.
   */
  const prepare = async (target: StellaPlacement): Promise<{ placement: StellaPlacement } | { error: string }> => {
    if (target.kind === "local" || (target.kind === "device" && target.deviceId === options.deviceId)) {
      return { placement: { kind: "local" } };
    }
    if (!remote) return { error: "Sign in to Stella to run tools away from this computer." };
    if (target.kind === "cloud") return { placement: { kind: "cloud" } };
    const listed = await remote.devices().catch(() => undefined);
    if (!listed) return { error: "Couldn't read the connected devices list right now. Try again in a moment." };
    const device = findDeviceDestination(listed, target.deviceId);
    if (!device) {
      return {
        error: `No connected device has the device_id or name ${target.deviceId}. Use a device_id from the connected devices list, "cloud", or "local" for this computer.`,
      };
    }
    if (device.deviceId === options.deviceId) return { placement: { kind: "local" } };
    const name = device.label?.trim() || device.deviceId;
    const refusal = deviceRefusal(device, name);
    if (refusal) return { error: refusal };
    const described = await remote
      .deviceTool(device.deviceId, `describe:${crypto.randomUUID()}`, { kind: "describe" })
      .catch((error: unknown) => ({ ok: false as const, code: "failed" as const, message: error instanceof Error ? error.message : String(error) }));
    if (!described.ok) return { error: `${name} could not take tool calls: ${described.message.replace(/^That computer/u, "it")}` };
    if (!("description" in described)) return { error: `${name} did not describe itself.` };
    const { home, hostname, platform } = described.description;
    return {
      placement: {
        kind: "device",
        deviceId: device.deviceId,
        label: name,
        home,
        ...(hostname ? { hostname } : {}),
        ...(platform ? { platform } : {}),
      },
    };
  };

  const standing = async (deviceId: string): Promise<DeviceStanding | undefined> => {
    if (!remote) return undefined;
    const listed = await remote.devices().catch(() => undefined);
    const device = listed?.find((entry) => entry.deviceId === deviceId);
    return device ? deviceStanding(device) : undefined;
  };

  return {
    remote,
    prepare,
    standing,
    run,
    /** `owner`'s tools left `from`: a cloud container's work is saved into the world and let go. */
    async moved(owner: string, from: StellaPlacement): Promise<void> {
      if (from.kind === "cloud") await releaseScope(scopeOf(owner)).catch((error: unknown) => options.report(error));
    },
    /** Let every container this conversation holds go. */
    async close(): Promise<void> {
      await Promise.all([...idle.keys()].map((scope) => releaseScope(scope).catch(() => undefined)));
    },
  };
};

export type RemoteToolEnvironment = ReturnType<typeof remoteToolEnvironment>;
