import {
  CONNECT_PLAN_COPY as COPY,
  CONNECT_PLAN_OFFER_ENABLED,
} from "@stella/contracts/connect-plan-offer";
import { OPEN_MODEL_PICKER_EVENT } from "@/global/billing/byok-action";
import { planUsageDialog } from "@/global/billing/plan-usage-dialog-store";
import { isWebsiteHost } from "@/platform/capabilities";
import { writeViewState } from "@/platform/view-state/view-state";
import { presentComposerNotice } from "@/features/chat/composer-notice-store";
import type { ToastOptions } from "@/ui/toast";
import { classifyStellaProviderError } from "@/features/chat/streaming/stella-provider-error-classifier";
import type { ConnectPlanNoticeState, ConnectPlanReason } from "./connect-plan-types";

export type { ConnectPlanNoticeState, ConnectPlanReason } from "./connect-plan-types";

/** Off until the owner gives an explicit go-ahead; see `@stella/contracts/connect-plan-offer`. */
export const connectPlanOfferEnabled = (): boolean => CONNECT_PLAN_OFFER_ENABLED;

/**
 * The web chat runs in the cloud, where a Free account can only run on a
 * ChatGPT plan: cloud Claude needs a paid plan (and stops with the free
 * usage), and API keys live on a computer.
 */
export const connectPlanChatGptOnly = (): boolean => isWebsiteHost();

export const connectPlanCopy = (
  reason: ConnectPlanReason,
): { title: string; description: string } => {
  const chatGptOnly = connectPlanChatGptOnly();
  if (reason === "allowance-near") {
    return {
      title: COPY.nearTitle,
      description: chatGptOnly ? COPY.nearBodyChatGpt : COPY.nearBody,
    };
  }
  if (reason === "no-engine") {
    return {
      title: COPY.chooseTitle,
      description: COPY.chooseBodyNoResend,
    };
  }
  return {
    title: COPY.outTitle,
    description: chatGptOnly ? COPY.outBodyChatGpt : COPY.outBody,
  };
};

export const openPlans = (): void => planUsageDialog.openPlans();

/** Where connecting lives when the card can't show: the Models picker, or Settings → Account on the web. */
export const openEngineConnectFallback = (): void => {
  if (typeof window === "undefined") return;
  if (connectPlanChatGptOnly()) {
    writeViewState("settings.tab", "account");
    void import("@/shell/settings-dialog-store").then(({ settingsDialog }) => settingsDialog.open());
    return;
  }
  window.dispatchEvent(new Event(OPEN_MODEL_PICKER_EVENT));
};

export type OpenConnectPlanInput = ConnectPlanNoticeState & {
  conversationId: string | null;
  /** Override the reason's own wording (e.g. the no-engine card's). */
  title?: string;
  description?: string;
};

/**
 * Show the connect-your-plan card above the composer (it works in an empty
 * chat too). Connecting there switches Stella to that plan and then runs
 * `resend`. Where no chat is on screen it falls back to a toast.
 */
export const openConnectPlan = (input: OpenConnectPlanInput): void => {
  const copy = connectPlanCopy(input.reason);
  const title = input.title ?? copy.title;
  const description = input.description ?? copy.description;
  const connectLabel = connectPlanChatGptOnly() ? COPY.connectChatGpt : COPY.connect;
  const fallback: ToastOptions = {
    title,
    description,
    variant: input.reason === "allowance-near" ? "default" : "error",
    duration: 10000,
    action: { label: connectLabel, onClick: openEngineConnectFallback },
    ...(input.reason === "no-engine"
      ? {}
      : { secondaryAction: { label: COPY.plans, onClick: openPlans } }),
  };
  presentComposerNotice(
    {
      conversationId: input.conversationId,
      kind: input.reason === "no-engine" ? "provider" : "upgrade",
      title,
      description,
      connectPlan: {
        reason: input.reason,
        ...(input.resend ? { resend: input.resend } : {}),
        ...(input.choose ? { choose: true } : {}),
      },
    },
    fallback,
  );
};

/**
 * The free usage ran out: show the connect-your-plan card instead of the
 * plain plan notice. False (and nothing shown) while the switch is off or
 * the error is about something else.
 */
export const presentAllowanceConnectPlan = (
  reason: string | null | undefined,
  conversationId: string | null,
): boolean => {
  if (!CONNECT_PLAN_OFFER_ENABLED) return false;
  if (classifyStellaProviderError(reason).kind !== "free-allowance-exhausted") return false;
  openConnectPlan({ conversationId, reason: "allowance" });
  return true;
};
