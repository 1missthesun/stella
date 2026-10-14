export const selectedCloudConversationId = (
  value: string | null | undefined,
): string | null => value?.trim() || null;

export const requireMatchingCloudConversationId = (
  requestedValue: unknown,
  selectedValue: string | null | undefined,
): string => {
  const selectedId = selectedCloudConversationId(selectedValue);
  if (!selectedId) {
    throw new Error("Select a conversation before continuing.");
  }
  if (
    typeof requestedValue !== "string" ||
    selectedCloudConversationId(requestedValue) !== selectedId
  ) {
    throw new Error("The active conversation changed. Try again.");
  }
  return selectedId;
};

export const requireRequestedCloudConversationId = (
  requestedValue: unknown,
  authority: { ownerGeneration?: string | null } | null | undefined,
): string => {
  const requestedId =
    typeof requestedValue === "string"
      ? selectedCloudConversationId(requestedValue)
      : null;
  if (!requestedId || requestedId.startsWith("local_")) {
    throw new Error("A cloud conversation id is required.");
  }
  if (!authority?.ownerGeneration?.trim()) {
    throw new Error(
      "Cloud conversation authority is not ready. Try again in a moment.",
    );
  }
  return requestedId;
};

