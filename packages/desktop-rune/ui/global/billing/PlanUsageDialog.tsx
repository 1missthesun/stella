import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogHeader, DialogTitle, Press } from "../../kit/compat";
import { usePlanUsageDialog } from "./plan-usage-dialog.styles";
import { lazy, Suspense, useState } from "react";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";

const BillingPanel = lazy(() =>
  import("./BillingScreen").then((module) => ({
    default: module.BillingPanel,
  })),
);
const UsagePanel = lazy(() =>
  import("../../usage/App").then((module) => ({
    default: module.UsagePanel,
  })),
);

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
  const [tab, setTab] = useState<PlanUsageTab>("plan");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        {/* The tabs name the surface, so the title would only repeat them.
            Keep it for the accessible name and give the row to the tabs. */}
        <DialogHeader {...s.planUsageDialogHeader}>
          <VisuallyHidden asChild>
            <DialogTitle>Plan &amp; usage</DialogTitle>
          </VisuallyHidden>
          <row {...s.planUsageTabs} role="tablist" label="Plan and usage">
            {TABS.map(({ key, label }) => (
              <Press {...s.planUsageTabsItem} key={key} role="tab" id={`plan-usage-tab-${key}`} selected={tab === key} onPress={() => setTab(key)} {...((tab === key || undefined) ? s.planUsageTabsItemActive : null)}>
                {label}
              </Press>
            ))}
          </row>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody {...s.planUsageDialogBody} role="tabpanel" id={`plan-usage-panel-${tab}`} aria-labelledby={`plan-usage-tab-${tab}`}>
          <Suspense fallback={null}>
            {tab === "plan" ? <BillingPanel /> : <UsagePanel />}
          </Suspense>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
