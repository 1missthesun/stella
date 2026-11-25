import { whatsNewDialog } from "@/features/whats-new/whats-new-store";
import { sidebarSections } from "@/features/workspace-display/sidebar-sections";
import { planUsageDialog } from "@/global/billing/plan-usage-dialog-store";
import { openModelPickerAt } from "@/global/billing/byok-action";
import type { NotificationOpener } from "./notification-store";

export const openNotificationTarget = (opens: NotificationOpener): void => {
  switch (opens.open) {
    case "whats-new":
      whatsNewDialog.open(opens.release);
      return;
    case "email":
      sidebarSections.openSectionTab("email");
      return;
    case "plans":
      planUsageDialog.openPlans();
      return;
    case "models":
      openModelPickerAt();
      return;
  }
};
