import {
  PLAN_CATALOG,
  PLAN_ORDER,
  normalizeBillingPlan,
  type BillingPlan,
} from "./billing-plans.js";

export const CAPABILITIES = [
  "image_generation",
  "video_generation",
  "audio_generation",
  "three_d_generation",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export type CapabilityAudience = BillingPlan;

export const CAPABILITY_AUDIENCE_ORDER: readonly CapabilityAudience[] = PLAN_ORDER;

const mediaPlans = (): Record<CapabilityAudience, boolean> => ({
  free: PLAN_CATALOG.free.mediaGeneration,
  plus: PLAN_CATALOG.plus.mediaGeneration,
  pro: PLAN_CATALOG.pro.mediaGeneration,
  max: PLAN_CATALOG.max.mediaGeneration,
});

export const CAPABILITY_MATRIX: Record<
  Capability,
  Record<CapabilityAudience, boolean>
> = {
  image_generation: mediaPlans(),
  video_generation: mediaPlans(),
  audio_generation: mediaPlans(),
  three_d_generation: mediaPlans(),
};

export const hasCapability = (
  audience: CapabilityAudience,
  capability: Capability,
): boolean => CAPABILITY_MATRIX[capability]?.[audience] === true;

export const minimumPlanForCapability = (
  capability: Capability,
): CapabilityAudience | null =>
  CAPABILITY_AUDIENCE_ORDER.find((audience) =>
    hasCapability(audience, capability),
  ) ?? null;

export type ManagedCapabilityAudience = CapabilityAudience | string;

export const toCapabilityAudience = (
  audience: ManagedCapabilityAudience | null | undefined,
): CapabilityAudience | null =>
  audience === null || audience === undefined ? null : normalizeBillingPlan(audience);

export const CAPABILITY_LABELS: Record<Capability, string> = {
  image_generation: "Image generation",
  video_generation: "Video generation",
  audio_generation: "Audio generation",
  three_d_generation: "3D generation",
};

export const CAPABILITY_PLAN_LABELS: Record<CapabilityAudience, string> = {
  free: PLAN_CATALOG.free.label,
  plus: PLAN_CATALOG.plus.label,
  pro: PLAN_CATALOG.pro.label,
  max: PLAN_CATALOG.max.label,
};

export const CAPABILITY_DENIED_CODE = "CAPABILITY_REQUIRED" as const;

/**
 * Stable marker appended to denial prose so a client that only ever sees a
 * flattened `Error.message` — which is all the runtime hands the renderer
 * once a relay response has been turned into a throw — can still recover
 * which capability was denied. See
 * `desktop-ui/src/features/chat/streaming/stella-provider-error-classifier.ts`.
 */
export const capabilityDenialMarker = (capability: Capability): string =>
  `[capability/${capability}]`;

export type CapabilityDenial = {
  code: typeof CAPABILITY_DENIED_CODE;
  capability: Capability;
  audience: CapabilityAudience;
  minimumPlan: CapabilityAudience | null;
  message: string;
};

export const buildCapabilityDenial = (
  capability: Capability,
  audience: CapabilityAudience,
): CapabilityDenial => {
  const minimumPlan = minimumPlanForCapability(capability);
  const label = CAPABILITY_LABELS[capability];
  const marker = capabilityDenialMarker(capability);
  const message = minimumPlan
    ? `${label} requires the ${CAPABILITY_PLAN_LABELS[minimumPlan]} plan. ${marker}`
    : `${label} is not available on any plan right now. ${marker}`;
  return {
    code: CAPABILITY_DENIED_CODE,
    capability,
    audience,
    minimumPlan,
    message,
  };
};
