import { useEffect, useState } from "react";
import { CLAUDE_LOGIN_WARN_BEFORE_MS } from "@stella/contracts/claude-local-accounts";
import type { EngineSettings } from "@stella/contracts/backend/engines";
import { useAuthState } from "@/global/auth/BackendAuthProvider";
import { useCloudEngines } from "@/features/cloud/cloud-engines-api";
import {
  dismissComposerNotice,
  presentComposerNotice,
  type ComposerNoticeInput,
} from "@/features/chat/composer-notice-store";
import { notify, withdrawNotification } from "@/features/notifications/notification-store";
import { useLocale, useT } from "@/shared/i18n";
import { uiState } from "@/platform/ui-state";
import { useClaudeLocalAccounts } from "./use-claude-local-accounts";

const NOTICE_ID = "claude-login-heads-up";
let shownInBell: string | null = null;

const withdrawHeadsUp = () => {
  if (shownInBell) withdrawNotification(shownInBell);
  shownInBell = null;
};
const DISMISSED_KEY = "stella.claudeLogin.headsUpDismissed";

type Attention = {
  state: "ending" | "ended";
  place: "local" | "cloud";
  id: string;
  email?: string;
  expiresAt?: number;
};

/**
 * The cloud's Claude login, when the cloud answers with Claude: its end as
 * the cloud last read it (after each sign-in and each Claude turn there).
 */
const cloudAttention = (settings: EngineSettings | undefined, now: number): Attention | undefined => {
  if (settings?.selection?.engine !== "anthropic") return undefined;
  const inUse = settings.claude?.places.find((place) => place.kind === "cloud")?.inUse;
  if (!inUse) return undefined;
  const connection = settings.connections.find(
    (entry) => entry.provider === "anthropic" && entry.accountId === inUse.accountId,
  );
  const place = connection?.places?.find((entry) => entry.kind === "cloud");
  if (!place || place.kind !== "cloud") return undefined;
  const email = inUse.email ?? connection?.email;
  const base = { place: "cloud" as const, id: inUse.accountId, ...(email ? { email } : {}) };
  if (place.loginEnded || (place.loginEndsAt !== undefined && place.loginEndsAt <= now)) {
    return { ...base, state: "ended", ...(place.loginEndsAt ? { expiresAt: place.loginEndsAt } : {}) };
  }
  if (place.loginEndsAt !== undefined && place.loginEndsAt - now <= CLAUDE_LOGIN_WARN_BEFORE_MS) {
    return { ...base, state: "ending", expiresAt: place.loginEndsAt };
  }
  return undefined;
};

/**
 * Before the Claude login Stella answers with on this computer ends (a few
 * days ahead) and after it has ended: one notification in the bell whose Sign
 * in opens the sign-in card at the composer, until the person signs in or
 * dismisses it. Dismissing hides it for that login's current state only, so
 * an ended login still gets its notice after an "ends soon" one was
 * dismissed. The cloud's login gets the same notice when the cloud answers
 * with Claude; this computer's comes first.
 */
export function useClaudeLoginHeadsUp(): void {
  const t = useT();
  const locale = useLocale();
  const local = useClaudeLocalAccounts();
  const usesClaude = useEngineUsesClaude();
  const { isAuthenticated } = useAuthState();
  const cloud = useCloudEngines(isAuthenticated);
  const now = useMinuteClock();
  const localAttention: Attention | undefined =
    local.attention && (usesClaude || Boolean(local.chosenEmail))
      ? {
          state: local.attention.state,
          place: "local",
          id: local.attention.configId,
          ...(local.attention.email ? { email: local.attention.email } : {}),
          ...(local.attention.expiresAt !== undefined ? { expiresAt: local.attention.expiresAt } : {}),
        }
      : undefined;
  const current = localAttention ?? cloudAttention(cloud, now);
  // Compared by value: the notice is presented again only when it changes.
  const attentionJson = current ? JSON.stringify(current) : "";

  useEffect(() => {
    const attention = attentionJson ? (JSON.parse(attentionJson) as Attention) : undefined;
    const key = attention
      ? `${attention.place === "cloud" ? "cloud:" : ""}${attention.state}:${attention.id}:${attention.expiresAt ?? ""}`
      : "";
    if (!attention || uiState.getItem(DISMISSED_KEY) === key) {
      withdrawHeadsUp();
      dismissComposerNotice(NOTICE_ID);
      return;
    }
    const email = attention.email;
    const date =
      attention.expiresAt !== undefined
        ? new Intl.DateTimeFormat(locale, {
            weekday: "long",
            month: "long",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          }).format(new Date(attention.expiresAt))
        : "";
    const cloudPlace = attention.place === "cloud";
    const notice = {
      id: NOTICE_ID,
      conversationId: null,
      kind: "sign-in",
      title: cloudPlace
        ? attention.state === "ending"
          ? t("claudeLogin.cloudEndingTitle")
          : t("claudeLogin.cloudEndedTitle")
        : attention.state === "ending"
          ? t("claudeLogin.endingTitle")
          : t("claudeLogin.endedTitle"),
      description:
        attention.state === "ending"
          ? t("claudeLogin.endingDescription", { date })
          : email
            ? t("claudeLogin.endedDescriptionEmail", { email })
            : t("claudeLogin.endedDescription"),
      claudeSignIn: {
        ...(email ? { email } : {}),
        ...(cloudPlace ? { place: "cloud" as const } : {}),
        dismissKey: key,
      },
    } satisfies ComposerNoticeInput;
    const bellId = `${NOTICE_ID}:${key}`;
    if (shownInBell !== bellId) withdrawHeadsUp();
    shownInBell = bellId;
    notify({
      id: bellId,
      kind: "sign-in",
      title: notice.title,
      detail: notice.description,
      actions: [
        {
          label: t("claudeLogin.signIn"),
          primary: true,
          keep: true,
          run: () => presentComposerNotice(notice),
        },
      ],
      onDismiss: () => rememberClaudeHeadsUpDismissed(key),
    });
  }, [attentionJson, locale, t]);
}

export const rememberClaudeHeadsUpDismissed = (key: string): void => {
  uiState.setItem(DISMISSED_KEY, key);
};

/** The time, to the minute: an "ends soon" date is reached without a new read. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** True when Stella's own replies here run on Claude Code. */
function useEngineUsesClaude(): boolean {
  const [value, setValue] = useState(false);
  useEffect(() => {
    let live = true;
    const read = () =>
      void window.electronAPI?.system
        ?.getLocalModelPreferences?.()
        .then((preferences) => {
          if (live) setValue(preferences?.agentRuntimeEngine === "claude_code_local");
        })
        .catch(() => undefined);
    read();
    const timer = setInterval(read, 60_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  return value;
}
