/** Latest non-empty assistant prose from an already chronological message list. */
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

