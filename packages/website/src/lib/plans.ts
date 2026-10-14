export type BillingPlan = "free" | "go" | "pro";

export type PlanDisplay = {
  label: string;
  monthlyPriceCents: number;
  tagline: string;
  features: readonly string[];
  featured?: boolean;
};

export const PLAN_ORDER: readonly BillingPlan[] = ["free", "go", "pro"];

export const PLANS: Record<BillingPlan, PlanDisplay> = {
  free: {
    label: "Free",
    monthlyPriceCents: 0,
    tagline: "No credit card, no trial.",
    features: [
      "Coding agent",
      "Personal assistant",
      "Research and knowledge work",
      "Dictation and read-aloud",
    ],
  },
  go: {
    label: "Go",
    monthlyPriceCents: 500,
    tagline: "10× higher usage",
    features: ["Coding, assistant and research", "Dictation and read-aloud"],
  },
  pro: {
    label: "Pro",
    monthlyPriceCents: 1_500,
    tagline: "The highest usage limits",
    featured: true,
    features: [
      "Image, video, 3D and voice generation",
      "Multiple agents working together",
    ],
  },
};

export const INCLUDED_IN_EVERY_PLAN = [
  "Browser, desktop, and mobile access",
  "Coding, assistant and research in one app",
  "Dictation and wake word on every tier",
  "Customizable interface",
  "Work with files and apps",
  "Bring your own models and keys",
] as const;
