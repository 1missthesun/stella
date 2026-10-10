import {
  USER_ASK_MAX_RESPONSE_TEXT,
  type UserAskDetail,
  type UserAskField,
  type UserAskQuestion,
  type UserAskQuestionResponse,
} from "./user-ask";

export const USER_ASK_NOTIFICATION_THREAD = "user_ask" as const;
export const USER_ASK_ACTION_PREFIX = "ask." as const;
export const USER_ASK_ACTION_OPEN = "ask.open" as const;
export const USER_ASK_ACTION_CATEGORY_PREFIX = "user_ask." as const;
export const USER_ASK_PUSH_CAPABILITY = "user-ask-actions-1" as const;
export const USER_ASK_REPLY_TOKEN_PREFIX = "uar1" as const;

const MAX_ACTION_TITLE = 48;
const ANDROID_MAX_ACTIONS = 3;

export type UserAskNotificationPlatform = "ios" | "android";

export type UserAskNotificationAction = Readonly<{
  id: string;
  title: string;
  input?: Readonly<{ placeholder: string; submit: string }>;
  foreground?: true;
}>;

export type UserAskNotificationPlan = Readonly<{
  actions: readonly UserAskNotificationAction[];
  bodySuffix?: string;
}>;

export type UserAskNotificationReply = Readonly<{
  action: string;
  text?: string;
}>;

export type UserAskNotificationAnswer =
  | Readonly<{ kind: "questions"; responses: readonly UserAskQuestionResponse[] }>
  | Readonly<{
      kind: "fields";
      fields: readonly Readonly<{ fieldId: string; kind: "plain"; value: string }>[];
    }>;

export const userAskActionCategoryId = (askId: string): string =>
  `${USER_ASK_ACTION_CATEGORY_PREFIX}${askId}`;

export const isUserAskActionId = (actionId: string): boolean =>
  actionId.startsWith(USER_ASK_ACTION_PREFIX);

export const isUserAskReplyActionId = (actionId: string): boolean =>
  isUserAskActionId(actionId) && actionId !== USER_ASK_ACTION_OPEN;

const clip = (value: string, max: number): string => {
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`;
};

const openAction = (title: string): UserAskNotificationAction => ({
  id: USER_ASK_ACTION_OPEN,
  title,
  foreground: true,
});

const textAction = (
  id: string,
  title: string,
  placeholder: string,
): UserAskNotificationAction => ({
  id,
  title: clip(title, MAX_ACTION_TITLE),
  input: { placeholder: clip(placeholder, 120), submit: "Send" },
});

export const userAskFieldIsSensitive = (field: UserAskField): boolean =>
  field.sensitive || field.type === "secret";

const numberedOptions = (question: UserAskQuestion): string =>
  question.options.map((option, index) => `${index + 1}. ${option.label}`).join("\n");

const questionPlan = (
  questions: readonly UserAskQuestion[],
  platform: UserAskNotificationPlatform,
): UserAskNotificationPlan => {
  if (questions.length !== 1) return { actions: [openAction("Answer")] };
  const question = questions[0]!;
  const buttons = question.options.map((option, index) => ({
    id: `ask.o.0.${index}`,
    title: clip(option.label, MAX_ACTION_TITLE),
  }));
  const reply = textAction("ask.t.0", "Something else…", "Your answer");
  if (platform === "ios" || buttons.length + 1 <= ANDROID_MAX_ACTIONS) {
    return { actions: [...buttons, reply] };
  }
  if (buttons.length <= ANDROID_MAX_ACTIONS) return { actions: buttons };
  return {
    actions: [
      textAction("ask.t.0", "Reply", `A number 1–${buttons.length}, or your own answer`),
    ],
    bodySuffix: numberedOptions(question),
  };
};

const fieldPlan = (
  fields: readonly UserAskField[],
  platform: UserAskNotificationPlatform,
): UserAskNotificationPlan => {
  if (fields.some(userAskFieldIsSensitive)) {
    return { actions: [openAction("Enter securely")] };
  }
  if (fields.length !== 1) return { actions: [openAction("Answer")] };
  const field = fields[0]!;
  if (field.type === "choice") {
    const choices = field.choices ?? [];
    const limit = platform === "ios" ? 4 : ANDROID_MAX_ACTIONS;
    if (choices.length === 0 || choices.length > limit) {
      return { actions: [openAction("Answer")] };
    }
    return {
      actions: choices.map((choice, index) => ({
        id: `ask.c.0.${index}`,
        title: clip(choice.label, MAX_ACTION_TITLE),
      })),
    };
  }
  return {
    actions: [textAction("ask.f.0", `Reply: ${field.label}`, field.placeholder ?? field.label)],
  };
};

export const userAskNotificationPlan = (
  detail: UserAskDetail,
  platform: UserAskNotificationPlatform,
): UserAskNotificationPlan =>
  detail.kind === "question"
    ? questionPlan(detail.questions, platform)
    : fieldPlan(detail.fields, platform);

const indexPart = (value: string | undefined): number | null => {
  if (value === undefined || !/^\d{1,2}$/.test(value)) return null;
  return Number(value);
};

const matchOption = (question: UserAskQuestion, text: string): string | null => {
  const normalized = text.trim().toLowerCase().replace(/[.)]$/, "");
  if (/^\d{1,2}$/.test(normalized)) {
    const option = question.options[Number(normalized) - 1];
    return option ? option.id : null;
  }
  const byLabel = question.options.find(
    (option) => option.label.trim().toLowerCase() === normalized,
  );
  return byLabel ? byLabel.id : null;
};

export const userAskAnswerFromNotificationReply = (
  detail: UserAskDetail,
  reply: UserAskNotificationReply,
): UserAskNotificationAnswer | null => {
  const parts = reply.action.split(".");
  if (parts[0] !== "ask") return null;
  const kind = parts[1];
  const first = indexPart(parts[2]);
  const second = indexPart(parts[3]);
  const text = (reply.text ?? "").trim().slice(0, USER_ASK_MAX_RESPONSE_TEXT);
  if (detail.kind === "question") {
    if (detail.questions.length !== 1 || first !== 0) return null;
    const question = detail.questions[0]!;
    if (kind === "o" && parts.length === 4 && second !== null) {
      const option = question.options[second];
      if (!option) return null;
      return {
        kind: "questions",
        responses: [{ questionId: question.id, kind: "option", choiceId: option.id }],
      };
    }
    if (kind === "t" && parts.length === 3) {
      if (!text) return null;
      const choiceId = matchOption(question, text);
      return {
        kind: "questions",
        responses: [
          choiceId
            ? { questionId: question.id, kind: "option", choiceId }
            : { questionId: question.id, kind: "text", text },
        ],
      };
    }
    return null;
  }
  if (detail.fields.length !== 1 || first !== 0) return null;
  const field = detail.fields[0]!;
  if (userAskFieldIsSensitive(field)) return null;
  if (kind === "c" && parts.length === 4 && second !== null && field.type === "choice") {
    const choice = (field.choices ?? [])[second];
    if (!choice) return null;
    return { kind: "fields", fields: [{ fieldId: field.id, kind: "plain", value: choice.id }] };
  }
  if (kind === "f" && parts.length === 3 && field.type !== "choice") {
    if (!text) return null;
    return { kind: "fields", fields: [{ fieldId: field.id, kind: "plain", value: text.slice(0, 4096) }] };
  }
  return null;
};

export const userAskReplyLabel = (
  detail: UserAskDetail,
  answer: UserAskNotificationAnswer,
): string => {
  if (answer.kind === "fields") {
    const value = answer.fields[0]?.value ?? "";
    const field = detail.kind === "secure_input" ? detail.fields[0] : undefined;
    const choice = field?.choices?.find((entry) => entry.id === value);
    return clip(choice?.label ?? value, 80);
  }
  const response = answer.responses[0];
  if (!response || detail.kind !== "question") return "";
  if (response.kind === "text") return clip(response.text, 80);
  if (response.kind === "option") {
    const option = detail.questions[0]?.options.find((entry) => entry.id === response.choiceId);
    return clip(option?.label ?? response.choiceId, 80);
  }
  return "";
};

const base64UrlEncode = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const base64UrlDecode = (value: string): string | null => {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
};

export type UserAskReplyTokenParts = Readonly<{
  ownerId: string;
  routeSignature: string;
  secret: string;
}>;

const TOKEN_PART = /^[A-Za-z0-9_-]{32,128}$/;

export const formatUserAskReplyToken = (parts: UserAskReplyTokenParts): string =>
  `${USER_ASK_REPLY_TOKEN_PREFIX}.${base64UrlEncode(parts.ownerId)}.${parts.routeSignature}.${parts.secret}`;

export const parseUserAskReplyToken = (token: string): UserAskReplyTokenParts | null => {
  if (token.length > 1024) return null;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== USER_ASK_REPLY_TOKEN_PREFIX) return null;
  const ownerId = base64UrlDecode(parts[1]!);
  const routeSignature = parts[2]!;
  const secret = parts[3]!;
  if (!ownerId || ownerId.length > 512) return null;
  if (!TOKEN_PART.test(routeSignature) || !TOKEN_PART.test(secret)) return null;
  return { ownerId, routeSignature, secret };
};

export type UserAskActionablePushData = Readonly<{
  kind: "user_ask";
  askId: string;
  conversationId: string;
  level: number;
  actions?: readonly UserAskNotificationAction[];
  replyUrl?: string;
  replyToken?: string;
  alertTitle?: string;
  alertBody?: string;
  channelId?: string;
  quiet?: boolean;
}>;
