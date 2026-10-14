import type { ChatMessage } from "../types";
import {
  decodeSequencedJournalEntry,
  type JournalRecord,
} from "@stella/contracts/conversation-protocol";
import {
  loadChatSyncState,
  loadCloudJournalCache,
  loadRecentChatMessages,
  saveCloudJournalCache,
  synchronizeChatMessages,
  saveChatSyncState,
} from "./offline-chat-storage";

export const JOURNAL_CACHE_MAX_RECORDS = 1_000;
export const JOURNAL_CACHE_MAX_BYTES = 4 * 1024 * 1024;

const CACHE_VERSION = 1;

export type CloudConversationCacheMetadata = {
  version: typeof CACHE_VERSION;
  accountScope: string;
  ownerGeneration: string;
  socketOrigin: string;
  conversationId: string;
  epoch: number;
  headSeq: number;
  floorSeq: number;
};

export type CloudConversationCacheReadPort = {
  loadMetadata(): Promise<string | null>;
  loadMessages(): Promise<ChatMessage[]>;
  loadRecords?(): Promise<string | null>;
};

export type CloudConversationCachePort = {
  clearMetadata(): Promise<void>;
  synchronizeMessages(
    messages: ChatMessage[],
    isCurrent: () => boolean,
  ): Promise<void>;
  synchronizeRecords?(encoded: string | null): Promise<void>;
  saveMetadata(metadata: CloudConversationCacheMetadata): Promise<void>;
};

export type CloudJournalSeed = {
  epoch: number;
  headSeq: number;
  floorSeq: number;
  records: JournalRecord[];
};

export const encodeCloudJournalTail = (
  records: readonly JournalRecord[],
  headSeq: number,
  limits: { maxRecords?: number; maxBytes?: number } = {},
): string | null => {
  const maxRecords = limits.maxRecords ?? JOURNAL_CACHE_MAX_RECORDS;
  const maxBytes = limits.maxBytes ?? JOURNAL_CACHE_MAX_BYTES;
  if (!records.length || records[records.length - 1]!.seq !== headSeq) {
    return null;
  }
  const encoded: string[] = [];
  let bytes = 0;
  for (let index = records.length - 1; index >= 0; index -= 1) {
    if (encoded.length >= maxRecords) break;
    const record = records[index]!;
    const expected = headSeq - encoded.length;
    if (record.seq !== expected) break;
    const json = JSON.stringify(record);
    if (bytes + json.length > maxBytes) break;
    bytes += json.length;
    encoded.push(json);
  }
  if (!encoded.length) return null;
  encoded.reverse();
  return `[${encoded.join(",")}]`;
};

export const decodeCloudJournalTail = (
  encoded: string | null | undefined,
): JournalRecord[] | null => {
  if (!encoded) return null;
  try {
    const raw = JSON.parse(encoded) as unknown;
    if (!Array.isArray(raw) || !raw.length) return null;
    const records: JournalRecord[] = [];
    for (const entry of raw) {
      const record = decodeSequencedJournalEntry(entry);
      if (!record) return null;
      const previous = records[records.length - 1];
      if (previous && record.seq !== previous.seq + 1) return null;
      records.push(record);
    }
    return records;
  } catch {
    return null;
  }
};

export const encodeCloudConversationCacheMetadata = (
  metadata: CloudConversationCacheMetadata,
): string => JSON.stringify(metadata);

export const decodeCloudConversationCacheMetadata = (
  value: string | null | undefined,
): CloudConversationCacheMetadata | null => {
  if (!value) return null;
  try {
    const raw = JSON.parse(value) as Record<string, unknown>;
    if (
      raw.version !== CACHE_VERSION ||
      typeof raw.accountScope !== "string" ||
      typeof raw.ownerGeneration !== "string" ||
      typeof raw.socketOrigin !== "string" ||
      typeof raw.conversationId !== "string" ||
      typeof raw.epoch !== "number" ||
      !Number.isSafeInteger(raw.epoch) ||
      typeof raw.headSeq !== "number" ||
      !Number.isSafeInteger(raw.headSeq) ||
      typeof raw.floorSeq !== "number" ||
      !Number.isSafeInteger(raw.floorSeq)
    ) {
      return null;
    }
    return raw as CloudConversationCacheMetadata;
  } catch {
    return null;
  }
};

export const rebuildCloudConversationCache = async (args: {
  metadata: CloudConversationCacheMetadata;
  messages: ChatMessage[];
  records?: readonly JournalRecord[];
  port: CloudConversationCachePort;
  isCurrent?: () => boolean;
}): Promise<void> => {
  const current = args.isCurrent ?? (() => true);
  if (!current()) return;
  await args.port.clearMetadata();
  if (!current()) return;
  await args.port.synchronizeMessages(args.messages, current);
  if (!current()) return;
  if (args.port.synchronizeRecords) {
    await args.port.synchronizeRecords(
      args.records
        ? encodeCloudJournalTail(args.records, args.metadata.headSeq)
        : null,
    );
    if (!current()) return;
  }
  await args.port.saveMetadata(args.metadata);
};

export const rebuildMobileCloudConversationCache = async (args: {
  metadata: CloudConversationCacheMetadata;
  messages: ChatMessage[];
  records?: readonly JournalRecord[];
  isCurrent?: () => boolean;
}): Promise<void> =>
  rebuildCloudConversationCache({
    ...args,
    port: {
      clearMetadata: () =>
        saveChatSyncState("cloud", { conversationId: null, cursor: null }),
      synchronizeMessages: (messages, current) =>
        synchronizeChatMessages("cloud", messages, current),
      synchronizeRecords: (encoded) => saveCloudJournalCache("cloud", encoded),
      saveMetadata: (metadata) =>
        saveChatSyncState("cloud", {
          conversationId: metadata.conversationId,
          cursor: encodeCloudConversationCacheMetadata(metadata),
        }),
    },
  });

export type CloudConversationCacheAuthority = Pick<
  CloudConversationCacheMetadata,
  "accountScope" | "ownerGeneration" | "conversationId" | "socketOrigin"
>;

export const cloudConversationCacheMatches = (
  metadata: CloudConversationCacheMetadata,
  authority: CloudConversationCacheAuthority,
): boolean =>
  metadata.accountScope === authority.accountScope &&
  metadata.ownerGeneration === authority.ownerGeneration &&
  metadata.conversationId === authority.conversationId &&
  metadata.socketOrigin === authority.socketOrigin;

export const readCloudConversationCache = async (args: {
  authority: CloudConversationCacheAuthority;
  port: CloudConversationCacheReadPort;
}): Promise<ChatMessage[] | null> => {
  const metadata = decodeCloudConversationCacheMetadata(
    await args.port.loadMetadata(),
  );
  if (!metadata || !cloudConversationCacheMatches(metadata, args.authority)) {
    return null;
  }
  const messages = await args.port.loadMessages();
  return messages.length > 0 ? messages : null;
};

const mobileCacheReadPort: CloudConversationCacheReadPort = {
  loadMetadata: async () => (await loadChatSyncState("cloud")).cursor,
  loadMessages: async () => (await loadRecentChatMessages("cloud")).messages,
  loadRecords: () => loadCloudJournalCache("cloud"),
};

export const readMobileCloudConversationCache = async (
  authority: CloudConversationCacheAuthority,
): Promise<ChatMessage[] | null> =>
  readCloudConversationCache({ authority, port: mobileCacheReadPort });

export const readCloudJournalCache = async (args: {
  authority: CloudConversationCacheAuthority;
  port: CloudConversationCacheReadPort;
}): Promise<CloudJournalSeed | null> => {
  if (!args.port.loadRecords) return null;
  const metadata = decodeCloudConversationCacheMetadata(
    await args.port.loadMetadata(),
  );
  if (!metadata || !cloudConversationCacheMatches(metadata, args.authority)) {
    return null;
  }
  const records = decodeCloudJournalTail(await args.port.loadRecords());
  if (!records || records[records.length - 1]!.seq !== metadata.headSeq) {
    return null;
  }
  return {
    epoch: metadata.epoch,
    headSeq: metadata.headSeq,
    floorSeq: metadata.floorSeq,
    records,
  };
};

export const readMobileCloudJournalCache = async (
  authority: CloudConversationCacheAuthority,
): Promise<CloudJournalSeed | null> =>
  readCloudJournalCache({ authority, port: mobileCacheReadPort });
