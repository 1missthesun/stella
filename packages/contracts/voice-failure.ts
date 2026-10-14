export type VoiceFailureAction = "sign-in" | "settings";

export type VoiceSessionFailure = {
  message: string;
  action: VoiceFailureAction | null;
};

export type VoiceProviderSessionRefusal = { failure: VoiceSessionFailure };

export const isVoiceSessionFailure = (
  value: unknown,
): value is VoiceSessionFailure => {
  if (typeof value !== "object" || value === null) return false;
  const { message, action } = value as Record<string, unknown>;
  return (
    typeof message === "string" &&
    (action === null || action === "sign-in" || action === "settings")
  );
};
