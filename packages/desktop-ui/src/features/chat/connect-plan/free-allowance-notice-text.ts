import { CONNECT_PLAN_OFFER_ENABLED } from "@stella/contracts/connect-plan-offer";
import { stellaUsageLimitOf } from "@stella/contracts/stella-usage-limit";
import { translateNow } from "@/shared/i18n/active-translator";

export const freeAllowanceNoticeText = (notice: string): string =>
  CONNECT_PLAN_OFFER_ENABLED && stellaUsageLimitOf(notice) === "free_allowance"
    ? translateNow("chat.connectPlan.bubble")
    : notice;
