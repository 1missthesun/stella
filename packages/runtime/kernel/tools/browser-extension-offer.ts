/**
 * Legacy exec compatibility path for the inline "connect the Stella browser
 * extension" offer. Production browser actions use the persistent browser API
 * service from `node_repl`.
 *
 * The extension is optional: Stella's in-app browser works without it, and the
 * extension is how agents work in the user's own browser with their logins
 * (the external backend). Nothing is copied between the two browsers. When legacy command output reports that the
 * extension is not connected, the exec tool asks the desktop to render an
 * inline connect card, waits for the user to connect or decline, and retries
 * the intercepted operation once on success.
 *
 * The whole path is best-effort and conservative:
 * - only completed (non-running) legacy browser commands are considered;
 *   the failure means the command never reached a browser, so a single
 *   re-run is safe;
 * - one offer at a time, with a decline cool-down so a burst of failing
 *   commands can't spam the user with cards;
 * - any bridge/host error falls back to returning the original result.
 */

import { Effect } from "effect";
import type { ToolResult } from "./types.js";
import { runToolEffect } from "./effect-runtime.js";

export type BrowserExtensionConnectOutcome =
  | { ok: true; status: "connected" | "already_connected" }
  | {
      ok: false;
      reason: "declined" | "cancelled" | "timeout" | "unsupported" | string;
    };

export type BrowserExtensionConnectRequester = (
  payload: {
    conversationId?: string;
    agentId?: string;
    /** The failing command, for context in logs — never rendered verbatim. */
    command?: string;
  },
  /**
   * Turn abort signal. The worker-side implementation cancels the
   * pending desktop card when it fires.
   */
  signal?: AbortSignal,
) => Promise<BrowserExtensionConnectOutcome>;

/**
 * Legacy extension-bridge failure strings retained for this compatibility
 * path. Production browser-service connection handling lives outside this
 * exec-command adapter.
 */
const EXTENSION_FAILURE_PATTERN =
  /Extension not connected|Install the Stella Browser Bridge extension/i;

/**
 * "Service worker terminated" has its own transient error + retry hint and
 * must NOT trigger an install offer — the extension is installed and will
 * self-reconnect.
 */
const TRANSIENT_EXTENSION_PATTERN =
  /Extension connection is dead|will auto-reconnect/i;

const STELLA_BROWSER_COMMAND_PATTERN = /(^|[\s;|&("'`])stella-browser(\s|$)/;

/** How long the exec tool is willing to sit on an open connect card. */
const OFFER_WAIT_TIMEOUT_MS = 5 * 60 * 1000;

/** After a decline/timeout, don't re-offer for this long. */
const DECLINE_COOLDOWN_MS = 15 * 60 * 1000;

type OfferGateState = {
  /** Millis timestamp of the last decline/timeout outcome. */
  lastRefusedAt: number | null;
  /** An offer card is currently open. */
  inFlight: boolean;
};

const gate: OfferGateState = { lastRefusedAt: null, inFlight: false };

export const isBrowserExtensionFailure = (
  command: string,
  payload: { running?: unknown; output?: unknown } | undefined,
): boolean => {
  if (!payload || payload.running === true) return false;
  if (!STELLA_BROWSER_COMMAND_PATTERN.test(command)) return false;
  const output = typeof payload.output === "string" ? payload.output : "";
  if (!EXTENSION_FAILURE_PATTERN.test(output)) return false;
  if (TRANSIENT_EXTENSION_PATTERN.test(output)) return false;
  return true;
};

const execPayloadOf = (
  result: ToolResult,
):
  | (Record<string, unknown> & { running?: unknown; output?: unknown })
  | null => {
  const payload = result.result;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  if (typeof payload !== "string") return null;
  const details =
    result.details &&
    typeof result.details === "object" &&
    !Array.isArray(result.details)
      ? (result.details as Record<string, unknown>)
      : {};
  return { ...details, output: payload };
};

const annotate = (result: ToolResult, note: string): ToolResult => {
  const payload = execPayloadOf(result);
  if (!payload) return result;
  const details =
    result.details &&
    typeof result.details === "object" &&
    !Array.isArray(result.details)
      ? { ...(result.details as Record<string, unknown>) }
      : {};
  delete details.output;
  if (typeof result.result === "string") {
    return {
      ...result,
      result: `${result.result}\nNote: ${note}`,
      details: { ...details, note },
    };
  }
  return {
    ...result,
    result: { ...payload, note },
    details: { ...details, note },
  };
};

const withTimeout = async (
  promise: Promise<BrowserExtensionConnectOutcome>,
  timeoutMs: number,
): Promise<BrowserExtensionConnectOutcome> =>
  // Effect race: the timeout arm is a fiber interrupted when the connect
  // promise settles first (the old `clearTimeout` in `finally`); a
  // rejection propagates the original error via the runtime facade.
  runToolEffect(
    Effect.raceFirst(
      Effect.tryPromise({ try: () => promise, catch: (error) => error }),
      Effect.sleep(timeoutMs).pipe(
        Effect.as<BrowserExtensionConnectOutcome>({
          ok: false,
          reason: "timeout",
        }),
      ),
    ),
  );

/**
 * Shared low-level offer path for direct browser transports that do not return
 * an Bash-shaped ToolResult. Returns null when the failure is unrelated
 * to a missing extension and otherwise returns the connect-card outcome.
 */
export const maybeRequestBrowserExtensionConnect = async (options: {
  output: string;
  command?: string;
  requestConnect?: BrowserExtensionConnectRequester;
  conversationId?: string;
  agentId?: string;
  signal?: AbortSignal;
  now?: () => number;
}): Promise<BrowserExtensionConnectOutcome | null> => {
  const command = options.command ?? "stella-browser";
  const now = options.now ?? Date.now;
  if (!options.requestConnect || options.signal?.aborted) return null;
  if (
    !isBrowserExtensionFailure(command, {
      running: false,
      output: options.output,
    })
  ) {
    return null;
  }
  if (gate.inFlight) return { ok: false, reason: "already_in_flight" };
  if (
    gate.lastRefusedAt !== null &&
    now() - gate.lastRefusedAt < DECLINE_COOLDOWN_MS
  ) {
    return { ok: false, reason: "cooldown" };
  }

  gate.inFlight = true;
  let outcome: BrowserExtensionConnectOutcome;
  try {
    outcome = await withTimeout(
      options.requestConnect(
        {
          ...(options.conversationId
            ? { conversationId: options.conversationId }
            : {}),
          ...(options.agentId ? { agentId: options.agentId } : {}),
          command,
        },
        options.signal,
      ),
      OFFER_WAIT_TIMEOUT_MS,
    );
  } catch (error) {
    outcome = {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    gate.inFlight = false;
  }
  if (
    !outcome.ok &&
    (outcome.reason === "declined" || outcome.reason === "timeout")
  ) {
    gate.lastRefusedAt = now();
  }
  return outcome;
};

/**
 * Wrap a completed legacy `Bash` browser result: on an extension-
 * bridge failure, offer the inline connect card and retry the intercepted
 * operation once after the user connects. Returns either the annotated
 * original result or the retried result.
 */
export const maybeOfferBrowserExtensionConnect = async (options: {
  result: ToolResult;
  command: string;
  requestConnect?: BrowserExtensionConnectRequester;
  rerun: () => Promise<ToolResult>;
  conversationId?: string;
  agentId?: string;
  signal?: AbortSignal;
  /** Injectable clock for tests. */
  now?: () => number;
}): Promise<ToolResult> => {
  const {
    result,
    command,
    requestConnect,
    rerun,
    conversationId,
    agentId,
    signal,
  } = options;
  const now = options.now ?? Date.now;
  if (!requestConnect) return result;
  if (signal?.aborted) return result;
  const payload = execPayloadOf(result);
  if (!payload || !isBrowserExtensionFailure(command, payload)) return result;

  if (gate.inFlight) {
    return annotate(
      result,
      "The Stella browser extension is not connected and a connect card is already open in the chat. The extension lets agents work in the user's own browser with their logins; Stella's in-app browser works without it. Continue in the in-app browser (it has only the logins made in it), and wait for the user's response only for steps that need a site they are signed in to.",
    );
  }
  if (
    gate.lastRefusedAt !== null &&
    now() - gate.lastRefusedAt < DECLINE_COOLDOWN_MS
  ) {
    return annotate(
      result,
      "The Stella browser extension is not connected and the user recently declined (or ignored) the connect offer. Do not re-offer or switch to a visible Chrome/Brave browser. Stella's in-app browser still works without it (pages open signed out): continue there. For steps that need the user's own login, ask them to sign in once in Stella's Browser panel (Stella keeps that sign-in) instead of parking.",
    );
  }

  gate.inFlight = true;
  let outcome: BrowserExtensionConnectOutcome;
  try {
    outcome = await withTimeout(
      requestConnect(
        {
          ...(conversationId ? { conversationId } : {}),
          ...(agentId ? { agentId } : {}),
          command,
        },
        signal,
      ),
      OFFER_WAIT_TIMEOUT_MS,
    );
  } catch (error) {
    outcome = { ok: false, reason: (error as Error).message || "bridge_error" };
  } finally {
    gate.inFlight = false;
  }

  if (signal?.aborted) return result;

  if (!outcome.ok) {
    if (outcome.reason === "declined" || outcome.reason === "timeout") {
      gate.lastRefusedAt = now();
      return annotate(
        result,
        outcome.reason === "declined"
          ? "A connect card for the Stella browser extension was shown in the chat and the user declined. Acknowledge once at most (it stays available in the Store/settings) and do not re-offer or switch to a visible Chrome/Brave browser. Stella's in-app browser works without the extension (signed out): continue there. For steps that need the user's own login, ask them to sign in once in Stella's Browser panel (Stella keeps that sign-in)."
          : "A connect card for the Stella browser extension was shown in the chat but the user did not respond in time. Do not re-offer or switch to a visible Chrome/Brave browser. Stella's in-app browser works without the extension (signed out): continue there. For steps that need the user's own login, ask them to sign in once in Stella's Browser panel (Stella keeps that sign-in).",
      );
    }
    // unsupported / bridge error: stay quiet, just return the raw failure.
    return result;
  }

  const retried = await rerun();
  if (isBrowserExtensionFailure(command, execPayloadOf(retried) ?? undefined)) {
    // The user accepted but the bridge still isn't up (extension disabled,
    // browser closed, install still settling). Don't loop offers.
    gate.lastRefusedAt = now();
    return annotate(
      retried,
      "The user accepted the browser-extension connect card, but the browser service still cannot reach the extension (the browser may be closed or the extension disabled). Do not re-offer or switch to a visible Chrome/Brave browser. Stella's in-app browser works without the extension (signed out): continue there. For steps that need the user's own login, ask them to sign in once in Stella's Browser panel (Stella keeps that sign-in), and report the exact browser error from the retry.",
    );
  }
  return annotate(
    retried,
    "The user connected the Stella browser extension via the inline card and the intercepted browser operation was re-run automatically above. Continue the original task.",
  );
};
