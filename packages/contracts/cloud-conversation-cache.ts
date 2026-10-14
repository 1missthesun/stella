export const MAX_CLOUD_CONVERSATION_CACHE_RECORDS = 3_000;
export const MAX_CLOUD_CONVERSATION_CACHE_CONVERSATIONS = 8;
export const MAX_CLOUD_CONVERSATION_CACHE_RECORD_BYTES = 512 * 1024;
export const MAX_CLOUD_CONVERSATION_CACHE_TOTAL_BYTES = 16 * 1024 * 1024;

export type CloudConversationCacheAuthority = {
  accountScope: string;
  ownerGeneration: string;
  conversationId: string;
};

export type CloudConversationCacheLifecycleAuthority = {
  accountScope: string;
  ownerGeneration: string;
};

export type CloudConversationCacheVersion = {
  epoch: number;
  headSeq: number;
  floorSeq: number;
  revision: number;
};

export type CloudConversationCacheSnapshot = CloudConversationCacheAuthority &
  CloudConversationCacheVersion & {
    title: string;
    cachedAtMs: number;
    records: unknown[];
  };

export type CloudConversationCacheReplaceInput =
  CloudConversationCacheAuthority & {
    expected: CloudConversationCacheVersion | null;
    epoch: number;
    headSeq: number;
    floorSeq: number;
    title: string;
    retainedRange?: { fromSeq: number; toSeq: number };
    records: unknown[];
  };

export type CloudConversationCacheReplaceResult =
  | {
      status: "applied";
      version: CloudConversationCacheVersion;
    }
  | {
      status: "conflict" | "inactive";
      current: CloudConversationCacheVersion | null;
    };

export type CloudConversationCachePurgeResult = {
  purgedConversations: number;
};
