import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBackendValue } from "@/platform/backend/use-backend-view";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import { useCurrentUser } from "@/global/auth/hooks/use-current-user";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle, } from "@/ui/dialog";
import { Button } from "@/ui/button";
import { uiState } from "@/platform/ui-state";
import { useT } from "@/shared/i18n";
import { isPaidBillingPlan, normalizeBillingPlan, planLabel, planRank, } from "@stella/contracts/billing-plans";
import "./SubscriptionUpgradeDialog.css";
const storageKeyFor = (accountKey) => `stella-billing-last-seen-plan:${accountKey}`;
export const SUBSCRIPTION_UPGRADED_EVENT = "stella:subscription-upgraded";
export function SubscriptionUpgradeDialog() {
    const t = useT();
    const { hasConnectedAccount } = useAuthSessionState();
    const { user } = useCurrentUser();
    const accountKey = user?.email?.toLowerCase() ?? "";
    const billingStatus = useBackendValue("billing.status", hasConnectedAccount ? {} : "skip");
    const [shownPlan, setShownPlan] = useState(null);
    const lastProcessedRef = useRef(null);
    useEffect(() => {
        if (!hasConnectedAccount) {
            lastProcessedRef.current = null;
            return;
        }
        if (!accountKey)
            return;
        if (billingStatus && billingStatus.authenticated === false)
            return;
        if (!billingStatus?.plan)
            return;
        const plan = normalizeBillingPlan(billingStatus.plan);
        const fingerprint = `${accountKey}|${plan}`;
        if (lastProcessedRef.current === fingerprint)
            return;
        lastProcessedRef.current = fingerprint;
        const storageKey = storageKeyFor(accountKey);
        let stored = null;
        const raw = uiState.getItem(storageKey);
        if (raw) {
            stored = normalizeBillingPlan(raw);
        }
        if (stored === plan)
            return;
        uiState.setItem(storageKey, plan);
        if (stored === null)
            return;
        if (!isPaidBillingPlan(plan) || planRank(plan) <= planRank(stored))
            return;
        setShownPlan(plan);
        window.dispatchEvent(new CustomEvent(SUBSCRIPTION_UPGRADED_EVENT));
    }, [accountKey, billingStatus, hasConnectedAccount]);
    const onClose = useCallback(() => setShownPlan(null), []);
    const message = useMemo(() => {
        if (!shownPlan)
            return null;
        const label = planLabel(shownPlan);
        return {
            title: t("billing.upgradeDialog.title", { plan: label }),
            description: t("billing.upgradeDialog.description"),
        };
    }, [shownPlan, t]);
    if (!message)
        return null;
    return (<Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent fit className="subscription-upgrade-dialog">
        <DialogHeader>
          <DialogTitle>{message.title}</DialogTitle>
          <DialogDescription>{message.description}</DialogDescription>
        </DialogHeader>
        <DialogBody className="subscription-upgrade-dialog-body">
          <div className="subscription-upgrade-actions">
            <Button type="button" variant="primary" className="pill-btn pill-btn--primary" onClick={onClose}>
              {t("billing.upgradeDialog.cta")}
            </Button>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>);
}
