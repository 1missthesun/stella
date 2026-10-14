import { useSyncExternalStore } from "react";
import {
  STELLA_USAGE_LIMIT_DESCRIPTIONS,
  STELLA_USAGE_LIMIT_TITLES,
  stellaUsageLimitOf,
} from "@stella/contracts/stella-usage-limit";

export type ComposerNoticeKind =
  | "sign-in"
  | "upgrade"
  | "limit"
  | "provider"
  | "server";

export type ComposerNotice = {
  id: string;
  conversationId: string | null;
  kind: ComposerNoticeKind;
  title: string;
  description?: string;
};

export type ComposerNoticeInput = Omit<ComposerNotice, "id"> & { id?: string };

let notices: ComposerNotice[] = [];
const listeners = new Set<() => void>();
let nextId = 0;

const emit = () => {
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => notices;

export function showComposerNotice(input: ComposerNoticeInput): string {
  const id = input.id ?? `composer-notice-${++nextId}`;
  notices = [
    ...notices.filter((entry) => entry.conversationId !== input.conversationId),
    { ...input, id },
  ];
  emit();
  return id;
}

export function dismissComposerNotice(id: string): void {
  if (!notices.some((entry) => entry.id === id)) return;
  notices = notices.filter((entry) => entry.id !== id);
  emit();
}

export function clearComposerNotices(
  conversationId: string | null | undefined,
): void {
  const remaining = notices.filter(
    (entry) =>
      entry.conversationId !== null &&
      entry.conversationId !== (conversationId ?? null),
  );
  if (remaining.length === notices.length) return;
  notices = remaining;
  emit();
}

export function selectComposerNotice(
  entries: readonly ComposerNotice[],
  conversationId: string | null | undefined,
): ComposerNotice | null {
  const scoped = conversationId
    ? entries.find((entry) => entry.conversationId === conversationId)
    : undefined;
  if (scoped) return scoped;
  return entries.find((entry) => entry.conversationId === null) ?? null;
}

export function useComposerNotice(
  conversationId: string | null | undefined,
): ComposerNotice | null {
  const entries = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return selectComposerNotice(entries, conversationId);
}

type NoticeCopy = Omit<ComposerNoticeInput, "conversationId">;

const includesAny = (value: string, matchers: readonly string[]) =>
  matchers.some((matcher) => value.includes(matcher));

const SIGN_IN_MATCHERS = [
  "sign in required",
  "sign-in required",
  "authentication required",
  "unauthorized",
  "unauthenticated",
  "invalid token",
  "token expired",
  "expired token",
  "session expired",
  "session revoked",
] as const;

const FREE_ALLOWANCE_MATCHERS = [
  "free_allowance_exhausted",
  "lifetime_limit_reached",
  "free allowance",
  "lifetime allowance",
  "lifetime usage limit",
] as const;

const CAPABILITY_MATCHERS = [
  "capability_required",
  "capability_not_available",
  "capability_denied",
  "paid_plan_required",
  "requires a stella subscription",
  "[capability/",
] as const;

const PLAN_LIMIT_MATCHERS = [
  "usage limit reached",
  "managed-model limits reached",
] as const;

const MODEL_RESTRICTION_MATCHERS = [
  "unsupported stella model selection",
  "invalid stella model selection",
  "model not available",
  "model is not available",
] as const;

const RATE_LIMIT_MATCHERS = [
  "rate limit exceeded",
  "too many requests",
  "chatgpt usage limit",
] as const;

const PROVIDER_MATCHERS = [
  "authentication failed",
  "api key",
  "forbidden",
  "permission denied",
] as const;

const statusCodeOf = (normalized: string): number | null => {
  const match = normalized.match(
    /\b(?:http(?: status)?|status(?: code)?|error(?: code)?|code)\s*[:=]?\s*([45]\d{2})\b/i,
  );
  if (!match?.[1]) return null;
  const status = Number(match[1]);
  return Number.isFinite(status) ? status : null;
};

export function classifyComposerNotice(
  message: string | null | undefined,
): NoticeCopy | null {
  const normalized = (message ?? "").trim().toLowerCase();
  if (!normalized) return null;
  const status = statusCodeOf(normalized);

  if (normalized.includes("sign in to stella to use cloud agents")) {
    return {
      kind: "sign-in",
      title: "Sign in to run agents",
      description: "Sign in to Stella before running cloud agents.",
    };
  }

  if (normalized.includes("running in the cloud needs a stella subscription")) {
    return {
      kind: "upgrade",
      title: "Cloud runs need a subscription",
      description:
        "Running in the cloud needs a Stella subscription. Upgrade, or run it on your own computer for free.",
    };
  }

  const usageLimit = includesAny(normalized, FREE_ALLOWANCE_MATCHERS)
    ? "free_allowance"
    : stellaUsageLimitOf(normalized);
  if (usageLimit) {
    return {
      kind: "upgrade",
      title: STELLA_USAGE_LIMIT_TITLES[usageLimit],
      description: STELLA_USAGE_LIMIT_DESCRIPTIONS[usageLimit],
    };
  }
  if (includesAny(normalized, CAPABILITY_MATCHERS)) {
    return {
      kind: "upgrade",
      title: "That's on a higher plan",
      description: "Upgrade to unlock this feature.",
    };
  }
  if (includesAny(normalized, PLAN_LIMIT_MATCHERS)) {
    return {
      kind: "upgrade",
      title: STELLA_USAGE_LIMIT_TITLES.plan_limit,
      description: STELLA_USAGE_LIMIT_DESCRIPTIONS.plan_limit,
    };
  }
  if (includesAny(normalized, MODEL_RESTRICTION_MATCHERS)) {
    return {
      kind: "upgrade",
      title: "Model not available on your plan",
      description:
        "Stella will use the recommended model for your plan. Upgrade to switch models.",
    };
  }
  if (includesAny(normalized, RATE_LIMIT_MATCHERS) || status === 429) {
    return {
      kind: "limit",
      title: "Model usage limit reached",
      description:
        "This model has reached a temporary usage limit. Choose another model or try again shortly.",
    };
  }
  if (includesAny(normalized, SIGN_IN_MATCHERS) || status === 401) {
    return {
      kind: "sign-in",
      title: "Sign in to keep using Stella",
      description: "Stella needs you to sign in again before continuing.",
    };
  }
  if (includesAny(normalized, PROVIDER_MATCHERS) || status === 403) {
    return {
      kind: "provider",
      title: "Provider access needed",
      description:
        "Reconnect the selected provider or choose another model to continue.",
    };
  }
  return null;
}

export function showComposerNoticeForError(
  error: unknown,
  conversationId: string | null | undefined,
): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const copy = classifyComposerNotice(message);
  if (!copy) return false;
  showComposerNotice({ ...copy, conversationId: conversationId ?? null });
  return true;
}
