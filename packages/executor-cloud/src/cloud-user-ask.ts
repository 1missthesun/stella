import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import {
  clampUrgency,
  clampUserAskTimeoutMs,
  normalizeUserAskDeclineReason,
  normalizeUserAskNote,
  savedValueLabel,
  USER_ASK_EXPIRED_NOTE,
  userAskDeclinedNote,
  userAskDefaultedResolution,
  userAskFieldIsRememberable,
  type SecureInputNotSaved,
  type UserAskAnswer,
  type UserAskDetail,
  type UserAskField,
  type UserAskResolution,
  type UserAskSavedValueNote,
  type UserAskSealedValue,
  type UserAskState,
} from "@stella/contracts/user-ask";
import type { SavedValueReleaseResult } from "@stella/contracts/saved-values";
import type { CloudBrowserBridge } from "@stella/runtime/kernel/tools/types.js";
import type {
  AskUserRequest,
  SecureInputRequest,
  SecureValueUseRequest,
  UserToolsConfig,
} from "@stella/runtime/kernel/tools/user.js";
import {
  useCloudSecureValue,
  type CloudSecureCommandScope,
  type CloudSecureValueStore,
} from "./cloud-secure-values.js";
import {
  createTaskRecipientKey,
  openSealedValue,
  type TaskRecipientKey,
} from "./user-ask-seal.js";

export const CLOUD_USER_ASK_PATH = "/api/cloud/user-ask";

const ANSWER_POLL_MS = 10_000;
const FIRST_POLL_MS = 1_500;
/** Backoff between tries of a request that failed for a passing reason. */
const RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000, 15_000];
/**
 * While waiting for the user, how long reads may keep failing for a passing
 * reason (a deploy, a dropped connection) before the question is given up.
 * The user may take hours to answer; one failed read must not end the ask.
 */
const ANSWER_OUTAGE_MAX_MS = 10 * 60_000;

/** A failure that says nothing about the ask itself: try again. */
class TransientAskError extends Error {}

const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export type CloudUserAskHost = {
  handlers: Required<Pick<UserToolsConfig, "askUser" | "requestSecureInput">> &
    Pick<UserToolsConfig, "useSecureValue">;
  cancelOpenAsks: (note: string) => Promise<void>;
};

type AnswerRead = {
  askId: string;
  state: UserAskState;
  revision: number;
  reason?: string;
  answer?: UserAskAnswer;
  late?: boolean;
  answeredAt?: number;
};

const sleep = (milliseconds: number): Promise<void> =>
  Effect.runPromise(Effect.sleep(milliseconds));


const answeredResolution = (
  askId: string,
  read: AnswerRead,
): UserAskResolution | null => {
  const answer = read.answer;
  if (!answer) return null;
  const answeredAt = read.answeredAt ?? Date.now();
  if (answer.kind === "questions") {
    return {
      outcome: "answered",
      askId,
      responses: answer.responses,
      answeredAt,
      ...(read.late ? { late: true } : {}),
    };
  }
  const values: Record<string, string> = {};
  for (const field of answer.fields) {
    if (field.kind === "plain") values[field.fieldId] = field.value;
  }
  const userNote = normalizeUserAskNote(answer.note);
  return {
    outcome: "answered",
    askId,
    ...(Object.keys(values).length > 0 ? { values } : {}),
    ...(userNote ? { userNote } : {}),
    answeredAt,
    ...(read.late ? { late: true } : {}),
  };
};

/** What a field's value became: text the task reads, or a handle held here. */
type Opened = {
  values: Record<string, string>;
  handles: Record<string, string>;
  asHandles: string[];
  freshUntil: number;
};

const emptyOpened = (): Opened => ({ values: {}, handles: {}, asHandles: [], freshUntil: 0 });

/** The fields a release asks for: what request_secure_input normalized, no more. */
const releaseFields = (fields: readonly UserAskField[]) =>
  fields.map((field) => ({
    id: field.id,
    label: field.label,
    type: field.type,
    sensitive: field.sensitive,
    ...(field.optional ? { optional: true } : {}),
  }));

/**
 * A masked field is never readable by a cloud task: the answering devices
 * seal only sensitive fields, and a value that reaches the cloud in plain
 * text is one the cloud could read.
 */
const cloudFields = (fields: readonly UserAskField[]): readonly UserAskField[] =>
  fields.map((field) =>
    field.type === "secret" && !field.sensitive ? { ...field, sensitive: true } : field,
  );

export const createCloudUserAskHost = (args: {
  post: (route: string, body: unknown) => Promise<Response>;
  turnId: string;
  conversationId: string;
  /** The thread the task runs for: its handles work only for it. */
  threadId: string;
  /** Holds the values this task is given; absent, sensitive fields are refused. */
  secureValues?: CloudSecureValueStore;
  /** Where use_secure_value runs a command. */
  commandScope?: CloudSecureCommandScope;
  /** The cloud browser use_secure_value fills. */
  browser?: CloudBrowserBridge;
}): CloudUserAskHost => {
  const openAsks = new Set<string>();
  let shutdownNote: string | null = null;

  const attempt = async (body: Record<string, unknown>): Promise<unknown> => {
    let response: Response;
    try {
      response = await args.post(CLOUD_USER_ASK_PATH, {
        turnId: args.turnId,
        ...body,
      });
    } catch (error) {
      throw new TransientAskError(
        `Stella's cloud could not be reached (${(error as Error).message || "connection failed"}).`,
      );
    }
    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      const message =
        detail?.error ?? `The ask could not be registered (${response.status}).`;
      throw TRANSIENT_STATUSES.has(response.status)
        ? new TransientAskError(message)
        : new Error(message);
    }
    try {
      return (await response.json()) as unknown;
    } catch (error) {
      throw new TransientAskError(
        `The reply from Stella's cloud was cut off (${(error as Error).message}).`,
      );
    }
  };

  // Every op is idempotent on the server (register by askId + toolCallId), so
  // a try that failed in passing is simply sent again.
  const request = async (body: Record<string, unknown>): Promise<unknown> => {
    for (let index = 0; ; index += 1) {
      try {
        return await attempt(body);
      } catch (error) {
        if (
          !(error instanceof TransientAskError) ||
          index >= RETRY_DELAYS_MS.length ||
          shutdownNote
        ) {
          throw error;
        }
        await sleep(RETRY_DELAYS_MS[index]!);
      }
    }
  };

  const cancel = async (askId: string): Promise<void> => {
    openAsks.delete(askId);
    await request({ op: "cancel", askId }).catch(() => undefined);
  };

  // Polled for as long as the user takes, so a read gets one try; the wait
  // loop decides how long a run of passing failures may last.
  const readAnswer = async (askId: string): Promise<AnswerRead> =>
    (await attempt({ op: "answer", askId })) as AnswerRead;

  const register = async (body: Record<string, unknown>): Promise<string> => {
    const askId = randomUUID();
    await request({
      op: "register",
      askId,
      conversationId: args.conversationId,
      ...body,
    });
    openAsks.add(askId);
    return askId;
  };

  const waitForAnswer = async (input: {
    askId: string;
    deadlineAt: number | null;
    onDefault: () => UserAskResolution;
    /** Turns an answer into the resolution (a secure input opens its sealed fields). */
    onAnswer?: (read: AnswerRead) => Promise<UserAskResolution>;
  }): Promise<UserAskResolution> => {
    let delay = FIRST_POLL_MS;
    let failingSince: number | null = null;
    let failures = 0;
    while (true) {
      if (shutdownNote) {
        return {
          outcome: "canceled",
          askId: input.askId,
          at: Date.now(),
          note: shutdownNote,
        };
      }
      const now = Date.now();
      if (input.deadlineAt !== null && now >= input.deadlineAt) {
        return input.onDefault();
      }
      const remaining =
        input.deadlineAt === null ? delay : Math.min(delay, input.deadlineAt - now);
      await sleep(Math.max(250, remaining));
      let read: AnswerRead;
      try {
        read = await readAnswer(input.askId);
        failingSince = null;
        failures = 0;
      } catch (error) {
        if (error instanceof TransientAskError) {
          failingSince ??= Date.now();
          if (Date.now() - failingSince < ANSWER_OUTAGE_MAX_MS) {
            delay =
              RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length - 1)]!;
            failures += 1;
            continue;
          }
        }
        openAsks.delete(input.askId);
        return {
          outcome: "canceled",
          askId: input.askId,
          at: Date.now(),
          note: `That question could not be kept open: ${(error as Error).message}`,
        };
      }
      delay = ANSWER_POLL_MS;
      if (read.answer && input.onAnswer) {
        openAsks.delete(input.askId);
        try {
          return await input.onAnswer(read);
        } catch (error) {
          return {
            outcome: "canceled",
            askId: input.askId,
            at: Date.now(),
            note: `The answer could not be opened here: ${(error as Error).message}`,
          };
        }
      }
      const resolution = answeredResolution(input.askId, read);
      if (resolution) {
        openAsks.delete(input.askId);
        return resolution;
      }
      if (read.state === "canceled") {
        openAsks.delete(input.askId);
        const reason = normalizeUserAskDeclineReason(read.reason);
        return {
          outcome: "declined",
          askId: input.askId,
          at: Date.now(),
          note: userAskDeclinedNote(reason),
          ...(reason ? { reason } : {}),
        };
      }
      if (read.state === "expired") {
        openAsks.delete(input.askId);
        return {
          outcome: "expired",
          askId: input.askId,
          at: Date.now(),
          note: USER_ASK_EXPIRED_NOTE,
        };
      }
    }
  };

  const askUser = async (
    askRequest: AskUserRequest,
  ): Promise<UserAskResolution> => {
    const blocking = askRequest.blocking === true;
    const timeoutMs = blocking ? null : clampUserAskTimeoutMs(askRequest.timeoutMs);
    const detail: UserAskDetail = {
      kind: "question",
      questions: blocking
        ? askRequest.questions.map(({ defaultChoiceId: _default, ...question }) => question)
        : askRequest.questions,
    };
    const askId = await register({
      kind: "question",
      toolCallId: askRequest.toolCallId ?? randomUUID(),
      urgency: clampUrgency(askRequest.urgency),
      blocking,
      ...(timeoutMs === null ? {} : { timeoutMs }),
      detail,
    });
    return await waitForAnswer({
      askId,
      deadlineAt: timeoutMs === null ? null : Date.now() + timeoutMs,
      onDefault: () => userAskDefaultedResolution(askId, detail, Date.now()),
    });
  };

  const ownerOf = (request: { agentId?: string; conversationId?: string }): string =>
    request.agentId || request.conversationId || args.threadId;

  /**
   * One field's value: a sensitive one (or a readable one Stella would hide
   * from the task anyway) is held here behind a handle; the rest is text.
   */
  const place = async (
    opened: Opened,
    field: UserAskField,
    value: string,
    owner: string,
  ): Promise<void> => {
    const store = args.secureValues!;
    const hidden = !field.sensitive && store.hides(value);
    if (!field.sensitive && !hidden) {
      opened.values[field.id] = value;
      return;
    }
    const held = await store.hold(value, field.label, owner);
    opened.handles[field.id] = held.handle;
    opened.freshUntil = Math.max(opened.freshUntil, held.expiresAt);
    if (hidden) opened.asHandles.push(field.id);
  };

  const openField = (
    key: TaskRecipientKey,
    askId: string,
    fieldId: string,
    sealed: UserAskSealedValue,
  ): string => openSealedValue({ sealed, key, askId, fieldId });

  /** Ask the user's computers for a value they saved, sealed to this request's key. */
  const release = async (input: {
    releaseId: string;
    key: TaskRecipientKey;
    secureRequest: SecureInputRequest;
    fields: readonly UserAskField[];
    service: string;
    account?: string;
  }): Promise<SavedValueReleaseResult> => {
    try {
      return (await request({
        op: "release",
        releaseId: input.releaseId,
        service: input.service,
        ...(input.account ? { account: input.account } : {}),
        purpose: input.secureRequest.purpose,
        fields: releaseFields(input.fields),
        recipientKey: input.key.recipientKey,
      })) as SavedValueReleaseResult;
    } catch (error) {
      // No computer answered in time, or the cloud can't ask: the card
      // still reaches the user.
      console.error(`saved value release failed: ${(error as Error).message}`);
      return { found: false, savedHere: [], reason: "no_computer" };
    }
  };

  const requestSecureInput = async (
    secureRequest: SecureInputRequest,
  ): Promise<UserAskResolution | SecureInputNotSaved> => {
    const fields = cloudFields(secureRequest.fields ?? []);
    if (fields.length === 0) {
      throw new Error("Describe at least one field to collect.");
    }
    const store = args.secureValues;
    if (!store && fields.some((field) => field.sensitive)) {
      throw new Error(
        "This task has nowhere to keep a sensitive value, so it can ask only for values it may read.",
      );
    }
    const owner = ownerOf(secureRequest);
    const service = secureRequest.save?.service ?? "";
    const account = secureRequest.save?.account ?? "";
    const replace = secureRequest.save?.replace === true;
    const byId = new Map(fields.map((field) => [field.id, field]));

    // A saved value first: one of the user's computers releases it sealed
    // to a key that exists only in this process.
    let prefill: { opened: Opened; covered: string[]; saved: UserAskSavedValueNote } | null = null;
    if (service && !replace && store) {
      const releaseId = randomUUID();
      const key = createTaskRecipientKey();
      const released = await release({
        releaseId,
        key,
        secureRequest,
        fields,
        service,
        ...(account ? { account } : {}),
      });
      if (released.found) {
        const opened = emptyOpened();
        const covered: string[] = [];
        for (const [fieldId, sealed] of Object.entries(released.sealed)) {
          const field = byId.get(fieldId);
          if (!field) continue;
          const value = openField(key, releaseId, fieldId, sealed);
          if (!value) continue;
          await place(opened, field, value, owner);
          covered.push(fieldId);
        }
        const saved: UserAskSavedValueNote = {
          label: released.saved.label,
          ...(released.saved.account ? { account: released.saved.account } : {}),
          reused: true,
          remembered: true,
          savedAt: released.saved.savedAt,
          ...(released.saved.service
            ? { service: released.saved.service, askedService: released.saved.askedService ?? service }
            : {}),
        };
        const missing = fields.filter((field) => !field.optional && !covered.includes(field.id));
        if (missing.length === 0) {
          return {
            outcome: "answered",
            askId: `saved:${releaseId}`,
            ...(Object.keys(opened.values).length > 0 ? { values: opened.values } : {}),
            ...(Object.keys(opened.handles).length > 0 ? { handles: opened.handles } : {}),
            ...(opened.asHandles.length > 0 ? { asHandles: opened.asHandles } : {}),
            ...(opened.freshUntil ? { freshUntil: opened.freshUntil } : {}),
            heldBy: "cloud_task",
            saved,
            answeredAt: Date.now(),
          };
        }
        if (covered.length > 0) prefill = { opened, covered, saved };
      } else {
        if (released.message && !secureRequest.savedOnly) throw new Error(released.message);
        if (secureRequest.savedOnly) {
          return {
            outcome: "not_saved",
            savedHere: released.savedHere,
            reason: released.reason,
            ...(released.message ? { message: released.message } : {}),
          };
        }
      }
    }
    if (secureRequest.savedOnly) {
      return { outcome: "not_saved", savedHere: [], reason: "not_saved" };
    }

    // Nothing saved answers: a secure card, answered on any of the user's
    // devices and sealed to this request's own key.
    const key = createTaskRecipientKey();
    const askFields = prefill ? fields.filter((field) => !prefill!.covered.includes(field.id)) : fields;
    const label = service ? savedValueLabel(service, account) || secureRequest.purpose : "";
    const askId = await register({
      kind: "secure_input",
      toolCallId: secureRequest.toolCallId ?? randomUUID(),
      urgency: clampUrgency(secureRequest.urgency),
      blocking: true,
      detail: {
        kind: "secure_input",
        purpose: secureRequest.purpose,
        ...(secureRequest.detail ? { detail: secureRequest.detail } : {}),
        fields: askFields,
        ...(service
          ? {
              save: {
                service,
                ...(account ? { account } : {}),
                label: prefill ? prefill.saved.label : label,
                ...(replace ? { replacing: true } : {}),
                ...(prefill ? { usingSaved: true } : {}),
              },
            }
          : {}),
      },
      ...(store ? { recipientKey: key.recipientKey } : {}),
    });
    return await waitForAnswer({
      askId,
      deadlineAt: null,
      onDefault: () => ({
        outcome: "canceled",
        askId,
        at: Date.now(),
        note: "That request for values was closed before it was answered.",
      }),
      onAnswer: async (read) => {
        const answer = read.answer!;
        if (answer.kind !== "fields") {
          throw new Error("The answer was not field values.");
        }
        const opened = prefill?.opened ?? emptyOpened();
        const given: UserAskField[] = [];
        for (const entry of answer.fields) {
          const field = byId.get(entry.fieldId);
          if (!field) continue;
          if (entry.kind === "plain" && field.sensitive) {
            throw new Error(`${field.label} came back unsealed, so it was not used.`);
          }
          const value =
            entry.kind === "sealed"
              ? openField(key, askId, entry.fieldId, entry.sealed)
              : entry.value;
          if (!value && field.optional) continue;
          if (store) await place(opened, field, value, owner);
          else opened.values[field.id] = value;
          given.push(field);
        }
        let saved: UserAskSavedValueNote | undefined;
        if (service && given.some((field) => field.sensitive && userAskFieldIsRememberable(field))) {
          // The device the user answered on saves it when they chose to.
          const remembered = answer.remember !== false;
          saved = {
            label: prefill ? prefill.saved.label : label,
            ...(account ? { account } : {}),
            reused: false,
            remembered,
            ...(remembered && replace ? { replaced: true } : {}),
          };
        }
        if (prefill) {
          saved = {
            ...(saved ?? { remembered: false }),
            label: prefill.saved.label,
            reused: false,
            fromSaved: prefill.covered,
            ...(prefill.saved.service
              ? { service: prefill.saved.service, askedService: prefill.saved.askedService! }
              : {}),
          };
        }
        const userNote = normalizeUserAskNote(answer.note);
        return {
          outcome: "answered",
          askId,
          ...(Object.keys(opened.values).length > 0 ? { values: opened.values } : {}),
          ...(Object.keys(opened.handles).length > 0 ? { handles: opened.handles } : {}),
          ...(opened.asHandles.length > 0 ? { asHandles: opened.asHandles } : {}),
          ...(opened.freshUntil ? { freshUntil: opened.freshUntil } : {}),
          ...(store ? { heldBy: "cloud_task" as const } : {}),
          ...(saved ? { saved } : {}),
          ...(userNote ? { userNote } : {}),
          answeredAt: read.answeredAt ?? Date.now(),
          ...(read.late ? { late: true } : {}),
        };
      },
    });
  };

  const useSecureValue = async (useRequest: SecureValueUseRequest) => {
    if (!args.secureValues || !args.commandScope) {
      return {
        handle: useRequest.handle,
        target: useRequest.target.kind,
        usedAt: Date.now(),
        detail: "This task holds no secure values.",
        ok: false,
      };
    }
    return await useCloudSecureValue({
      store: args.secureValues,
      owner: ownerOf(useRequest),
      handle: useRequest.handle,
      target: useRequest.target,
      scope: args.commandScope,
      ...(args.browser ? { browser: args.browser } : {}),
    });
  };

  return {
    handlers: { askUser, requestSecureInput, useSecureValue },
    cancelOpenAsks: async (note: string) => {
      shutdownNote = note;
      const pending = [...openAsks];
      openAsks.clear();
      await Promise.all(pending.map(async (askId) => await cancel(askId)));
    },
  };
};
