import { uiState } from "@/platform/ui-state";

export type OnboardingChatStep = "signin" | "extras";

export const ONBOARDING_CHAT_STEPS: readonly OnboardingChatStep[] = [
  "signin",
  "extras",
];

export type OnboardingChatAnswer = "accepted" | "skipped" | "done";

export type OnboardingChatProgress = {
  step: OnboardingChatStep;
  answers: Partial<Record<OnboardingChatStep, OnboardingChatAnswer>>;
};

export const nextOnboardingChatStep = (
  steps: readonly OnboardingChatStep[],
  step: OnboardingChatStep,
): OnboardingChatStep | null => {
  const index = steps.indexOf(step);
  return index >= 0 && index < steps.length - 1 ? steps[index + 1]! : null;
};

const PROGRESS_KEY = "stella-onboarding-chat-progress";

/** Steps of the earlier, longer setup, mapped to where someone part-way through it picks up. */
const RETIRED_STEPS: Record<string, OnboardingChatStep> = {
  capabilities: "signin",
  selfmod: "signin",
  memory: "signin",
  foundVia: "extras",
  gmail: "extras",
  theme: "extras",
  phone: "extras",
  quickstart: "extras",
};

const isStep = (value: unknown): value is OnboardingChatStep =>
  typeof value === "string" &&
  (ONBOARDING_CHAT_STEPS as readonly string[]).includes(value);

const toStep = (value: unknown): OnboardingChatStep | null => {
  if (isStep(value)) return value;
  return typeof value === "string" ? (RETIRED_STEPS[value] ?? null) : null;
};

const isAnswer = (value: unknown): value is OnboardingChatAnswer =>
  value === "accepted" || value === "skipped" || value === "done";

export const readOnboardingChatProgress = (): OnboardingChatProgress | null => {
  const raw = uiState.getItem(PROGRESS_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { step?: unknown; answers?: unknown };
    const step = toStep(parsed?.step);
    if (!step) {
      uiState.removeItem(PROGRESS_KEY);
      return null;
    }
    const answers: OnboardingChatProgress["answers"] = {};
    if (parsed.answers && typeof parsed.answers === "object") {
      for (const [key, answer] of Object.entries(parsed.answers)) {
        if (isStep(key) && key !== step && isAnswer(answer)) answers[key] = answer;
      }
    }
    return { step, answers };
  } catch {
    uiState.removeItem(PROGRESS_KEY);
    return null;
  }
};

export const writeOnboardingChatProgress = (
  progress: OnboardingChatProgress,
) => {
  uiState.setItem(PROGRESS_KEY, JSON.stringify(progress));
};

export const clearOnboardingChatProgress = () => {
  uiState.removeItem(PROGRESS_KEY);
};
