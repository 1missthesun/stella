import { uiState } from "@/platform/ui-state";

export type OnboardingChatStep =
  | "capabilities"
  | "selfmod"
  | "memory"
  | "signin"
  | "gmail"
  | "theme"
  | "extras"
  | "phone"
  | "quickstart";

export const ONBOARDING_CHAT_STEPS: readonly OnboardingChatStep[] = [
  "capabilities",
  "selfmod",
  "memory",
  "signin",
  "gmail",
  "theme",
  "extras",
  "phone",
  "quickstart",
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

const isStep = (value: unknown): value is OnboardingChatStep =>
  typeof value === "string" &&
  (ONBOARDING_CHAT_STEPS as readonly string[]).includes(value);

const isAnswer = (value: unknown): value is OnboardingChatAnswer =>
  value === "accepted" || value === "skipped" || value === "done";

export const readOnboardingChatProgress = (): OnboardingChatProgress | null => {
  const raw = uiState.getItem(PROGRESS_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<OnboardingChatProgress>;
    if (!parsed || !isStep(parsed.step)) {
      uiState.removeItem(PROGRESS_KEY);
      return null;
    }
    const answers: OnboardingChatProgress["answers"] = {};
    if (parsed.answers && typeof parsed.answers === "object") {
      for (const [step, answer] of Object.entries(parsed.answers)) {
        if (isStep(step) && isAnswer(answer)) answers[step] = answer;
      }
    }
    return { step: parsed.step, answers };
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
