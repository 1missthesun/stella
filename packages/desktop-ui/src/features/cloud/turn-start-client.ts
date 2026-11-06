import { planUsageDialog } from "@/global/billing/plan-usage-dialog-store";
import { CONVERSATION_ID_PATTERN } from "@stella/contracts/turn-plane/turn-start";
import { CLOUD_SANDBOX_SUBSCRIPTION_REQUIRED_MESSAGE } from "@stella/contracts/backend/billing";

const openBilling = () => planUsageDialog.openPlans();

export const notifyCloudSubscriptionRequired = (message?: string): void => {
  void import("@/ui/toast").then(({ showToast }) => {
    showToast({
      title: message?.trim() || CLOUD_SANDBOX_SUBSCRIPTION_REQUIRED_MESSAGE,
      description: "Running on your own computer stays free.",
      variant: "error",
      duration: 10_000,
      action: { label: "Upgrade", onClick: openBilling },
    });
  });
};

export const newCloudConversationId = (): string => {
  const id = crypto.randomUUID();
  if (!CONVERSATION_ID_PATTERN.test(id)) {
    throw new Error("Minted conversation id does not satisfy the contract.");
  }
  return id;
};
