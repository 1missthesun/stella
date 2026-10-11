import { describe, expect, test } from "bun:test";
import {
  encodeCloudConversationCacheMetadata,
  readCloudConversationCache,
  rebuildCloudConversationCache,
  type CloudConversationCacheMetadata,
} from "../cloud-conversation-cache";
import type { ChatMessage } from "../../types";

const identity = {
  accountScope: "account:user-1",
  expectedSubject: "user-1",
  identityKey: "account:user-1:session:session-1",
  revision: 4,
};

const metadata: CloudConversationCacheMetadata = {
  version: 1,
  accountScope: identity.accountScope,
  ownerGeneration: "owner-generation-1",
  socketOrigin: "wss://builder.example",
  conversationId: "conversation-stable",
  epoch: 7,
  headSeq: 2,
  floorSeq: 0,
};

const remoteMessages: ChatMessage[] = [
  {
    id: "exec:one",
    role: "user",
    text: "hello",
    sequence: 1,
  },
  {
    id: "cloud:turn:message:2",
    requestId: "exec:one",
    role: "assistant",
    text: "hi",
    sequence: 2,
  },
];

describe("mobile cloud canonical hydration", () => {
  test("metadata commits last and stale rebuilds cannot publish authority", async () => {
    const calls: string[] = [];
    let current = true;
    await rebuildCloudConversationCache({
      metadata,
      messages: remoteMessages,
      isCurrent: () => current,
      port: {
        clearMetadata: async () => {
          calls.push("clear-metadata");
        },
        synchronizeMessages: async () => {
          calls.push("synchronize-messages");
          current = false;
        },
        saveMetadata: async () => {
          calls.push("save-metadata");
        },
      },
    });

    expect(calls).toEqual(["clear-metadata", "synchronize-messages"]);
  });

  test("canonical rebuild removes optimistic cache rows after local cache loss", async () => {
    let localMessages: ChatMessage[] = [
      {
        id: "local-optimistic",
        role: "user",
        text: "must not become history",
        queued: true,
      },
      {
        id: "local-placeholder",
        role: "assistant",
        requestId: "local-optimistic",
        text: "",
      },
    ];
    let localMetadata: CloudConversationCacheMetadata | null = {
      ...metadata,
      ownerGeneration: "stale-generation",
    };

    await rebuildCloudConversationCache({
      metadata,
      messages: remoteMessages,
      port: {
        clearMetadata: async () => {
          localMetadata = null;
        },
        synchronizeMessages: async (messages) => {
          localMessages = messages.map((message) => ({ ...message }));
        },
        saveMetadata: async (next) => {
          localMetadata = { ...next };
        },
      },
    });

    expect(localMessages).toEqual(remoteMessages);
    expect(
      localMessages.some((message) => message.id === "local-optimistic"),
    ).toBe(false);
    expect(localMetadata).toEqual(metadata);
  });
});

describe("mobile cloud cache cold-start read", () => {
  const authority = {
    accountScope: metadata.accountScope,
    ownerGeneration: metadata.ownerGeneration,
    conversationId: metadata.conversationId,
    socketOrigin: metadata.socketOrigin,
  };

  test("returns the committed projection when the fence matches", async () => {
    let messagesRead = 0;
    const cached = await readCloudConversationCache({
      authority,
      port: {
        loadMetadata: async () =>
          encodeCloudConversationCacheMetadata(metadata),
        loadMessages: async () => {
          messagesRead += 1;
          return remoteMessages.map((message) => ({ ...message }));
        },
      },
    });
    expect(cached).toEqual(remoteMessages);
    expect(messagesRead).toBe(1);
  });

  test("refuses another account, owner generation, or deployment without reading rows", async () => {
    for (const stale of [
      { ...metadata, accountScope: "account:user-2" },
      { ...metadata, ownerGeneration: "owner-generation-0" },
      { ...metadata, conversationId: "conversation-other" },
      { ...metadata, socketOrigin: "wss://elsewhere.example" },
    ]) {
      let messagesRead = 0;
      const cached = await readCloudConversationCache({
        authority,
        port: {
          loadMetadata: async () => encodeCloudConversationCacheMetadata(stale),
          loadMessages: async () => {
            messagesRead += 1;
            return remoteMessages;
          },
        },
      });
      expect(cached).toBeNull();
      expect(messagesRead).toBe(0);
    }
  });

  test("a missing or half-written cache and an empty snapshot yield nothing", async () => {
    expect(
      await readCloudConversationCache({
        authority,
        port: {
          loadMetadata: async () => null,
          loadMessages: async () => remoteMessages,
        },
      }),
    ).toBeNull();
    expect(
      await readCloudConversationCache({
        authority,
        port: {
          loadMetadata: async () =>
            encodeCloudConversationCacheMetadata(metadata),
          loadMessages: async () => [],
        },
      }),
    ).toBeNull();
  });
});
