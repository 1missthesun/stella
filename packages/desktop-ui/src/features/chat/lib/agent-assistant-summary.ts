export const selectLatestAgentAssistantMessage = (
  messages: readonly string[] | undefined,
): string | undefined => {
  if (!messages) return undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const text = messages[index]?.trim();
    if (text) return text;
  }
  return undefined;
};

