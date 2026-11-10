import { classifyStellaProviderError } from "@/features/chat/streaming/stella-provider-error-classifier";
import { dismissComposerNotice, presentComposerNotice } from "@/features/chat/composer-notice-store";
import { openConnectPlan } from "@/features/chat/connect-plan/connect-plan";
import { CONNECT_PLAN_COPY } from "@stella/contracts/connect-plan-offer";
import { translateNow } from "@/shared/i18n/active-translator";
import { detectLlmRouteFailureKind } from "@stella/contracts/llm-route-failure";

const HELD_SEND_NOTICE_ID = "held-send";

/**
 * A send that couldn't start because nothing could answer it yet (signed out
 * on Stella's models, no engine connected). The message stays in the composer
 * and goes out by itself the next time the person signs in or picks an engine.
 */
type HeldSend = {
  conversationId: string | null;
  /** Sends it again into whichever chat is open now; true once it went out. */
  retry: () => Promise<boolean>;
};

let held: HeldSend | null = null;
let retrying = false;
let quietMisses = false;

/** True when a start failure means "connect something", not "something broke". */
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

/** True while a waiting message is sent again with more tries to come, so a miss stays quiet. */
export const isRetryingHeldSend = (): boolean => quietMisses;

/**
 * Sends the held message again. A sign-in reaches the runtime a moment after
 * the window sees it, and swaps the signed-out chat for the account's, so a
 * send that can't start yet is retried briefly; if none goes out, the
 * message keeps waiting for the next sign-in or engine change.
 */
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
      // A retry that still needs an engine holds itself again; any other
      // miss (the chat was still switching) keeps this one waiting.
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

// The list of plans (ChatGPT, Claude Code, API key) in the same slot; once
// one connects, the waiting message goes out.
const openEnginePicker = (conversationId: string | null) => {
  openConnectPlan({
    conversationId,
    reason: "no-engine",
    description: CONNECT_PLAN_COPY.chooseBody,
    resend: () => void retryHeldSend({ attempts: 3 }),
  });
};

/**
 * The card above the composer (Home included) that stays until the person
 * acts or closes it: the message is still in the box and sends itself once
 * Stella can answer.
 */
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
