export type OnboardingSynthesisPromptConfig = {
  categoryAnalysisSystemPrompts?: Record<string, string>;
  categoryAnalysisUserPromptTemplate?: string;
  coreMemorySystemPrompt: string;
  coreMemoryUserPromptTemplate: string;
  welcomeMessagePromptTemplate: string;
};

export type OnboardingSynthesisRequest = {
  formattedSections: Record<string, string>;
  promptConfig: OnboardingSynthesisPromptConfig;
};

export type OnboardingStarter = {
  title: string;
  prompt: string;
};

export type OnboardingSynthesisResponse = {
  coreMemory: string;
  welcomeMessage: string;
  profileHighlights?: string[];
  starters?: OnboardingStarter[];
};
