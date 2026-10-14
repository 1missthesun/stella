export const isRawJsonParseErrorMessage = (message: string): boolean => {
  const lower = message.toLowerCase();
  return (
    lower.includes("json parse") ||
    (lower.includes("unexpected") &&
      (lower.includes("token") || lower.includes("character")) &&
      lower.includes("json")) ||
    /unexpected (character|token|end of (json )?input)/i.test(message)
  );
};
