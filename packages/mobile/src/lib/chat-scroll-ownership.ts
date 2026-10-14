export type ChatDataChangeScrollOwner =
  | "history-anchor"
  | "custom-follow"
  | "legend-tail";

export function resolveChatDataChangeScrollOwner({
  isFollowingLatest,
  isStreaming,
  postSendPlacementPending,
}: {
  isFollowingLatest: boolean;
  isStreaming: boolean;
  postSendPlacementPending: boolean;
}): ChatDataChangeScrollOwner {
  if (!isFollowingLatest) return "history-anchor";
  if (isStreaming || postSendPlacementPending) return "custom-follow";
  return "legend-tail";
}
