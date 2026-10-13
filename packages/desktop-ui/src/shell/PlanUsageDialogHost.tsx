/**
 * The single mounted host for the Plan & usage dialog, so the account menu
 * and every Upgrade action open the same one (`planUsageDialog`).
 */
import { lazy, memo, Suspense } from "react";
import {
  planUsageDialog,
  usePlanUsageDialogOpen,
} from "@/global/billing/plan-usage-dialog-store";

const PlanUsageDialog = lazy(() =>
  import("@/global/billing/PlanUsageDialog").then((module) => ({
    default: module.PlanUsageDialog,
  })),
);

export const PlanUsageDialogHost = memo(function PlanUsageDialogHost() {
  const open = usePlanUsageDialogOpen();
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <PlanUsageDialog
        open
        onOpenChange={(next) => planUsageDialog.setOpen(next)}
      />
    </Suspense>
  );
});
