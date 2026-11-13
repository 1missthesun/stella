import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { Deferred, Effect } from "effect";

import { acquireAbortLatch } from "../agent-core/abort-bridge.js";
import {
  COMPUTER_USE_PROTOCOL_VERSION,
  COMPUTER_USE_SCHEMA_VERSION,
  assertComputerUseRequest,
  type ComputerUseActionCommand,
  type ComputerUseActionReceipt,
  type ComputerUseAppState,
  type ComputerUseInputDelivery,
  type ComputerUsePoint,
  type ComputerUseRequest,
  type ComputerUseResponse,
  type ComputerUseTarget,
  type ComputerUseWaitProvenance,
  type JsonObject,
} from "./contract.js";
import { runComputerUseEffect } from "./effect-runtime.js";
import { decodePng, type DecodedPng } from "../shared/png-decode.js";
import type { ComputerUseSession } from "./session.js";
import {
  ComputerUseResourceArbiter,
  ComputerUseResourceStaleError,
} from "./resource-arbiter.js";
import {
  computeStateDiff,
  formatStateDiffBlock,
  shouldUseDiffOnly,
} from "../cli/stella-computer-state-diff.js";
import {
  formatWindowsWindowList,
  lookupWindowsComputerElement,
  readWindowsComputerSnapshot,
  rememberWindowsComputerSnapshot,
  requestWindowsComputerHelper,
  windowsComputerScreenshotPath,
  windowsComputerSnapshotLines,
  withWindowsComputerSessionLock,
  type WinHelperAtomicCommand,
  type WinHelperObservationPrecondition,
  type WinHelperRequest,
  type WinHelperResponse,
  type WinSnapshot,
} from "../cli/stella-computer-windows.js";

export type WindowsComputerHelperRequest = (
  sessionId: string,
  request: WindowsComputerHelperOperation,
  signal?: AbortSignal,
) => Promise<WinHelperResponse>;

export type WindowsComputerHelperBatchRequest = Readonly<{
  tool: "atomic_batch";
  commands: readonly WinHelperAtomicCommand[];
}>;

export type WindowsComputerHelperAtomicActionRequest = Readonly<{
  tool: "atomic_action";
  command: WinHelperRequest;
  precondition: WinHelperObservationPrecondition;
}>;

export type WindowsComputerHelperOperation =
  | WinHelperRequest
  | WindowsComputerHelperAtomicActionRequest
  | WindowsComputerHelperBatchRequest;

type WindowsComputerHelperBatchResult = Readonly<{
  index: number;
  ok: boolean;
  result?: WinHelperResponse;
  error?: string;
  code?: string;
}>;

type WindowsComputerHelperBatchResponse = WinHelperResponse &
  Readonly<{
    completed?: number;
    results?: WindowsComputerHelperBatchResult[];
  }>;

export type WindowsComputerUseSessionOptions = Readonly<{
  requestHelper?: WindowsComputerHelperRequest;
  resourceArbiter?: ComputerUseResourceArbiter;
}>;

export const windowsComputerUseResourceArbiter =
  new ComputerUseResourceArbiter();

const responseEnvelope = (request: ComputerUseRequest) => ({
  schemaVersion: COMPUTER_USE_SCHEMA_VERSION,
  protocolVersion: COMPUTER_USE_PROTOCOL_VERSION,
  requestId: request.requestId,
  sessionId: request.sessionId,
});

const errorResponse = (
  request: ComputerUseRequest,
  code: string,
  message: string,
  retryable = false,
  details?: JsonObject,
): Extract<ComputerUseResponse, { type: "error" }> => ({
  ...responseEnvelope(request),
  type: "error",
  error: { code, message, retryable, ...(details ? { details } : {}) },
});

class WindowsComputerWaitTimeoutError extends Error {
  readonly code = "wait_timeout";
  readonly retryable = true;

  constructor(
    readonly timeoutMs: number,
    readonly elapsedMs: number,
    readonly pollCount: number,
    readonly afterStateId: string,
    readonly afterVisualStateId?: string,
  ) {
    super(
      `Windows app state did not change within ${timeoutMs}ms (after_state_id=${afterStateId}, polls=${pollCount}).`,
    );
    this.name = "WindowsComputerWaitTimeoutError";
  }
}

const computerUseWaitAbortReason = (signal: AbortSignal | undefined) =>
  signal?.reason ?? new Error("Computer-use wait aborted.");

const abortableDelay = (
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> =>
  runComputerUseEffect(
    Effect.scoped(
      Effect.gen(function* () {
        if (signal?.aborted) {
          return yield* Effect.fail(computerUseWaitAbortReason(signal));
        }
        if (!signal) {
          return yield* Effect.sleep(milliseconds);
        }
        const abortLatch = yield* acquireAbortLatch(signal);
        yield* Effect.raceFirst(
          Effect.sleep(milliseconds),
          Deferred.await(abortLatch).pipe(
            Effect.flatMap(() =>
              Effect.fail(computerUseWaitAbortReason(signal)),
            ),
          ),
        );
      }),
    ),
  );

const windowIdNumber = (
  target: Extract<ComputerUseTarget, { type: "window" }>,
) => {
  const parsed = Number(target.windowId.trim().replace(/^hwnd:/i, ""));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid Windows window ID: ${target.windowId}`);
  }
  return Math.trunc(parsed);
};

const targetDetails = (target: ComputerUseTarget) => {
  if (target.type === "app") {
    return { app: target.app, snapshotAlias: target.app };
  }
  const windowId = windowIdNumber(target);
  return {
    app: target.app ?? `hwnd:${windowId}`,
    windowId,
    snapshotAlias: `hwnd:${windowId}`,
  };
};

const isCoordinateAction = (command: ComputerUseActionCommand) =>
  command.action.type === "click_point" || command.action.type === "drag";

const actionPoints = (
  command: ComputerUseActionCommand,
): readonly ComputerUsePoint[] => {
  const action = command.action;
  if (action.type === "click_point") return [action.point];
  if (action.type === "drag") return [action.from, action.to];
  return [];
};

/** A pixel counts as changed when any channel moved by more than this. */
const PIXEL_CHANGE_THRESHOLD = 48;
/** Share of changed pixels around a point that means "something else is there now". */
const POINT_AREA_CHANGE_LIMIT = 0.4;
/** Share of changed pixels in the whole window that means "a different screen". */
const WINDOW_CHANGE_LIMIT = 0.75;

const changedPixelShare = (
  before: DecodedPng,
  after: DecodedPng,
  left: number,
  top: number,
  right: number,
  bottom: number,
  step: number,
) => {
  let total = 0;
  let changed = 0;
  for (let y = top; y < bottom; y += step) {
    for (let x = left; x < right; x += step) {
      const offset = (y * before.width + x) * 4;
      total += 1;
      if (
        Math.abs(before.rgba[offset]! - after.rgba[offset]!) >
          PIXEL_CHANGE_THRESHOLD ||
        Math.abs(before.rgba[offset + 1]! - after.rgba[offset + 1]!) >
          PIXEL_CHANGE_THRESHOLD ||
        Math.abs(before.rgba[offset + 2]! - after.rgba[offset + 2]!) >
          PIXEL_CHANGE_THRESHOLD
      ) {
        changed += 1;
      }
    }
  }
  return total === 0 ? 0 : changed / total;
};

/**
 * Whether a screenshot-coordinate action may still go ahead: the pixels
 * around each of its points and most of the window must look the same as in
 * the observation. Small animations (a spinner, a pulsing button, a ticking
 * timer) pass; a dialog over the point or a different screen does not.
 */
const coordinatePixelChange = (
  observed: DecodedPng,
  current: DecodedPng,
  points: readonly ComputerUsePoint[],
): string | null => {
  if (
    observed.width !== current.width ||
    observed.height !== current.height
  ) {
    return `the screenshot size changed from ${observed.width}x${observed.height} to ${current.width}x${current.height}`;
  }
  const radius = Math.max(
    12,
    Math.round(Math.max(observed.width, observed.height) * 0.035),
  );
  for (const point of points) {
    const x = Math.round(point.x);
    const y = Math.round(point.y);
    if (x < 0 || y < 0 || x >= observed.width || y >= observed.height) {
      return `the point (${x}, ${y}) is outside the ${observed.width}x${observed.height} screenshot`;
    }
    const share = changedPixelShare(
      observed,
      current,
      Math.max(0, x - radius),
      Math.max(0, y - radius),
      Math.min(observed.width, x + radius + 1),
      Math.min(observed.height, y + radius + 1),
      1,
    );
    if (share > POINT_AREA_CHANGE_LIMIT) {
      return `the area around (${x}, ${y}) changed (${Math.round(share * 100)}% of its pixels)`;
    }
  }
  const windowShare = changedPixelShare(
    observed,
    current,
    0,
    0,
    observed.width,
    observed.height,
    4,
  );
  if (windowShare > WINDOW_CHANGE_LIMIT) {
    return `most of the window changed (${Math.round(windowShare * 100)}% of its pixels)`;
  }
  return null;
};

const COORDINATE_STALE_HINT =
  'Take a fresh get_app_state with screenshot_policy: "always" and pick the point again from that screenshot. If this window never stops animating (a game, a video, a live background), pass stale_check: "window" on the click or drag: Stella then only checks that it is still the same window at the same size.';

const decodeSnapshotScreenshot = (snapshot: WinSnapshot) => {
  if (!snapshot.screenshotPngBase64) return null;
  try {
    return decodePng(Buffer.from(snapshot.screenshotPngBase64, "base64"));
  } catch {
    return null;
  }
};

/** Helper error codes that mean input was refused or not delivered. */
const WINDOWS_INPUT_ERROR_CODES = new Set([
  "background_unavailable",
  "foreground_refused",
  "input_desktop_unavailable",
  "input_partially_injected",
  "input_refused",
  "point_covered",
  "pointer_not_moved",
  "target_not_responding",
  "target_window_gone",
  "uipi_blocked",
]);

class WindowsInputError extends Error {
  readonly retryable = false;

  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WindowsInputError";
  }
}

const BACKGROUND_UNAVAILABLE_OPTIONS =
  'Nothing was sent and Stella did not take over the screen. What you can do: act on an element instead (click, scroll, set_value or perform_secondary_action with an element_index go through UI Automation, which works in the background), use set_value to fill a text field, or tell the user what you could not do. Only if the user asked Stella to take over the screen for this task, retry with delivery: "foreground": the window comes to the front for the action, then the user gets their window and pointer back.';

// Helpers without coded errors send the code as a "code: message" prefix.
// What the agent may do next is the runtime's to say, not the helper's.
const codedHelperError = (response: WinHelperResponse, fallback: string) => {
  let code = response.code;
  let message = response.error?.trim() || fallback;
  const prefixed = /^([a-z_]+):\s*(.*)$/s.exec(message);
  if (!code && prefixed && WINDOWS_INPUT_ERROR_CODES.has(prefixed[1]!)) {
    code = prefixed[1];
    message = prefixed[2]!.trim();
  }
  if (code === "background_unavailable") {
    message = `${message
      .replace(/;?\s*(nothing was sent;?\s*)?retry with[^.]*\.?/gi, ".")
      .replace(/\.\.$/, ".")
      .trim()} ${BACKGROUND_UNAVAILABLE_OPTIONS}`;
  }
  return { code, message };
};

const helperActionError = (response: WinHelperResponse, fallback: string) => {
  const { code, message } = codedHelperError(response, fallback);
  return code && WINDOWS_INPUT_ERROR_CODES.has(code)
    ? new WindowsInputError(code, message)
    : new Error(message);
};

const requireSnapshot = (sessionId: string, target: ComputerUseTarget) => {
  const details = targetDetails(target);
  const snapshot = readWindowsComputerSnapshot(
    sessionId,
    details.snapshotAlias,
  );
  if (!snapshot) {
    throw new Error(
      `No app state is available for ${details.snapshotAlias}. Call get_app_state before sending actions.`,
    );
  }
  return { details, snapshot };
};

const actionOperation = (
  sessionId: string,
  command: ComputerUseActionCommand,
  options: {
    dispatch: ComputerUseInputDelivery;
    liveSnapshot?: WinSnapshot;
  },
): WinHelperRequest => {
  const { details, snapshot } = requireSnapshot(sessionId, command.target);
  if (isCoordinateAction(command)) {
    // Coordinates are read against the screenshot of the latest observation,
    // so the action must come from that observation, not an earlier one.
    const latestVisualStateId = windowsVisualStateId(snapshot);
    if (
      command.observedVisualStateId &&
      latestVisualStateId !== command.observedVisualStateId
    ) {
      throw new ComputerUseResourceStaleError(
        command.observedVisualStateId,
        latestVisualStateId ?? "visual_state_unavailable",
        {
          nativeReason: "a newer observation of this window exists",
          hint: "Use the observation_id and coordinates from the latest get_app_state of this window.",
        },
      );
    }
  } else if (command.observedStateId) {
    const currentStateId = windowsSnapshotStateId(snapshot);
    if (currentStateId !== command.observedStateId) {
      throw new ComputerUseResourceStaleError(
        command.observedStateId,
        currentStateId,
      );
    }
  }
  const shared = {
    app: details.app,
    windowId: details.windowId ?? snapshot.windowId,
    // Window-relative coordinates follow the window if it moved since the
    // observation; the live check already refused a resized window.
    windowBounds:
      options.liveSnapshot?.windowBounds ?? snapshot.windowBounds ?? null,
    dispatch: options.dispatch,
    defer_observation: true,
    screenshot_policy: "auto" as const,
  };
  const action = command.action;
  switch (action.type) {
    case "click_element":
      return {
        ...shared,
        tool: "click",
        element: lookupWindowsComputerElement(snapshot, action.elementId),
        mouse_button: action.mouseButton,
        click_count: action.clickCount,
      };
    case "click_point":
      return {
        ...shared,
        tool: "click",
        x: action.point.x,
        y: action.point.y,
        mouse_button: action.mouseButton,
        click_count: action.clickCount,
        screenshot_width: snapshot.screenshot?.widthPx ?? undefined,
        screenshot_height: snapshot.screenshot?.heightPx ?? undefined,
      };
    case "drag":
      return {
        ...shared,
        tool: "drag",
        from_x: action.from.x,
        from_y: action.from.y,
        to_x: action.to.x,
        to_y: action.to.y,
        screenshot_width: snapshot.screenshot?.widthPx ?? undefined,
        screenshot_height: snapshot.screenshot?.heightPx ?? undefined,
      };
    case "perform_secondary_action":
      return {
        ...shared,
        tool: "perform_secondary_action",
        element: lookupWindowsComputerElement(snapshot, action.elementId),
        action: action.action,
      };
    case "press_key":
      return { ...shared, tool: "press_key", key: action.key };
    case "scroll":
      return {
        ...shared,
        tool: "scroll",
        element: lookupWindowsComputerElement(snapshot, action.elementId),
        direction: action.direction,
        pages: action.pages,
      };
    case "select_text":
      return {
        ...shared,
        tool: "select_text",
        element: lookupWindowsComputerElement(snapshot, action.elementId),
        text: action.text,
        prefix: action.prefix,
        suffix: action.suffix,
        selection: action.selectionType,
      };
    case "set_value":
      return {
        ...shared,
        tool: "set_value",
        element: lookupWindowsComputerElement(snapshot, action.elementId),
        value: action.value,
      };
    case "type_text":
      return { ...shared, tool: "type_text", text: action.text };
  }
};

const observationPrecondition = (
  command: ComputerUseActionCommand,
  snapshot: WinSnapshot,
): WinHelperObservationPrecondition => {
  if (
    !Number.isSafeInteger(snapshot.revision) ||
    !Number.isSafeInteger(snapshot.materializedRevision)
  ) {
    throw new Error(
      "Windows runtime cannot dispatch atomically because the helper omitted revision provenance. Refresh state after updating the native helper.",
    );
  }
  return {
    state_id: command.observedStateId!,
    target_pid: snapshot.app.pid,
    ...(snapshot.windowId != null ? { window_id: snapshot.windowId } : {}),
    revision: snapshot.revision!,
    materialized_revision: snapshot.materializedRevision!,
    ...(isCoordinateAction(command) || command.staleCheck === "window"
      ? { scope: "window" as const }
      : {}),
  };
};

const jsonObject = (value: unknown): JsonObject =>
  JSON.parse(JSON.stringify(value)) as JsonObject;

const receiptDelivery = (response: WinHelperResponse) =>
  response.receipt?.delivery ??
  (response.receipt?.route?.startsWith("hwnd.postmessage.")
    ? "background"
    : response.receipt?.route?.startsWith("foreground.")
      ? "foreground"
      : undefined);

const actionReceipt = (
  command: ComputerUseActionCommand,
  response: WinHelperResponse,
): ComputerUseActionReceipt => {
  const deferred = response.deferred ?? true;
  return {
    type: "action",
    action: command.action.type,
    target: command.target,
    status: deferred ? "accepted" : "completed",
    deferred,
    details: jsonObject({
      receipt: response.receipt ?? null,
      revision: response.revision ?? null,
      deferred,
      delivery: receiptDelivery(response) ?? null,
    }),
  };
};

const windowsSemanticSnapshotLines = (snapshot: WinSnapshot) => {
  const lines = ["<app_state>"];
  const appRef = snapshot.app.bundleIdentifier || snapshot.app.name;
  lines.push(`App=${appRef} (pid ${snapshot.app.pid})`);
  lines.push(
    `Window: "${snapshot.windowTitle || snapshot.app.name}", App: ${snapshot.app.name}.`,
  );
  if (snapshot.windowBounds) {
    const bounds = snapshot.windowBounds;
    lines.push(
      `Window frame: x=${bounds.x}, y=${bounds.y}, width=${bounds.width}, height=${bounds.height}.`,
    );
  }
  lines.push(...(snapshot.treeLines ?? []));
  if (snapshot.selectedText) {
    lines.push("", `Selected text: [${snapshot.selectedText}]`);
  } else if (snapshot.focusedSummary) {
    lines.push("", `The focused UI element is ${snapshot.focusedSummary}.`);
  }
  lines.push("</app_state>");
  return lines;
};

const windowsVisualStateId = (snapshot: WinSnapshot): string | undefined =>
  snapshot.screenshotPngBase64
    ? `visual_${createHash("sha256")
        .update(snapshot.screenshotPngBase64)
        .digest("hex")
        .slice(0, 20)}`
    : undefined;

const windowsSnapshotDiff = (previous: WinSnapshot, current: WinSnapshot) =>
  computeStateDiff({
    previousLines: windowsSemanticSnapshotLines(previous),
    currentLines: windowsSemanticSnapshotLines(current),
    previousTarget: {
      appName: previous.app.name,
      bundleId: previous.app.bundleIdentifier ?? null,
      pid: previous.app.pid,
      windowTitle: previous.windowTitle ?? null,
      windowId: previous.windowId ?? null,
      nodeCount:
        previous.elements?.length ?? previous.treeLines?.length ?? null,
      lineCount: windowsSemanticSnapshotLines(previous).length,
    },
    currentTarget: {
      appName: current.app.name,
      bundleId: current.app.bundleIdentifier ?? null,
      pid: current.app.pid,
      windowTitle: current.windowTitle ?? null,
      windowId: current.windowId ?? null,
      nodeCount: current.elements?.length ?? current.treeLines?.length ?? null,
      lineCount: windowsSemanticSnapshotLines(current).length,
    },
  });

const snapshotState = (
  sessionId: string,
  requestedTarget: ComputerUseTarget,
  snapshot: WinSnapshot,
  options: {
    previous?: WinSnapshot | null;
    disableDiff?: boolean;
    wait?: ComputerUseWaitProvenance;
    notes?: readonly string[];
  } = {},
): ComputerUseAppState => {
  const canonicalApp =
    snapshot.app.bundleIdentifier?.trim() || snapshot.app.name.trim();
  const alias = targetDetails(requestedTarget).snapshotAlias;
  const screenshot = snapshot.screenshotPngBase64
    ? {
        type: "image" as const,
        url: pathToFileURL(windowsComputerScreenshotPath(sessionId, alias))
          .href,
        mimeType: "image/png",
        ...(snapshot.screenshot?.widthPx
          ? { width: Math.round(snapshot.screenshot.widthPx) }
          : {}),
        ...(snapshot.screenshot?.heightPx
          ? { height: Math.round(snapshot.screenshot.heightPx) }
          : {}),
      }
    : null;
  const diff = options.previous
    ? windowsSnapshotDiff(options.previous, snapshot)
    : null;
  const useDiff =
    options.disableDiff !== true && Boolean(diff && shouldUseDiffOnly(diff));
  const stateId = windowsSnapshotStateId(snapshot);
  const visualStateId = windowsVisualStateId(snapshot);
  const baseStateId =
    useDiff && options.previous
      ? windowsSnapshotStateId(options.previous)
      : undefined;
  const baseVisualStateId =
    useDiff && options.previous
      ? windowsVisualStateId(options.previous)
      : undefined;
  return {
    app: canonicalApp,
    text: [
      useDiff
        ? formatStateDiffBlock(diff!).trim()
        : windowsComputerSnapshotLines(snapshot).join("\n"),
      ...(options.notes ?? []).map((note) => `Note: ${note}`),
    ].join("\n"),
    stateId,
    semanticStateId: stateId,
    ...(visualStateId ? { visualStateId } : {}),
    ...(baseStateId ? { baseStateId } : {}),
    ...(baseVisualStateId ? { baseVisualStateId } : {}),
    representation: useDiff ? "diff" : "full",
    ...(options.wait ? { wait: options.wait } : {}),
    screenshot,
    ...(snapshot.appInstructions?.trim()
      ? { instructions: snapshot.appInstructions.trim() }
      : {}),
  };
};

const windowsSnapshotStateId = (snapshot: WinSnapshot): string =>
  `state_${createHash("sha256")
    .update(windowsSemanticSnapshotLines(snapshot).join("\n"))
    .digest("hex")
    .slice(0, 20)}`;

const helperFailure = (response: WinHelperResponse, fallback: string) =>
  response.error?.trim() || fallback;

const waitChangeKinds = (
  baseline: WinSnapshot,
  current: WinSnapshot,
  afterVisualStateId?: string,
): Array<"semantic" | "visual"> => {
  const kinds: Array<"semantic" | "visual"> = [];
  if (windowsSnapshotStateId(current) !== windowsSnapshotStateId(baseline)) {
    kinds.push("semantic");
  }
  if (
    afterVisualStateId &&
    windowsVisualStateId(current) !== afterVisualStateId
  ) {
    kinds.push("visual");
  }
  return kinds;
};

export const createWindowsComputerUseSession = (
  options: WindowsComputerUseSessionOptions = {},
): ComputerUseSession => {
  const resourceArbiter =
    options.resourceArbiter ?? windowsComputerUseResourceArbiter;
  const committedStateKeys = new Set<string>();
  const committedStateKey = (sessionId: string, alias: string) =>
    `${sessionId}\u0000${alias}`;
  // The state right before a background-delivered action, compared with the
  // next observation to tell whether the action had any effect.
  const backgroundProbes = new Map<
    string,
    { stateId: string; visualStateId: string; action: string }
  >();
  const deliveryFor = (
    command: ComputerUseActionCommand,
  ): ComputerUseInputDelivery => command.delivery ?? "background";
  const backgroundEffectNotes = (
    stateKey: string,
    snapshot: WinSnapshot,
  ): string[] => {
    const probe = backgroundProbes.get(stateKey);
    if (!probe) return [];
    backgroundProbes.delete(stateKey);
    if (
      windowsSnapshotStateId(snapshot) !== probe.stateId ||
      windowsVisualStateId(snapshot) !== probe.visualStateId
    ) {
      return [];
    }
    return [
      `The last ${probe.action} was delivered in the background and nothing in the window changed, so this window probably ignores background input there. Stella did not take over the screen and will not on its own. What you can do: act on an element instead (element_index actions go through UI Automation), use set_value for a text field, or tell the user what you could not do. Only if the user asked Stella to take over the screen for this task, repeat it with delivery: "foreground" (the window comes to the front for the action, then the user gets their window and pointer back).`,
    ];
  };
  const requestHelper =
    options.requestHelper ??
    ((sessionId, operation, signal) =>
      requestWindowsComputerHelper(
        sessionId,
        operation as WinHelperRequest,
        signal,
      ));

  const request: ComputerUseSession["request"] = async (
    typedRequest,
    requestOptions,
  ) => {
    assertComputerUseRequest(typedRequest);
    const signal = requestOptions?.signal;
    return await resourceArbiter.runRequest(
      typedRequest,
      signal,
      async () =>
        await withWindowsComputerSessionLock(
          typedRequest.sessionId,
          async () => {
            try {
              if (typedRequest.type === "list_apps") {
                const response = await requestHelper(
                  typedRequest.sessionId,
                  { tool: "list_apps" },
                  signal,
                );
                return response.ok
                  ? {
                      ...responseEnvelope(typedRequest),
                      type: "list_apps" as const,
                      text:
                        response.text?.trim() ||
                        "No running top-level apps are visible to this Windows runtime.",
                    }
                  : errorResponse(
                      typedRequest,
                      "windows_helper_failed",
                      helperFailure(
                        response,
                        "Windows runtime failed to list apps.",
                      ),
                    );
              }

              if (typedRequest.type === "list_windows") {
                const response = await requestHelper(
                  typedRequest.sessionId,
                  { tool: "list_windows" },
                  signal,
                );
                return response.ok
                  ? {
                      ...responseEnvelope(typedRequest),
                      type: "list_windows" as const,
                      text:
                        response.text?.trim() ||
                        formatWindowsWindowList(response.windows),
                    }
                  : errorResponse(
                      typedRequest,
                      "windows_helper_failed",
                      helperFailure(
                        response,
                        "Windows runtime failed to list windows.",
                      ),
                    );
              }

              if (typedRequest.type === "resolve_target") {
                const target = targetDetails(typedRequest.selector);
                const stateKey = committedStateKey(
                  typedRequest.sessionId,
                  target.snapshotAlias,
                );
                const response = await requestHelper(
                  typedRequest.sessionId,
                  {
                    tool: "get_app_state",
                    app: target.app,
                    windowId: target.windowId,
                    screenshot_policy: "never",
                  },
                  signal,
                );
                if (!response.ok || !response.snapshot) {
                  return errorResponse(
                    typedRequest,
                    "windows_target_resolution_failed",
                    helperFailure(
                      response,
                      `Windows runtime could not resolve ${target.snapshotAlias}.`,
                    ),
                  );
                }
                if (!committedStateKeys.has(stateKey)) {
                  rememberWindowsComputerSnapshot(
                    typedRequest.sessionId,
                    target.snapshotAlias,
                    response.snapshot,
                  );
                }
                const bundleIdentifier =
                  response.snapshot.app.bundleIdentifier?.trim() ||
                  response.snapshot.app.name.trim();
                return {
                  ...responseEnvelope(typedRequest),
                  type: "target_policy" as const,
                  policy: {
                    bundleIdentifier,
                    displayName: response.snapshot.app.name.trim(),
                    decision: "allowed" as const,
                    allowPersistentApproval: true,
                  },
                };
              }

              if (typedRequest.type === "get_app_state") {
                const target = targetDetails(typedRequest.target);
                const stateKey = committedStateKey(
                  typedRequest.sessionId,
                  target.snapshotAlias,
                );
                const previous = committedStateKeys.has(stateKey)
                  ? readWindowsComputerSnapshot(
                      typedRequest.sessionId,
                      target.snapshotAlias,
                    )
                  : null;
                const response = await requestHelper(
                  typedRequest.sessionId,
                  {
                    tool: "get_app_state",
                    app: target.app,
                    windowId: target.windowId,
                    screenshot_policy: typedRequest.screenshotPolicy,
                  },
                  signal,
                );
                if (!response.ok || !response.snapshot) {
                  return errorResponse(
                    typedRequest,
                    "windows_state_failed",
                    helperFailure(
                      response,
                      "Windows runtime did not return app state.",
                    ),
                  );
                }
                rememberWindowsComputerSnapshot(
                  typedRequest.sessionId,
                  target.snapshotAlias,
                  response.snapshot,
                );
                committedStateKeys.add(stateKey);
                const notes = backgroundEffectNotes(stateKey, response.snapshot);
                return {
                  ...responseEnvelope(typedRequest),
                  type: "app_state" as const,
                  state: snapshotState(
                    typedRequest.sessionId,
                    typedRequest.target,
                    response.snapshot,
                    {
                      previous,
                      disableDiff: typedRequest.disableDiff,
                      notes,
                    },
                  ),
                };
              }

              if (typedRequest.type === "wait_for_change") {
                const target = targetDetails(typedRequest.target);
                const stateKey = committedStateKey(
                  typedRequest.sessionId,
                  target.snapshotAlias,
                );
                const baseline = committedStateKeys.has(stateKey)
                  ? readWindowsComputerSnapshot(
                      typedRequest.sessionId,
                      target.snapshotAlias,
                    )
                  : null;
                if (!baseline) {
                  throw new Error(
                    `No baseline state is available for ${target.snapshotAlias}. Call get_app_state before wait_for_change.`,
                  );
                }
                const baselineStateId = windowsSnapshotStateId(baseline);
                if (baselineStateId !== typedRequest.afterStateId) {
                  throw new ComputerUseResourceStaleError(
                    typedRequest.afterStateId,
                    baselineStateId,
                  );
                }
                if (
                  typedRequest.afterVisualStateId &&
                  windowsVisualStateId(baseline) !==
                    typedRequest.afterVisualStateId
                ) {
                  throw new ComputerUseResourceStaleError(
                    typedRequest.afterVisualStateId,
                    windowsVisualStateId(baseline) ??
                      "visual_state_unavailable",
                  );
                }

                const startedAt = Date.now();
                let pollCount = 0;
                while (Date.now() - startedAt < typedRequest.timeoutMs) {
                  pollCount += 1;
                  const polled = await requestHelper(
                    typedRequest.sessionId,
                    {
                      tool: "get_app_state",
                      app: target.app,
                      windowId: target.windowId,
                      screenshot_policy: typedRequest.afterVisualStateId
                        ? "always"
                        : "never",
                    },
                    signal,
                  );
                  if (!polled.ok || !polled.snapshot) {
                    throw new Error(
                      helperFailure(
                        polled,
                        "Windows runtime did not return app state while waiting.",
                      ),
                    );
                  }
                  if (
                    waitChangeKinds(
                      baseline,
                      polled.snapshot,
                      typedRequest.afterVisualStateId,
                    ).length > 0
                  ) {
                    const finalResponse = await requestHelper(
                      typedRequest.sessionId,
                      {
                        tool: "get_app_state",
                        app: target.app,
                        windowId: target.windowId,
                        screenshot_policy:
                          typedRequest.afterVisualStateId &&
                          typedRequest.screenshotPolicy === "auto"
                            ? "always"
                            : typedRequest.screenshotPolicy,
                      },
                      signal,
                    );
                    if (!finalResponse.ok || !finalResponse.snapshot) {
                      throw new Error(
                        helperFailure(
                          finalResponse,
                          "Windows runtime did not return final app state after a change.",
                        ),
                      );
                    }
                    const changeKinds = waitChangeKinds(
                      baseline,
                      finalResponse.snapshot,
                      typedRequest.afterVisualStateId,
                    );
                    if (changeKinds.length > 0) {
                      rememberWindowsComputerSnapshot(
                        typedRequest.sessionId,
                        target.snapshotAlias,
                        finalResponse.snapshot,
                      );
                      committedStateKeys.add(stateKey);
                      const wait: ComputerUseWaitProvenance = {
                        afterStateId: typedRequest.afterStateId,
                        ...(typedRequest.afterVisualStateId
                          ? {
                              afterVisualStateId:
                                typedRequest.afterVisualStateId,
                            }
                          : {}),
                        timeoutMs: typedRequest.timeoutMs,
                        elapsedMs: Date.now() - startedAt,
                        pollCount,
                        changeKinds,
                      };
                      return {
                        ...responseEnvelope(typedRequest),
                        type: "wait_for_change" as const,
                        state: snapshotState(
                          typedRequest.sessionId,
                          typedRequest.target,
                          finalResponse.snapshot,
                          {
                            previous: baseline,
                            disableDiff: typedRequest.disableDiff,
                            wait,
                          },
                        ),
                      };
                    }
                  }
                  const remaining =
                    typedRequest.timeoutMs - (Date.now() - startedAt);
                  if (remaining > 0) {
                    await abortableDelay(Math.min(150, remaining), signal);
                  }
                }
                throw new WindowsComputerWaitTimeoutError(
                  typedRequest.timeoutMs,
                  Date.now() - startedAt,
                  pollCount,
                  typedRequest.afterStateId,
                  typedRequest.afterVisualStateId,
                );
              }

              const validateLiveState = async (
                command: ComputerUseActionCommand,
              ): Promise<WinSnapshot> => {
                const observedStateId = command.observedStateId;
                if (!observedStateId) {
                  throw new Error(
                    `${command.action.type} requires observedStateId before Windows dispatch.`,
                  );
                }
                const coordinates = isCoordinateAction(command);
                const windowOnly = command.staleCheck === "window";
                const target = targetDetails(command.target);
                const observed = readWindowsComputerSnapshot(
                  typedRequest.sessionId,
                  target.snapshotAlias,
                );
                const response = await requestHelper(
                  typedRequest.sessionId,
                  {
                    tool: "get_app_state",
                    app: target.app,
                    windowId: target.windowId,
                    screenshot_policy:
                      coordinates && !windowOnly ? "always" : "never",
                  },
                  signal,
                );
                if (!response.ok || !response.snapshot) {
                  throw new Error(
                    helperFailure(
                      response,
                      "Windows runtime could not validate current app state.",
                    ),
                  );
                }
                const live = response.snapshot;
                if (
                  observed &&
                  (observed.app.pid !== live.app.pid ||
                    (observed.windowId ?? null) !== (live.windowId ?? null))
                ) {
                  throw new ComputerUseResourceStaleError(
                    observedStateId,
                    windowsSnapshotStateId(live),
                    {
                      nativeReason: "the target window was replaced",
                      hint: "Call get_app_state again and act on the new window.",
                    },
                  );
                }
                if (!coordinates) {
                  if (windowOnly) return live;
                  const currentStateId = windowsSnapshotStateId(live);
                  if (currentStateId !== observedStateId) {
                    throw new ComputerUseResourceStaleError(
                      observedStateId,
                      currentStateId,
                    );
                  }
                  return live;
                }

                // Screenshot coordinates: the pixels are the evidence, not the
                // accessibility tree. The window must have the same size, and
                // unless the caller accepts any change, the same pixels around
                // the points.
                const observedBounds = observed?.windowBounds;
                const liveBounds = live.windowBounds;
                if (
                  observedBounds &&
                  liveBounds &&
                  (Math.abs(observedBounds.width - liveBounds.width) > 1 ||
                    Math.abs(observedBounds.height - liveBounds.height) > 1)
                ) {
                  throw new ComputerUseResourceStaleError(
                    command.observedVisualStateId ?? observedStateId,
                    windowsSnapshotStateId(live),
                    {
                      nativeReason: `the window was resized from ${Math.round(observedBounds.width)}x${Math.round(observedBounds.height)} to ${Math.round(liveBounds.width)}x${Math.round(liveBounds.height)}`,
                      hint: COORDINATE_STALE_HINT,
                    },
                  );
                }
                if (windowOnly) return live;
                if (!live.screenshotPngBase64) {
                  throw new Error(
                    `Stella could not take the screenshot needed to check the window before this ${command.action.type}: ${live.capture?.warning ?? live.warnings?.join(" ") ?? "Windows returned no pixels."} Pass stale_check: "window" to act on window-relative coordinates without that check.`,
                  );
                }
                const observedImage = observed
                  ? decodeSnapshotScreenshot(observed)
                  : null;
                const liveImage = decodeSnapshotScreenshot(live);
                if (!observedImage || !liveImage) {
                  // Unreadable pixels: fall back to the exact comparison.
                  if (
                    command.observedVisualStateId &&
                    windowsVisualStateId(live) !== command.observedVisualStateId
                  ) {
                    throw new ComputerUseResourceStaleError(
                      command.observedVisualStateId,
                      windowsVisualStateId(live) ?? "visual_state_unavailable",
                      { hint: COORDINATE_STALE_HINT },
                    );
                  }
                  return live;
                }
                const change = coordinatePixelChange(
                  observedImage,
                  liveImage,
                  actionPoints(command),
                );
                if (change) {
                  throw new ComputerUseResourceStaleError(
                    command.observedVisualStateId ?? observedStateId,
                    windowsVisualStateId(live) ?? "visual_state_unavailable",
                    { nativeReason: change, hint: COORDINATE_STALE_HINT },
                  );
                }
                return live;
              };

              const throwIfAtomicStateIsStale = (
                command: ComputerUseActionCommand,
                response: WinHelperResponse,
              ) => {
                if (response.code !== "stale_observation") return;
                throw new ComputerUseResourceStaleError(
                  response.observed_state_id ?? command.observedStateId!,
                  response.current_revision == null
                    ? "native_state_changed"
                    : `native_revision_${response.current_revision}`,
                );
              };

              const recordBackgroundProbe = (
                command: ComputerUseActionCommand,
                before: WinSnapshot,
                response: WinHelperResponse,
              ) => {
                const stateKey = committedStateKey(
                  typedRequest.sessionId,
                  targetDetails(command.target).snapshotAlias,
                );
                backgroundProbes.delete(stateKey);
                const visualStateId = windowsVisualStateId(before);
                if (receiptDelivery(response) !== "background" || !visualStateId) {
                  return;
                }
                backgroundProbes.set(stateKey, {
                  stateId: windowsSnapshotStateId(before),
                  visualStateId,
                  action:
                    command.action.type === "click_point"
                      ? "click"
                      : command.action.type.replaceAll("_", " "),
                });
              };

              const executeAction = async (
                command: ComputerUseActionCommand,
              ) => {
                const snapshot = await validateLiveState(command);
                const response = await requestHelper(
                  typedRequest.sessionId,
                  {
                    tool: "atomic_action",
                    command: actionOperation(typedRequest.sessionId, command, {
                      dispatch: deliveryFor(command),
                      liveSnapshot: snapshot,
                    }),
                    precondition: observationPrecondition(command, snapshot),
                  },
                  signal,
                );
                if (!response.ok) {
                  throwIfAtomicStateIsStale(command, response);
                  throw helperActionError(
                    response,
                    `Windows runtime failed to execute ${command.action.type}.`,
                  );
                }
                recordBackgroundProbe(command, snapshot, response);
                return actionReceipt(command, response);
              };

              if (typedRequest.type === "action") {
                return {
                  ...responseEnvelope(typedRequest),
                  type: "action" as const,
                  receipt: await executeAction(typedRequest.command),
                };
              }

              const snapshots: WinSnapshot[] = [];
              for (const command of typedRequest.commands) {
                snapshots.push(await validateLiveState(command));
              }
              const operations = typedRequest.commands.map(
                (command, index) => ({
                  command: actionOperation(typedRequest.sessionId, command, {
                    dispatch: deliveryFor(command),
                    liveSnapshot: snapshots[index]!,
                  }),
                  precondition: observationPrecondition(
                    command,
                    snapshots[index]!,
                  ),
                }),
              );
              const response = (await requestHelper(
                typedRequest.sessionId,
                { tool: "atomic_batch", commands: operations },
                signal,
              )) as WindowsComputerHelperBatchResponse;
              if (!response.ok && response.code === "stale_observation") {
                const command =
                  typedRequest.commands.find(
                    (candidate) =>
                      candidate.observedStateId === response.observed_state_id,
                  ) ?? typedRequest.commands[0]!;
                throwIfAtomicStateIsStale(command, response);
              }
              const results = response.results;
              if (!Array.isArray(results)) {
                throw new Error(
                  helperFailure(
                    response,
                    "Windows runtime returned an invalid batch response.",
                  ),
                );
              }
              const receipts = typedRequest.commands.map((command, index) => {
                const item = results[index];
                if (!item || item.index !== index) {
                  throw new Error(
                    `Windows runtime omitted batch result ${index}.`,
                  );
                }
                if (!item.ok || !item.result?.ok) {
                  throw helperActionError(
                    {
                      ok: false,
                      code: item.code ?? item.result?.code,
                      error: item.error?.trim() || item.result?.error?.trim(),
                    },
                    `Windows runtime failed batch command ${index} of ${typedRequest.commands.length}${index > 0 ? `; commands 0-${index - 1} were already delivered` : ""}.`,
                  );
                }
                return actionReceipt(command, item.result);
              });
              if (
                !response.ok ||
                response.completed !== typedRequest.commands.length ||
                results.length !== typedRequest.commands.length
              ) {
                throw new Error(
                  helperFailure(
                    response,
                    `Windows runtime completed ${response.completed ?? results.length} of ${typedRequest.commands.length} batch commands.`,
                  ),
                );
              }
              return {
                ...responseEnvelope(typedRequest),
                type: "batch" as const,
                receipt: { type: "batch" as const, receipts },
              };
            } catch (error) {
              const aborted =
                signal?.aborted ||
                (error instanceof Error && error.name === "AbortError");
              const stale = error instanceof ComputerUseResourceStaleError;
              const waitTimeout =
                error instanceof WindowsComputerWaitTimeoutError;
              const inputError = error instanceof WindowsInputError;
              return errorResponse(
                typedRequest,
                aborted
                  ? "request_aborted"
                  : stale
                    ? error.code
                    : waitTimeout
                      ? error.code
                      : inputError
                        ? error.code
                        : "windows_session_failed",
                error instanceof Error ? error.message : String(error),
                stale || waitTimeout,
                stale
                  ? jsonObject({
                      observed_state_id: error.observedStateId,
                      current_state_id: error.currentStateId,
                      resource_keys: error.resourceKeys ?? [],
                      observed_resource_generation:
                        error.observedResourceGeneration ?? null,
                      current_resource_generation:
                        error.currentResourceGeneration ?? null,
                    })
                  : waitTimeout
                    ? jsonObject({
                        after_state_id: error.afterStateId,
                        after_visual_state_id: error.afterVisualStateId ?? null,
                        timeout_ms: error.timeoutMs,
                        elapsed_ms: error.elapsedMs,
                        poll_count: error.pollCount,
                      })
                    : undefined,
              );
            }
          },
          signal,
        ),
    );
  };

  return Object.freeze({ request });
};
