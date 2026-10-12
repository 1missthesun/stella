/**
 * Slack conversations (`slack-<hash>`) belong to a Slack workspace's shared
 * Stella. They live under the installer's account but never appear in that
 * account's own chats, sessions or agent messaging, and the other way round.
 */
export const SLACK_CONVERSATION_PREFIX = "slack-";

export const isSlackConversationId = (conversationId: string): boolean =>
  conversationId.startsWith(SLACK_CONVERSATION_PREFIX);

/** SQL that keeps Slack conversations out of the owner's own lists. */
export const NOT_SLACK_CONVERSATION_SQL = "conversation_id NOT LIKE 'slack-%'";
