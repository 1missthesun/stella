import {
  CONNECT_PLAN_COPY as COPY,
  CONNECT_PLAN_OFFER_ENABLED,
} from "@stella/contracts/connect-plan-offer";
import { OPEN_MODEL_PICKER_EVENT } from "@/global/billing/byok-action";
import { planUsageDialog } from "@/global/billing/plan-usage-dialog-store";
import { isWebsiteHost } from "@/platform/capabilities";
import { presentComposerNotice } from "@/features/chat/composer-notice-store";
import type { ToastOptions } from "@/ui/toast";
import { classifyStellaProviderError } from "@/features/chat/streaming/stella-provider-error-classifier";
import type { ConnectPlanNoticeState, ConnectPlanReason } from "./connect-plan-types";

export type { ConnectPlanNoticeState, ConnectPlanReason } from "./connect-plan-types";

export const connectPlanOfferEnabled = (): boolean => CONNECT_PLAN_OFFER_ENABLED;

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

export const openEngineConnectFallback = (): void => {
  if (typeof window === "undefined") return;
  if (connectPlanChatGptOnly()) {
    void import("@/shell/settings-dialog-store").then(({ settingsDialog }) => settingsDialog.openAt("ai"));
    return;
  }
  window.dispatchEvent(new Event(OPEN_MODEL_PICKER_EVENT));
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

export const presentAllowanceConnectPlan = (
  reason: string | null | undefined,
  conversationId: string | null,
): boolean => {
  if (!CONNECT_PLAN_OFFER_ENABLED) return false;
  if (classifyStellaProviderError(reason).kind !== "free-allowance-exhausted") return false;
  openConnectPlan({ conversationId, reason: "allowance" });
  return true;
};
