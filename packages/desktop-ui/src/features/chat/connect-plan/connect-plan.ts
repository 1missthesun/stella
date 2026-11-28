import { CONNECT_PLAN_OFFER_ENABLED } from "@stella/contracts/connect-plan-offer";
import { openModelPickerAt } from "@/global/billing/byok-action";
import { planUsageDialog } from "@/global/billing/plan-usage-dialog-store";
import { isWebsiteHost } from "@/platform/capabilities";
import { presentComposerNotice } from "@/features/chat/composer-notice-store";
import { translateNow } from "@/shared/i18n/active-translator";
import type { ToastOptions } from "@/ui/toast";
import { classifyStellaProviderError } from "@/features/chat/streaming/stella-provider-error-classifier";
import type { ConnectPlanNoticeState, ConnectPlanReason } from "./connect-plan-types";

export type { ConnectPlanNoticeState, ConnectPlanReason } from "./connect-plan-types";

const K = "chat.connectPlan";

export const connectPlanOfferEnabled = (): boolean => CONNECT_PLAN_OFFER_ENABLED;

export const connectPlanChatGptOnly = (): boolean => isWebsiteHost();

export const connectPlanCopy = (
  reason: ConnectPlanReason,
): { title: string; description: string } => {
  const chatGptOnly = connectPlanChatGptOnly();
  if (reason === "allowance-near") {
    return {
      title: translateNow(`${K}.nearTitle`),
      description: translateNow(chatGptOnly ? `${K}.nearBodyChatGpt` : `${K}.nearBody`),
    };
  }
  if (reason === "no-engine") {
    return {
      title: translateNow(`${K}.chooseTitle`),
      description: translateNow(`${K}.chooseBodyNoResend`),
    };
  }
  return {
    title: translateNow(`${K}.outTitle`),
    description: translateNow(chatGptOnly ? `${K}.outBodyChatGpt` : `${K}.outBody`),
  };
};

export const connectPlanActionLabel = (): string =>
  translateNow(connectPlanChatGptOnly() ? `${K}.connectChatGpt` : `${K}.connect`);

export const openPlans = (): void => planUsageDialog.openPlans();

export const openOtherModels = (): void => openModelPickerAt();

export const openEngineConnectFallback = (): void => {
  if (typeof window === "undefined") return;
  if (connectPlanChatGptOnly()) {
    void import("@/shell/settings-dialog-store").then(({ settingsDialog }) => settingsDialog.openAt("ai"));
    return;
  }
  openModelPickerAt();
};

export type OpenConnectPlanInput = ConnectPlanNoticeState & {
  conversationId: string | null;
  title?: string;
  description?: string;
};

export const openConnectPlan = (input: OpenConnectPlanInput): void => {
  const copy = connectPlanCopy(input.reason);
  const title = input.title ?? copy.title;
  const description = input.description ?? copy.description;
  const fallback: ToastOptions = {
    title,
    description,
    variant: input.reason === "allowance-near" ? "default" : "error",
    duration: 10000,
    action: { label: connectPlanActionLabel(), onClick: openEngineConnectFallback },
    ...(input.reason === "no-engine"
      ? {}
      : { secondaryAction: { label: translateNow(`${K}.plans`), onClick: openPlans } }),
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
      },
    },
    fallback,
  );
};

export const presentAllowanceConnectPlan = (
  reason: string | null | undefined,
  conversationId: string | null,
): boolean => {
  if (!CONNECT_PLAN_OFFER_ENABLED) return false;
  if (classifyStellaProviderError(reason).kind !== "free-allowance-exhausted") return false;
  openConnectPlan({ conversationId, reason: "allowance" });
  return true;
};
