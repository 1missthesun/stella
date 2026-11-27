import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogHeader, DialogTitle, Press, T, VisuallyHidden } from "../../kit/compat";
import { usePlanUsageDialog } from "./plan-usage-dialog.styles";
import { useBillingScreen } from "./BillingScreen.styles";
import { preloadUsageSurface } from "../../usage/usage-cache";
import { useEffect, useRef, useState } from "react";
import { lazyScreen, useLazyReady } from "../../kit/lazy";

const BillingPanel = lazyScreen(() => import("./BillingScreen"), (module) => module.BillingPanel);
const UsagePanel = lazyScreen(() => import("../../usage/App"), (module) => module.UsagePanel);

const TABS = [
  { key: "plan", label: "Plan" },
  { key: "usage", label: "Usage" },
] as const;

type PlanUsageTab = (typeof TABS)[number]["key"];

type PlanUsageDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function PlanUsageDialog({ open, onOpenChange }: PlanUsageDialogProps) {
  const s = usePlanUsageDialog();
  const b = useBillingScreen();
  const [tab, setTab] = useState<PlanUsageTab>("plan");
  const Panel = tab === "plan" ? BillingPanel : UsagePanel;
  const ready = useLazyReady(open, Panel);
  // The dialog first appears with its panel drawn; a later tab switch shows the loading panel meanwhile.
  const shown = useRef(false);
  if (!open) shown.current = false;
  else if (ready) shown.current = true;

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => preloadUsageSurface("7d"), 120);
    return () => window.clearTimeout(timer);
  }, [open]);

  return (
    <Dialog open={shown.current} onOpenChange={onOpenChange}>
      <DialogContent size="xl" frame={{ w: 880, h: 720 }} focusSelf enter={undefined} exit={undefined}>
        <DialogHeader {...s.planUsageDialogHeader}>
          <VisuallyHidden asChild>
            <DialogTitle>Plan &amp; usage</DialogTitle>
          </VisuallyHidden>
          <row {...s.planUsageTabs} role="tablist" label="Plan and usage">
            {TABS.map(({ key, label }) => {
              const active = tab === key;
              const preload = key === "usage" ? () => preloadUsageSurface("7d") : undefined;
              return (
                <Press
                  {...s.planUsageTabsItem}
                  {...(active ? s.planUsageTabsItemActive : null)}
                  key={key}
                  role="tab"
                  id={`plan-usage-tab-${key}`}
                  selected={active}
                  onHover={preload ? (inside: boolean) => { if (inside) preload(); } : undefined}
                  onFocus={preload ? (focused: boolean) => { if (focused) preload(); } : undefined}
                  onPress={() => setTab(key)}
                >
                  <T size={s.planUsageTabsItem.size} weight={s.planUsageTabsItem.weight} em={s.planUsageTabsItem.em} lh={s.planUsageTabsItem.lh}>{label}</T>
                  <box {...s.planUsageTabsDot} opacity={active ? 1 : 0} scale={active ? 1 : 0} />
                </Press>
              );
            })}
          </row>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody {...s.planUsageDialogBody} role="tabpanel" id={`plan-usage-panel-${tab}`} aria-labelledby={`plan-usage-tab-${tab}`}>
          {ready ? <Panel /> : <col {...b.billingPanel} {...b.billingPanelLoading} aria-busy="true" />}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
