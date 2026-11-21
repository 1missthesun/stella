import type { LocalContextEvent } from "./shared.js";

export type LocalChatEventWindowQuery = {
  types: readonly string[];
  beforeTimestamp?: number;
  payloadKey?: string;
  limit?: number;
};

export type LocalChatEventWindow = {
  query(query: LocalChatEventWindowQuery): LocalContextEvent[];
};

