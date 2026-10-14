export const SLACK_CONVERSATION_PREFIX = "slack-";

export const isSlackConversationId = (conversationId: string): boolean =>
  conversationId.startsWith(SLACK_CONVERSATION_PREFIX);

export const NOT_SLACK_CONVERSATION_SQL = "conversation_id NOT LIKE 'slack-%'";
