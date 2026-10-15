import { planUsageDialog } from "./plan-usage-dialog-store";
import {
  hasCapability,
  minimumPlanForCapability,
  toCapabilityAudience,
  type Capability,
  type CapabilityAudience,
} from "@stella/contracts/capabilities";
import {
  getPlanLabel,
  getRestrictionActionKind,
  type ManagedModelAudience,
} from "./audience";
import { i18nFallback } from "@/shared/i18n/I18nProvider";
import type { ToastOptions } from "@/ui/toast";

export {
  CAPABILITIES,
  hasCapability,
  minimumPlanForCapability,
  type Capability,
  type CapabilityAudience,
} from "@stella/contracts/capabilities";

type Translate = (
  key: string,
  params?: Record<string, string | number>,
) => string;

const defaultTranslate: Translate = (key, params) =>
  i18nFallback.t(key, params);

let publishedAudience: ManagedModelAudience | null = null;

export const publishBillingAudience = (
  audience: ManagedModelAudience | null,
): void => {
  publishedAudience = audience;
};

export const readBillingAudience = (): ManagedModelAudience | null =>
  publishedAudience;

export type CapabilityRestriction = {
  capability: Capability;
  audience: CapabilityAudience;
  minimumPlan: CapabilityAudience | null;
  actionKind: "sign-in" | "upgrade";
};

export const canUseCapability = (
  audience: ManagedModelAudience | null | undefined,
  capability: Capability,
): boolean => {
  const capabilityAudience = toCapabilityAudience(audience);
  if (!capabilityAudience) return true;
  return hasCapability(capabilityAudience, capability);
};

export const resolveCapabilityRestriction = (
  audience: ManagedModelAudience | null | undefined,
  capability: Capability,
): CapabilityRestriction | null => {
  const capabilityAudience = toCapabilityAudience(audience);
  if (!capabilityAudience) return null;
  if (hasCapability(capabilityAudience, capability)) return null;
  return {
    capability,
    audience: capabilityAudience,
    minimumPlan: minimumPlanForCapability(capability),
    actionKind: getRestrictionActionKind(capabilityAudience),
  };
};

export const resolveDeniedCapability = (
  audience: ManagedModelAudience | null | undefined,
  capability: Capability,
): CapabilityRestriction | null => {
  const capabilityAudience = toCapabilityAudience(audience);
  if (capabilityAudience) {
    return resolveCapabilityRestriction(audience, capability);
  }
  return {
    capability,
    audience: "free",
    minimumPlan: minimumPlanForCapability(capability),
    actionKind: getRestrictionActionKind("free"),
  };
};

export const getCapabilityLabel = (
  capability: Capability,
  t: Translate = defaultTranslate,
): string => t(`billing.capability.${capability}`);

export const getCapabilityRestrictionActionLabel = (
  restriction: Pick<CapabilityRestriction, "actionKind">,
  t: Translate = defaultTranslate,
): string =>
  restriction.actionKind === "sign-in"
    ? t("common.signIn")
    : t("sidebar.upgrade");

export const getCapabilityRestrictionTitle = (
  restriction: CapabilityRestriction,
  t: Translate = defaultTranslate,
): string =>
  t("billing.capabilityRestriction.title", {
    capability: getCapabilityLabel(restriction.capability, t),
  });

export const getCapabilityRestrictionDescription = (
  restriction: CapabilityRestriction,
  t: Translate = defaultTranslate,
): string => {
  const capability = getCapabilityLabel(restriction.capability, t);
  if (!restriction.minimumPlan) {
    return t("billing.capabilityRestriction.unavailable", { capability });
  }
  const plan = getPlanLabel(restriction.minimumPlan);
  return restriction.actionKind === "sign-in"
    ? t("billing.capabilityRestriction.signIn", { capability, plan })
    : t("billing.capabilityRestriction.upgrade", { capability, plan });
};

const openBilling = () => planUsageDialog.openPlans();

const openSignInDialog = () => {
  void import("@/router").then(({ router }) => {
    void router.navigate({
      to: ".",
      search: (prev: { dialog?: "auth" | "connect" }) => ({
        ...prev,
        dialog: "auth" as const,
      }),
    });
  });
};

export const buildCapabilityRestrictionToast = (
  restriction: CapabilityRestriction,
  t: Translate = defaultTranslate,
): ToastOptions => ({
  title: getCapabilityRestrictionTitle(restriction, t),
  description: getCapabilityRestrictionDescription(restriction, t),
  variant: "error",
  duration: 8000,
  action: {
    label: getCapabilityRestrictionActionLabel(restriction, t),
    onClick:
      restriction.actionKind === "sign-in" ? openSignInDialog : openBilling,
  },
});

