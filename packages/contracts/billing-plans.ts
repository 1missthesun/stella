export const BILLING_PLANS = ["free", "plus", "pro", "max"] as const;
export type BillingPlan = (typeof BILLING_PLANS)[number];

export const PAID_BILLING_PLANS = ["plus", "pro", "max"] as const;
export type PaidBillingPlan = (typeof PAID_BILLING_PLANS)[number];

export const isBillingPlan = (value: unknown): value is BillingPlan =>
  typeof value === "string" && (BILLING_PLANS as readonly string[]).includes(value);

export const isPaidBillingPlan = (value: unknown): value is PaidBillingPlan =>
  typeof value === "string" && (PAID_BILLING_PLANS as readonly string[]).includes(value);

export const normalizeBillingPlan = (value: unknown): BillingPlan => {
  if (isBillingPlan(value)) return value;
  if (value === "go" || value === "go_fallback") return "plus";
  if (value === "pro_fallback") return "pro";
  return "free";
};

export type PlanBudget = {
  rollingUsd: number;
  rollingWindowHours: number;
  weeklyUsd: number;
  monthlyUsd: number;
  oneTimeUsd?: number;
};

export type PlanDefinition = {
  id: BillingPlan;
  label: string;
  monthlyPriceCents: number;
  currency: "usd";
  interval: "month" | null;
  budget: PlanBudget;
  emailOnlyBudgetShare?: number;
  cloudContainers: boolean;
  mediaGeneration: boolean;
  limits: {
    modelRequestsAtOnce: number;
    modelRequestsPerMinute: number;
    modelBudgetChunkUsd: number;
    /** Drive is limited by total size only; there is no per-plan file count. */
    driveBytes: number;
    driveFileBytes: number;
    crewPreviewBytes: number;
    scheduleFiresPerDay: number;
    readAloudCharsPerDay: number;
  };
  tagline: string;
  includes: readonly string[];
};

const MODEL_REQUESTS_AT_ONCE = 64;

const MB = 1024 * 1024;
const GB = 1024 * MB;
const TB = 1024 * GB;

/** "2 TB", "500 GB", "2 GB", "25 MB": plan storage sizes as people read them. */
export const formatStorageSize = (bytes: number): string => {
  const unit = (size: number, label: string) => `${Math.round((bytes / size) * 10) / 10} ${label}`;
  if (bytes >= TB) return unit(TB, "TB");
  if (bytes >= GB) return unit(GB, "GB");
  return unit(MB, "MB");
};

const DRIVE_BYTES = {
  free: 2 * GB,
  plus: 100 * GB,
  pro: 500 * GB,
  max: 2 * TB,
} as const;

const driveLine = (plan: keyof typeof DRIVE_BYTES): string =>
  `${formatStorageSize(DRIVE_BYTES[plan])} of Drive storage`;

const paidBudget = (monthlyUsd: number): PlanBudget => ({
  rollingUsd: Math.round(monthlyUsd * 0.2 * 100) / 100,
  rollingWindowHours: 5,
  weeklyUsd: Math.round(monthlyUsd * 0.5 * 100) / 100,
  monthlyUsd,
});

export const PLAN_CATALOG: Readonly<Record<BillingPlan, PlanDefinition>> = {
  free: {
    id: "free",
    label: "Free",
    monthlyPriceCents: 0,
    currency: "usd",
    interval: null,
    budget: {
      rollingUsd: 0.5,
      rollingWindowHours: 5,
      weeklyUsd: 0.5,
      monthlyUsd: 0.5,
      oneTimeUsd: 0.5,
    },
    emailOnlyBudgetShare: 0.4,
    cloudContainers: false,
    mediaGeneration: false,
    limits: {
      modelRequestsAtOnce: MODEL_REQUESTS_AT_ONCE,
      modelRequestsPerMinute: 40,
      modelBudgetChunkUsd: 0.25,
      driveBytes: DRIVE_BYTES.free,
      driveFileBytes: 25 * MB,
      crewPreviewBytes: 250 * MB,
      scheduleFiresPerDay: 24,
      readAloudCharsPerDay: 60_000,
    },
    tagline: "Try Stella",
    includes: [
      "Dictation and read-aloud",
      "Bring your own models and keys",
      driveLine("free"),
    ],
  },
  plus: {
    id: "plus",
    label: "Plus",
    monthlyPriceCents: 2_000,
    currency: "usd",
    interval: "month",
    budget: paidBudget(15),
    cloudContainers: true,
    mediaGeneration: true,
    limits: {
      modelRequestsAtOnce: MODEL_REQUESTS_AT_ONCE,
      modelRequestsPerMinute: 80,
      modelBudgetChunkUsd: 1,
      driveBytes: DRIVE_BYTES.plus,
      driveFileBytes: 100 * MB,
      crewPreviewBytes: 1 * GB,
      scheduleFiresPerDay: 60,
      readAloudCharsPerDay: 300_000,
    },
    tagline: "More usage",
    includes: [
      "Image, video, music and 3D generation",
      driveLine("plus"),
    ],
  },
  pro: {
    id: "pro",
    label: "Pro",
    monthlyPriceCents: 5_000,
    currency: "usd",
    interval: "month",
    budget: paidBudget(40),
    cloudContainers: true,
    mediaGeneration: true,
    limits: {
      modelRequestsAtOnce: MODEL_REQUESTS_AT_ONCE,
      modelRequestsPerMinute: 120,
      modelBudgetChunkUsd: 2,
      driveBytes: DRIVE_BYTES.pro,
      driveFileBytes: 250 * MB,
      crewPreviewBytes: 5 * GB,
      scheduleFiresPerDay: 120,
      readAloudCharsPerDay: 1_000_000,
    },
    tagline: "Higher usage",
    includes: [
      "Image, video, music and 3D generation",
      driveLine("pro"),
    ],
  },
  max: {
    id: "max",
    label: "Max",
    monthlyPriceCents: 10_000,
    currency: "usd",
    interval: "month",
    budget: paidBudget(85),
    cloudContainers: true,
    mediaGeneration: true,
    limits: {
      modelRequestsAtOnce: MODEL_REQUESTS_AT_ONCE,
      modelRequestsPerMinute: 180,
      modelBudgetChunkUsd: 4,
      driveBytes: DRIVE_BYTES.max,
      driveFileBytes: 500 * MB,
      crewPreviewBytes: 10 * GB,
      scheduleFiresPerDay: 240,
      readAloudCharsPerDay: 2_000_000,
    },
    tagline: "Highest usage",
    includes: [
      "Image, video, music and 3D generation",
      driveLine("max"),
    ],
  },
};

export const PLAN_ORDER: readonly BillingPlan[] = BILLING_PLANS;

export const planRank = (plan: BillingPlan): number => PLAN_ORDER.indexOf(plan);

export const nextPlanUp = (plan: BillingPlan): PaidBillingPlan | null => {
  const next = PLAN_ORDER[planRank(plan) + 1];
  return next && isPaidBillingPlan(next) ? next : null;
};

export const planLabel = (plan: unknown): string => PLAN_CATALOG[normalizeBillingPlan(plan)].label;

export const formatPlanPrice = (cents: number): string =>
  cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;

export const BUDGET_COVERS = [
  "Stella's models",
  "Tasks Stella works on for you",
  "Image, video, music and 3D",
  "Voice, read-aloud and dictation",
  "Web search, maps and the cloud browser",
  "Hosted apps and previews",
] as const;

export const INCLUDED_IN_EVERY_PLAN = [
  "Desktop, web and mobile apps",
  "Change Stella by asking it",
  "Work with your files and apps",
  "Use your own Claude, ChatGPT or Gemini plan",
  "Bring your own models and keys",
  "Top up with extra credit anytime",
] as const;
