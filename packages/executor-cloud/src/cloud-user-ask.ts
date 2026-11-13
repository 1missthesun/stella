import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import {
  clampUrgency,
  clampUserAskTimeoutMs,
  normalizeUserAskDeclineReason,
  normalizeUserAskNote,
  USER_ASK_EXPIRED_NOTE,
  userAskDeclinedNote,
  userAskDefaultedResolution,
  type UserAskAnswer,
  type UserAskDetail,
  type UserAskResolution,
  type UserAskState,
} from "@stella/contracts/user-ask";
import type {
  AskUserRequest,
  SecureInputRequest,
  UserToolsConfig,
} from "@stella/runtime/kernel/tools/user.js";

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

export const createCloudUserAskHost = (args: {
  post: (route: string, body: unknown) => Promise<Response>;
  turnId: string;
  conversationId: string;
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

  const requestSecureInput = async (
    secureRequest: SecureInputRequest,
  ): Promise<UserAskResolution> => {
    const fields = secureRequest.fields ?? [];
    if (fields.length === 0) {
      throw new Error("Describe at least one field to collect.");
    }
    const refused = fields.filter(
      (field) => field.sensitive || field.type === "secret",
    );
    if (refused.length > 0) {
      throw new Error(
        `A value this agent must never see (${refused
          .map((field) => field.label)
          .join(", ")}) can only be collected on one of the user's own computers: it is sealed to a key the asking computer holds, and this agent runs in Stella's cloud with nowhere safe to keep one. Ask for it from a desktop agent, or ask here only for values you may read, such as an address or a preference.`,
      );
    }
    const askId = await register({
      kind: "secure_input",
      toolCallId: secureRequest.toolCallId ?? randomUUID(),
      urgency: clampUrgency(secureRequest.urgency),
      blocking: true,
      detail: {
        kind: "secure_input",
        purpose: secureRequest.purpose,
        ...(secureRequest.detail ? { detail: secureRequest.detail } : {}),
        fields,
      },
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
    });
  };

  const useSecureValue = async (): Promise<never> => {
    throw new Error(
      "A secure value handle lives only on the computer that collected it, and this agent runs in Stella's cloud, which keeps no secret store. Have an agent on that computer spend the handle.",
    );
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
