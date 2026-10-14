import {
  USER_ASK_MAX_OPTIONS,
  USER_ASK_MAX_QUESTIONS,
  USER_ASK_MAX_TIMEOUT_MS,
  USER_ASK_MIN_OPTIONS,
  USER_ASK_MIN_TIMEOUT_MS,
  USER_ASK_URGENCY_NAMES,
  clampUrgency,
  clampUserAskTimeoutMs,
  normalizeUserAskQuestions,
  userAskReadableAnswers,
  type UserAskQuestion,
  type UserAskQuestionResponse,
  type UserAskResolution,
  type UserAskSavedValueNote,
  type UserAskUrgencyLevel,
} from "@stella/contracts/user-ask";

export const ASK_USER_TOOL_NAME = "ask_user";

export const ASK_USER_TOOL_LABEL = "Ask the user";

export const ASK_USER_TOOL_WORKING_TEXT = "Asking";

export const ASK_USER_TOOL_DESCRIPTION =
  "Show the user a card with up to four multiple-choice questions. It interrupts them and can push to their phone, so it is for go-aheads (spending money, deleting their data, sending or posting as them, deploying or releasing), things that need their hands or consent (sign-in, 2FA, an approval), and real forks where a wrong guess is costly to redo; otherwise decide and say what you chose. A go-ahead already given covers the rest of that task. Open-ended questions go in plain prose, not a card. Questions appear one at a time on every device; the user picks, types an answer, or skips. Without blocking, each question proceeds with its default_choice when the timeout passes, and a later answer still reaches you; keep working on what doesn't depend on it. The chat shows the user's answers, so don't repeat them back.";

export const ASK_USER_TOOL_PROMPT_SNIPPET =
  "Ask the user for a go-ahead or consent (`ask_user`) only at a real gate; otherwise decide and say what you chose. Give each question a default_choice and use a timeout unless the action is hard to undo";

export const ASK_USER_TOOL_PARAMETERS: Record<string, unknown> = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      minItems: 1,
      maxItems: USER_ASK_MAX_QUESTIONS,
      description: `1–${USER_ASK_MAX_QUESTIONS} related questions answered in one pass.`,
      items: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description:
              "Short stable id you will read back, e.g. `scope`. Optional.",
          },
          question: {
            type: "string",
            description: "One short question.",
          },
          detail: {
            type: "string",
            description: "Optional context shown under it.",
          },
          options: {
            type: "array",
            minItems: USER_ASK_MIN_OPTIONS,
            maxItems: USER_ASK_MAX_OPTIONS,
            description: `${USER_ASK_MIN_OPTIONS}–${USER_ASK_MAX_OPTIONS} answers; the user can also type or skip.`,
            items: {
              type: "object",
              properties: {
                id: {
                  type: "string",
                  description:
                    "Short stable id you will read back, e.g. `keep`.",
                },
                label: { type: "string", description: "Button text." },
                hint: { type: "string", description: "Optional sub-label." },
              },
              required: ["id", "label"],
            },
          },
          default_choice: {
            type: "string",
            description:
              "Option id used when the timeout passes. Required unless blocking.",
          },
        },
        required: ["question", "options"],
      },
    },
    timeout_ms: {
      type: "number",
      minimum: USER_ASK_MIN_TIMEOUT_MS,
      maximum: USER_ASK_MAX_TIMEOUT_MS,
      description: "How long before the defaults apply. Default: three minutes.",
    },
    blocking: {
      type: "boolean",
      description: "Wait with no default. For hard-to-undo actions only.",
    },
    urgency: {
      type: "string",
      enum: [...USER_ASK_URGENCY_NAMES],
      description:
        "How far it may escalate unanswered: chat, notify (desktop notification), alert (sound + phone push), breakthrough (pierces focus, repeats). The user's own limits win.",
    },
  },
  required: ["questions"],
};

export type PreparedAskUser =
  | {
      ok: true;
      questions: readonly UserAskQuestion[];
      blocking: boolean;
      timeoutMs?: number;
      urgency: UserAskUrgencyLevel;
    }
  | { ok: false; error: string };

export const prepareAskUser = (
  args: Record<string, unknown>,
  options: { orchestrator: boolean },
): PreparedAskUser => {
  const questions = normalizeUserAskQuestions(args);
  if (questions.length === 0) return { ok: false, error: "questions is required." };
  const thin = questions.find(
    (question) => question.options.length < USER_ASK_MIN_OPTIONS,
  );
  if (thin) {
    return {
      ok: false,
      error: `Give "${thin.question}" between ${USER_ASK_MIN_OPTIONS} and ${USER_ASK_MAX_OPTIONS} concrete options. The user can always type their own answer or skip.`,
    };
  }
  const blocking = !options.orchestrator && args.blocking === true;
  if (!blocking) {
    const missing = questions.find(
      (question) => question.defaultChoiceId === undefined,
    );
    if (missing) {
      return {
        ok: false,
        error: options.orchestrator
          ? `Your asks are always timed: give every question a default_choice set to one of its option ids ("${missing.question}" has none). For a hard-to-undo action, have the agent doing it ask instead.`
          : `A timed ask needs default_choice on every question, set to one of its option ids, so the work can continue without an answer ("${missing.question}" has none). Use blocking only for hard-to-undo actions.`,
      };
    }
  }
  return {
    ok: true,
    questions,
    blocking,
    ...(blocking
      ? {}
      : { timeoutMs: clampUserAskTimeoutMs(args.timeout_ms ?? args.timeoutMs) }),
    urgency: clampUrgency(args.urgency),
  };
};

const modelAnswers = (
  questions: readonly UserAskQuestion[],
  responses: readonly UserAskQuestionResponse[],
): Record<string, unknown>[] =>
  questions.map((question) => {
    const response = responses.find((entry) => entry.questionId === question.id);
    if (!response || response.kind === "skipped") {
      return { id: question.id, skipped: true };
    }
    if (response.kind === "text") return { id: question.id, text: response.text };
    return { id: question.id, choice: response.choiceId };
  });

const savedValueNote = (saved: UserAskSavedValueNote): string => {
  if (saved.reused) {
    return `Reused the value saved on this computer for "${saved.label}" without asking the user. If it turns out to be wrong (the login fails), call request_secure_input again with the same service and account and replace_saved: true to ask once for the right one.`;
  }
  if (saved.remembered) {
    return saved.replaced
      ? `The user gave a replacement; it overwrote the saved value for "${saved.label}".`
      : `The user chose to remember this on this computer as "${saved.label}"; later requests with the same service and account reuse it without asking.`;
  }
  return "The user chose not to remember this: each private handle works once and is deleted after you use it.";
};

/**
 * `request` (the secure card's purpose) goes into `details` only, so the
 * chat can show "Provided"/"Declined" with the user's note under it.
 */
export const userAskResolutionResult = (
  resolution: UserAskResolution,
  questions: readonly UserAskQuestion[] = [],
  request?: string,
): { result: Record<string, unknown>; details: Record<string, unknown> } => {
  const shown = request ? { request } : {};
  if (resolution.outcome === "answered") {
    const shared = {
      ...(resolution.values ? { values: resolution.values } : {}),
      ...(resolution.handles ? { handles: resolution.handles } : {}),
      ...(resolution.saved
        ? { saved: resolution.saved, note: savedValueNote(resolution.saved) }
        : {}),
      ...(resolution.userNote ? { userNote: resolution.userNote } : {}),
      ...(resolution.late ? { late: true } : {}),
    };
    return {
      result: {
        outcome: "answered",
        ...(resolution.responses
          ? { answers: modelAnswers(questions, resolution.responses) }
          : {}),
        ...shared,
      },
      details: {
        outcome: "answered",
        ...(resolution.responses
          ? { answers: userAskReadableAnswers(questions, resolution.responses) }
          : {}),
        ...shared,
        ...shown,
      },
    };
  }
  if (resolution.outcome === "defaulted") {
    return {
      result: {
        outcome: "defaulted",
        answers: modelAnswers(questions, resolution.responses),
        note: resolution.note,
      },
      details: {
        outcome: "defaulted",
        answers: userAskReadableAnswers(questions, resolution.responses),
        note: resolution.note,
      },
    };
  }
  const ended = {
    outcome: resolution.outcome,
    note: resolution.note,
    ...(resolution.reason ? { userNote: resolution.reason } : {}),
  };
  return { result: ended, details: { ...ended, ...shown } };
};
