import { useEffect, useMemo } from "react";
import {
  CONNECT_PLAN_NEAR_SHARE,
  CONNECT_PLAN_OFFER_ENABLED,
} from "@stella/contracts/connect-plan-offer";
import { useDesktopAuthSession } from "@/global/auth/services/auth-session";
import { resolveFreeAllowance } from "@/global/billing/audience";
import { useBackendValue } from "@/platform/backend/use-backend-view";
import { uiState } from "@/platform/ui-state";
import { openConnectPlan } from "./connect-plan";

const SHOWN_KEY = "stella.connectPlan.nearShown";

// One heads-up per app run even while several chat surfaces are mounted.
let shownThisRun = false;

/**
 * Once, when a Free account has used about 80% of its free usage: a quiet
 * heads-up that the ChatGPT or Claude plan it already has keeps Stella free
 * after that. Remembered per account on this device, so it never repeats.
 */
export function useConnectPlanHeadsUp(conversationId: string | null): void {
  const session = useDesktopAuthSession();
  const user = (session.data as { user?: { id?: string | null; isAnonymous?: boolean | null } | null } | null)
    ?.user;
  const userId = user && user.isAnonymous !== true ? (user.id ?? null) : null;
  const billingStatus = useBackendValue(
    "billing.status",
    CONNECT_PLAN_OFFER_ENABLED && userId ? {} : "skip",
  );
  const allowance = useMemo(() => resolveFreeAllowance(billingStatus), [billingStatus]);
  const near =
    allowance !== null &&
    !allowance.exhausted &&
    allowance.usedUsd >= allowance.limitUsd * CONNECT_PLAN_NEAR_SHARE;

  useEffect(() => {
    if (!CONNECT_PLAN_OFFER_ENABLED || !near || !userId || shownThisRun) return;
    const key = `${SHOWN_KEY}:${userId}`;
    if (uiState.getItem(key)) return;
    shownThisRun = true;
    uiState.setItem(key, "1");
    openConnectPlan({ conversationId, reason: "allowance-near" });
  }, [conversationId, near, userId]);
}
