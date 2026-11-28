import { classifyStellaProviderError } from "@/features/chat/streaming/stella-provider-error-classifier";
import { dismissComposerNotice, presentComposerNotice } from "@/features/chat/composer-notice-store";
import { openConnectPlan } from "@/features/chat/connect-plan/connect-plan";
import { translateNow } from "@/shared/i18n/active-translator";
import { detectLlmRouteFailureKind } from "@stella/contracts/llm-route-failure";

const HELD_SEND_NOTICE_ID = "held-send";

type HeldSend = {
  conversationId: string | null;
  retry: () => Promise<boolean>;
};

let held: HeldSend | null = null;
let retrying = false;
let quietMisses = false;

export const needsEngineToSend = (reason: string | null | undefined): boolean => {
  const classification = classifyStellaProviderError(reason);
  return (
    classification.kind === "sign-in-required" ||
    detectLlmRouteFailureKind(classification.message) === "no-stella-route"
  );
};

export const holdSend = (send: HeldSend): void => {
  held = send;
};

export const clearHeldSend = (conversationId?: string | null): void => {
  if (!held) return;
  if (conversationId !== undefined && held.conversationId !== conversationId) return;
  held = null;
};

export const hasHeldSend = (): boolean => held !== null;

export const isRetryingHeldSend = (): boolean => quietMisses;

export const retryHeldSend = async ({ attempts = 1, spacingMs = 1500 } = {}): Promise<void> => {
  if (!held || retrying) return;
  retrying = true;
  try {
    for (let attempt = 0; attempt < attempts && held; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, spacingMs));
      const current: HeldSend | null = held;
      if (!current) return;
      held = null;
      quietMisses = attempt < attempts - 1;
      if (await current.retry()) return;
      if (!held) held = current;
    }
  } finally {
    retrying = false;
    quietMisses = false;
  }
};

const openSignIn = () => {
  void import("@/router").then(({ router }) => {
    void router.navigate({
      to: ".",
      search: (prev: { dialog?: "auth" | "connect" }) => ({ ...prev, dialog: "auth" as const }),
    });
  });
};

const openEnginePicker = (conversationId: string | null) => {
  openConnectPlan({
    conversationId,
    reason: "no-engine",
    description: translateNow("chat.connectPlan.chooseBody"),
    resend: () => void retryHeldSend({ attempts: 3 }),
  });
};

export const presentHeldSendNotice = (conversationId: string | null): void => {
  presentComposerNotice({
    id: HELD_SEND_NOTICE_ID,
    conversationId,
    kind: "sign-in",
    title: translateNow("chat.heldSend.title"),
    description: translateNow("chat.heldSend.description"),
    action: { label: translateNow("chat.heldSend.signIn"), onClick: openSignIn },
    secondaryAction: {
      label: translateNow("chat.heldSend.connect"),
      onClick: () => openEnginePicker(conversationId),
    },
  });
};

export const dismissHeldSendNotice = (): void => dismissComposerNotice(HELD_SEND_NOTICE_ID);
