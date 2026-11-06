import type { CloudExecutionSelection } from "@stella/contracts/agent-engine";
import {
  parseCloudTurnContext,
  type CloudTurnContext,
} from "@stella/contracts/turn-plane/turn-start";
import { isAccountProviderId } from "@stella/contracts/backend/providers";
import { REASONING_EFFORT_LEVELS } from "@stella/contracts/reasoning-effort";
import type { JournalRecord } from "@stella/contracts/conversation-protocol";
import type { CloudAttachment } from "./cloud-composer-store";
import type { DesktopExecutionTarget } from "../execution-placement/execution-target-store";
import {
  transitionSend,
  type NotSentReason,
  type SendEvent,
  type SendState,
} from "@stella/contracts/send-state";
import { isWebShell } from "./cloud-composer-store";

export type CloudConversationOutboxAuthority = {
  accountScope: string;
  ownerGeneration: string;
};

export type PendingCloudTurnSubmission = {
  requestedConversationId: string | null;
  prompt: string;
  imagePaths: readonly string[];
  context?: CloudTurnContext;
  attachments: readonly CloudAttachment[];
  /**
   * Browser uploads still landing when the message was sent. The turn is
   * dispatched once they finish, with their files added to `attachments`.
   */
  uploadIds?: readonly string[];
  locale: string | null;
  execution: CloudExecutionSelection | null;
  executionTarget?: DesktopExecutionTarget;
};

export type PendingPrompt = {
  accountScope: string;
  ownerGeneration: string;
  clientMsgId: string;
  text: string;
  createdAtMs: number;
  conversationId: string | null;
  turnId: string | null;
  dispatchId: string | null;
  send: SendState;
  durable: boolean;
  submission: PendingCloudTurnSubmission;
};

export type CloudConversationOutboxStorage = Pick<
  Storage,
  "length" | "key" | "getItem" | "setItem" | "removeItem"
>;

const STORAGE_PREFIX = "stella:cloud-conversation-outbox:v1:";
const MAX_CONVERSATION_ENTRIES = 32;
const FAILED_ENTRY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRY_BYTES = 256_000;
const MAX_SCOPE_CHARS = 512;
const MAX_GENERATION_CHARS = 512;
const MAX_CONVERSATION_ID_CHARS = 512;
const MAX_CLIENT_MSG_ID_CHARS = 64;
const MAX_PROMPT_CHARS = 8_000;
const MAX_ERROR_CHARS = 2_000;
const CLIENT_MSG_ID_PATTERN = /^[A-Za-z0-9._:-]{8,64}$/;

type PersistedPendingPrompt = Omit<PendingPrompt, "durable">;

type PersistedEnvelope = {
  version: 2;
  entry: PersistedPendingPrompt;
};

const NOT_SENT_REASONS = new Set<string>([
  "storage",
  "network",
  "rejected",
  "attachment",
  "turn_failed",
]);

const parsePersistedSend = (value: unknown): SendState | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  switch (candidate.kind) {
    case "queued":
    case "admitting":
    case "dispatched":
      return typeof candidate.cancelRequested === "boolean"
        ? { kind: candidate.kind, cancelRequested: candidate.cancelRequested }
        : null;
    case "not_sent":
      return typeof candidate.reason === "string" &&
        NOT_SENT_REASONS.has(candidate.reason) &&
        isBoundedString(candidate.message, MAX_ERROR_CHARS)
        ? {
            kind: "not_sent",
            reason: candidate.reason as NotSentReason,
            message: candidate.message,
          }
        : null;
    default:
      return null;
  }
};

const sendFromV1 = (candidate: Record<string, unknown>): SendState | null => {
  if (
    typeof candidate.cancelRequested !== "boolean" ||
    typeof candidate.retryOnNextActivation !== "boolean" ||
    !isNullableBoundedString(candidate.error, MAX_ERROR_CHARS)
  ) {
    return null;
  }
  if (candidate.error) {
    return {
      kind: "not_sent",
      reason: candidate.retryOnNextActivation ? "network" : "rejected",
      message: candidate.error,
    };
  }
  return candidate.dispatchId
    ? { kind: "dispatched", cancelRequested: candidate.cancelRequested }
    : { kind: "queued", cancelRequested: candidate.cancelRequested };
};

const isBoundedString = (
  value: unknown,
  maximum: number,
  allowEmpty = false,
): value is string =>
  typeof value === "string" &&
  (allowEmpty || value.length > 0) &&
  value.length <= maximum;

const isNullableBoundedString = (
  value: unknown,
  maximum: number,
): value is string | null => value === null || isBoundedString(value, maximum);

const EXECUTION_ENGINES = new Set(["stella", "anthropic", "chatgpt"]);
/** Queued items written before the current ladder still carry legacy values. */
const REASONING_EFFORTS = new Set<string>([
  "none",
  ...REASONING_EFFORT_LEVELS,
  "default",
  "minimal",
]);

const isExecution = (value: unknown): value is CloudExecutionSelection => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isBoundedString(candidate.engine, 32) &&
    (EXECUTION_ENGINES.has(candidate.engine)
      ? candidate.provider === candidate.engine
      : candidate.engine === "provider" &&
        isAccountProviderId(candidate.provider)) &&
    isBoundedString(candidate.model, 192) &&
    isBoundedString(candidate.reasoningEffort, 32) &&
    REASONING_EFFORTS.has(candidate.reasoningEffort)
  );
};

const isAttachment = (value: unknown): value is CloudAttachment => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isBoundedString(candidate.path, 512) &&
    isBoundedString(candidate.name, 512) &&
    typeof candidate.sizeBytes === "number" &&
    Number.isSafeInteger(candidate.sizeBytes) &&
    candidate.sizeBytes >= 0 &&
    (candidate.contentType === undefined ||
      isBoundedString(candidate.contentType, 128))
  );
};

const isExecutionTarget = (value: unknown): value is DesktopExecutionTarget => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.mode === "automatic" ||
    candidate.mode === "cloud" ||
    (candidate.mode === "device" && isBoundedString(candidate.deviceId, 256))
  );
};

const isSubmission = (value: unknown): value is PendingCloudTurnSubmission => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isNullableBoundedString(
      candidate.requestedConversationId,
      MAX_CONVERSATION_ID_CHARS,
    ) &&
    isBoundedString(candidate.prompt, MAX_PROMPT_CHARS, true) &&
    Array.isArray(candidate.imagePaths) &&
    candidate.imagePaths.length <= 4 &&
    candidate.imagePaths.every((path) => isBoundedString(path, 512)) &&
    Array.isArray(candidate.attachments) &&
    candidate.attachments.length <= 32 &&
    candidate.attachments.every(isAttachment) &&
    (candidate.context === undefined ||
      parseCloudTurnContext(candidate.context) !== null) &&
    (candidate.uploadIds === undefined ||
      (Array.isArray(candidate.uploadIds) &&
        candidate.uploadIds.length <= 32 &&
        candidate.uploadIds.every((id) => isBoundedString(id, 128)))) &&
    isNullableBoundedString(candidate.locale, 64) &&
    (candidate.execution === null || isExecution(candidate.execution)) &&
    (candidate.executionTarget === undefined ||
      isExecutionTarget(candidate.executionTarget))
  );
};

const parseEnvelope = (raw: string): PendingPrompt | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return null;
  const envelope = parsed as Record<string, unknown>;
  if ((envelope.version !== 1 && envelope.version !== 2) || !envelope.entry) {
    return null;
  }
  const candidate = envelope.entry as Record<string, unknown>;
  const send =
    envelope.version === 1
      ? candidate.deliveryAcknowledged === false
        ? sendFromV1(candidate)
        : null
      : parsePersistedSend(candidate.send);
  if (
    !send ||
    !isBoundedString(candidate.accountScope, MAX_SCOPE_CHARS) ||
    !isBoundedString(candidate.ownerGeneration, MAX_GENERATION_CHARS) ||
    !isBoundedString(candidate.clientMsgId, MAX_CLIENT_MSG_ID_CHARS) ||
    !CLIENT_MSG_ID_PATTERN.test(candidate.clientMsgId) ||
    !isBoundedString(candidate.text, MAX_PROMPT_CHARS, true) ||
    typeof candidate.createdAtMs !== "number" ||
    !Number.isSafeInteger(candidate.createdAtMs) ||
    candidate.createdAtMs < 0 ||
    !isNullableBoundedString(
      candidate.conversationId,
      MAX_CONVERSATION_ID_CHARS,
    ) ||
    !isNullableBoundedString(candidate.turnId, 512) ||
    !isNullableBoundedString(candidate.dispatchId, 512) ||
    !isSubmission(candidate.submission)
  ) {
    return null;
  }
  return {
    accountScope: candidate.accountScope,
    ownerGeneration: candidate.ownerGeneration,
    clientMsgId: candidate.clientMsgId,
    text: candidate.text,
    createdAtMs: candidate.createdAtMs,
    conversationId: candidate.conversationId,
    turnId: candidate.turnId,
    dispatchId: candidate.dispatchId,
    send,
    durable: true,
    submission: candidate.submission,
  };
};

const persistedEntry = (entry: PendingPrompt): PersistedPendingPrompt => ({
  accountScope: entry.accountScope,
  ownerGeneration: entry.ownerGeneration,
  clientMsgId: entry.clientMsgId,
  text: entry.text,
  createdAtMs: entry.createdAtMs,
  conversationId: entry.conversationId,
  turnId: entry.turnId,
  dispatchId: entry.dispatchId,
  send: entry.send,
  submission: entry.submission,
});

const encodedKeyPart = (value: string): string => encodeURIComponent(value);

/**
 * One record per localStorage key prevents two browser tabs from losing each
 * other's sends through a read/modify/write of one shared JSON array.
 */
export const cloudConversationOutboxStorageKey = (
  entry: Pick<
    PendingPrompt,
    "accountScope" | "ownerGeneration" | "clientMsgId" | "submission"
  >,
): string =>
  `${STORAGE_PREFIX}${encodedKeyPart(entry.accountScope)}/${encodedKeyPart(
    entry.ownerGeneration,
  )}/${
    entry.submission.requestedConversationId === null
      ? "new"
      : `id-${encodedKeyPart(entry.submission.requestedConversationId)}`
  }/${entry.clientMsgId}`;

const authorityMatches = (
  entry: PendingPrompt,
  authority: CloudConversationOutboxAuthority,
): boolean =>
  entry.accountScope === authority.accountScope &&
  entry.ownerGeneration === authority.ownerGeneration;

const clientIdentityMatches = (
  entry: PendingPrompt,
  authority: CloudConversationOutboxAuthority,
  clientMsgId: string,
): boolean =>
  authorityMatches(entry, authority) && entry.clientMsgId === clientMsgId;

const frozenIntentJson = (entry: PendingPrompt): string =>
  JSON.stringify({
    accountScope: entry.accountScope,
    ownerGeneration: entry.ownerGeneration,
    clientMsgId: entry.clientMsgId,
    text: entry.text,
    submission: entry.submission,
  });

const serialize = (entry: PendingPrompt): string => {
  const raw = JSON.stringify({
    version: 2,
    entry: persistedEntry(entry),
  } satisfies PersistedEnvelope);
  if (!parseEnvelope(raw)) {
    throw new Error("That message cannot be saved for reliable delivery.");
  }
  if (raw.length > MAX_ENTRY_BYTES) {
    throw new Error("That message is too large to save for reliable delivery.");
  }
  return raw;
};

const browserStorage = (): CloudConversationOutboxStorage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

const storageKeys = (storage: CloudConversationOutboxStorage): string[] => {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
  }
  return keys;
};

const sameConversation = (a: PendingPrompt, b: PendingPrompt): boolean =>
  authorityMatches(a, b) &&
  a.submission.requestedConversationId === b.submission.requestedConversationId;

export const createCloudConversationOutbox = (
  getStorage: () => CloudConversationOutboxStorage | null,
  now: () => number = Date.now,
) => {
  const requireStorage = (): CloudConversationOutboxStorage => {
    const storage = getStorage();
    if (!storage) {
      throw new Error(
        "Reliable message storage is unavailable. This message was not sent.",
      );
    }
    return storage;
  };

  const readAll = (): PendingPrompt[] => {
    const storage = requireStorage();
    const entries: PendingPrompt[] = [];
    for (const key of storageKeys(storage)) {
      const raw = storage.getItem(key);
      const entry = raw === null ? null : parseEnvelope(raw);
      if (!entry || cloudConversationOutboxStorageKey(entry) !== key) {
        storage.removeItem(key);
        continue;
      }
      entries.push(entry);
    }
    return entries;
  };

  return {
    activate(authority: CloudConversationOutboxAuthority): PendingPrompt[] {
      const storage = requireStorage();
      const current: PendingPrompt[] = [];
      const byClientMsgId = new Map<string, PendingPrompt>();
      const expiredBefore = now() - FAILED_ENTRY_TTL_MS;
      for (const entry of readAll()) {
        if (entry.send.kind === "not_sent" && entry.createdAtMs < expiredBefore) {
          storage.removeItem(cloudConversationOutboxStorageKey(entry));
        } else if (authorityMatches(entry, authority)) {
          if (byClientMsgId.has(entry.clientMsgId)) {
            throw new Error(
              "Reliable message storage contains conflicting prior deliveries.",
            );
          }
          byClientMsgId.set(entry.clientMsgId, entry);
          current.push(entry);
        } else {
          storage.removeItem(cloudConversationOutboxStorageKey(entry));
        }
      }
      return current.sort((a, b) => a.createdAtMs - b.createdAtMs);
    },

    clear(): void {
      const storage = requireStorage();
      for (const key of storageKeys(storage)) storage.removeItem(key);
    },

    purgeOtherAccounts(accountScope: string): void {
      const storage = requireStorage();
      for (const entry of readAll()) {
        if (entry.accountScope !== accountScope) {
          storage.removeItem(cloudConversationOutboxStorageKey(entry));
        }
      }
    },

    enqueue(entry: PendingPrompt): { entry: PendingPrompt; pruned: PendingPrompt[] } {
      const storage = requireStorage();
      const all = readAll();
      const collision = all.find(
        (candidate) =>
          authorityMatches(candidate, entry) &&
          candidate.clientMsgId === entry.clientMsgId,
      );
      if (collision) {
        if (frozenIntentJson(collision) !== frozenIntentJson(entry)) {
          throw new Error(
            "That reliable message id is already bound to a different request.",
          );
        }
        return { entry: collision, pruned: [] };
      }
      const conversation = all
        .filter((candidate) => sameConversation(candidate, entry))
        .sort((a, b) => a.createdAtMs - b.createdAtMs);
      const failed = conversation.filter(
        (candidate) => candidate.send.kind === "not_sent",
      );
      const overflow = conversation.length + 1 - MAX_CONVERSATION_ENTRIES;
      if (overflow > failed.length) {
        throw new Error(
          "Too many messages are waiting for reliable delivery. Retry after they finish.",
        );
      }
      const pruned = overflow > 0 ? failed.slice(0, overflow) : [];
      const durable = { ...entry, durable: true };
      const raw = serialize(durable);
      for (const stale of pruned) {
        storage.removeItem(cloudConversationOutboxStorageKey(stale));
      }
      storage.setItem(cloudConversationOutboxStorageKey(durable), raw);
      return { entry: durable, pruned };
    },

    update(entry: PendingPrompt): PendingPrompt | null {
      const storage = requireStorage();
      const key = cloudConversationOutboxStorageKey(entry);
      const existingRaw = storage.getItem(key);
      const existing = existingRaw === null ? null : parseEnvelope(existingRaw);
      if (
        !existing ||
        !clientIdentityMatches(existing, entry, entry.clientMsgId) ||
        frozenIntentJson(existing) !== frozenIntentJson(entry)
      ) {
        return null;
      }
      const durable = { ...entry, durable: true };
      storage.setItem(key, serialize(durable));
      return durable;
    },

    remove(entry: PendingPrompt): boolean {
      const storage = requireStorage();
      const key = cloudConversationOutboxStorageKey(entry);
      const existingRaw = storage.getItem(key);
      const existing = existingRaw === null ? null : parseEnvelope(existingRaw);
      if (
        !existing ||
        !clientIdentityMatches(existing, entry, entry.clientMsgId) ||
        frozenIntentJson(existing) !== frozenIntentJson(entry)
      ) {
        return false;
      }
      storage.removeItem(key);
      return true;
    },

    list(): PendingPrompt[] {
      return readAll().sort((a, b) => a.createdAtMs - b.createdAtMs);
    },
  };
};

export const cloudConversationOutbox =
  createCloudConversationOutbox(browserStorage);

const pendingListeners = new Set<() => void>();
let pending: readonly PendingPrompt[] = [];
const EMPTY_PENDING: readonly PendingPrompt[] = [];
const inFlightPending = new Set<string>();
let activePendingAuthorityKey: string | null = null;
let activePendingAuthorityReady = false;

const authorityKey = (authority: CloudConversationOutboxAuthority): string =>
  `${authority.accountScope}\u0000${authority.ownerGeneration}`;

const pendingKey = (
  authority: CloudConversationOutboxAuthority,
  clientMsgId: string,
): string => `${authorityKey(authority)}\u0000${clientMsgId}`;

const ownsPending = (
  entry: PendingPrompt,
  authority: CloudConversationOutboxAuthority,
): boolean =>
  entry.accountScope === authority.accountScope &&
  entry.ownerGeneration === authority.ownerGeneration;

const reliableStorageError = (error: unknown): string =>
  error instanceof Error && error.message
    ? error.message
    : "Reliable message storage is unavailable. This message was not sent.";

const frozenSubmission = (
  submission: PendingCloudTurnSubmission,
): PendingCloudTurnSubmission =>
  Object.freeze({
    requestedConversationId: submission.requestedConversationId,
    prompt: submission.prompt,
    imagePaths: Object.freeze([...submission.imagePaths]),
    attachments: Object.freeze(
      submission.attachments.map((attachment) =>
        Object.freeze({ ...attachment }),
      ),
    ),
    ...(submission.uploadIds?.length
      ? { uploadIds: Object.freeze([...submission.uploadIds]) }
      : {}),
    locale: submission.locale,
    execution: submission.execution
      ? Object.freeze({ ...submission.execution })
      : null,
    ...(submission.context ? { context: submission.context } : {}),
    ...(submission.executionTarget
      ? { executionTarget: Object.freeze({ ...submission.executionTarget }) }
      : {}),
  });

const withoutEntries = (
  entries: readonly PendingPrompt[],
  removed: readonly PendingPrompt[],
): readonly PendingPrompt[] =>
  removed.length === 0
    ? entries
    : entries.filter(
        (entry) =>
          !removed.some(
            (gone) =>
              authorityMatches(entry, gone) && entry.clientMsgId === gone.clientMsgId,
          ),
      );

const emitPending = (next: readonly PendingPrompt[]): void => {
  pending = next;
  for (const listener of pendingListeners) listener();
};

/**
 * Optimistic prompts. A prompt is echoed the instant the user sends it and
 * replaced by the canonical journal row when it arrives — resolved on either
 * `clientMsgId` (the key the mutation threads to the DO) or `turnId` (which
 * the mutation returns directly). Two keys because either one alone leaves a
 * ghost bubble if a link in the chain drops its field.
 */
export const pendingPrompts = {
  subscribe(listener: () => void): () => void {
    pendingListeners.add(listener);
    return () => pendingListeners.delete(listener);
  },
  getSnapshot(): readonly PendingPrompt[] {
    return pending;
  },
  getServerSnapshot(): readonly PendingPrompt[] {
    return EMPTY_PENDING;
  },
  add(
    authority: CloudConversationOutboxAuthority,
    clientMsgId: string,
    text: string,
    conversationId: string | null,
    submission: PendingCloudTurnSubmission,
  ): PendingPrompt {
    const base: PendingPrompt = {
      ...authority,
      clientMsgId,
      text,
      createdAtMs: Date.now(),
      conversationId,
      turnId: null,
      dispatchId: null,
      send: { kind: "persisting" },
      durable: false,
      submission: frozenSubmission(submission),
    };
    const { entry, current } = persistNew(
      base,
      activePendingAuthorityReady &&
        activePendingAuthorityKey === authorityKey(authority)
        ? null
        : "Stella is still verifying reliable delivery for this account. This message was not sent.",
    );
    emitPending([...current, entry]);
    return entry;
  },
  find(
    authority: CloudConversationOutboxAuthority,
    clientMsgId: string,
  ): PendingPrompt | null {
    return (
      pending.find(
        (entry) =>
          ownsPending(entry, authority) && entry.clientMsgId === clientMsgId,
      ) ?? null
    );
  },
  transition(
    authority: CloudConversationOutboxAuthority,
    clientMsgId: string,
    event: SendEvent,
    bindings: Partial<Pick<PendingPrompt, "conversationId" | "turnId" | "dispatchId">> = {},
  ): PendingPrompt | null {
    const found = this.find(authority, clientMsgId);
    if (!found) return null;
    const send = transitionSend(found.send, event);
    if (!send) return null;
    const settled = send.kind === "settled";
    let next: PendingPrompt = { ...found, ...bindings, send };
    if (found.durable) {
      try {
        if (settled) {
          if (!cloudConversationOutbox.remove(found)) return null;
          next = { ...next, durable: false };
        } else {
          const persisted = cloudConversationOutbox.update(next);
          if (!persisted) return null;
          next = persisted;
        }
      } catch (error) {
        if (settled) return null;
        next = {
          ...next,
          send: { kind: "not_sent", reason: "storage", message: reliableStorageError(error) },
        };
      }
    }
    replacePending(authority, clientMsgId, next);
    return next;
  },
  bind(
    authority: CloudConversationOutboxAuthority,
    clientMsgId: string,
    conversationId: string,
    turnId: string,
  ): void {
    const found = this.find(authority, clientMsgId);
    if (!found) return;
    let next: PendingPrompt = { ...found, conversationId, turnId };
    if (found.durable) {
      try {
        next = cloudConversationOutbox.update(next) ?? found;
      } catch {
        next = { ...found, conversationId, turnId };
      }
    }
    replacePending(authority, clientMsgId, next);
  },
  drop(authority: CloudConversationOutboxAuthority, clientMsgId: string): void {
    const found = this.find(authority, clientMsgId);
    if (!found) return;
    if (found.durable) {
      try {
        cloudConversationOutbox.remove(found);
      } catch (error) {
        this.transition(authority, clientMsgId, {
          type: "failed",
          reason: "storage",
          message: reliableStorageError(error),
        });
        return;
      }
    }
    const next = pending.filter(
      (entry) =>
        !ownsPending(entry, authority) || entry.clientMsgId !== clientMsgId,
    );
    if (next.length !== pending.length) emitPending(next);
    inFlightPending.delete(pendingKey(authority, clientMsgId));
  },
  prepareRetry(
    authority: CloudConversationOutboxAuthority,
    clientMsgId: string,
  ): PendingPrompt | null {
    const found = this.find(authority, clientMsgId);
    const send = found && transitionSend(found.send, { type: "retry" });
    if (!found || !send) return null;
    const candidate = { ...found, send };
    if (!found.durable) {
      const { entry, current } = persistNew(candidate, null);
      emitPending(current);
      replacePending(authority, clientMsgId, entry);
      return entry.send.kind === "queued" ? entry : null;
    }
    const queued = transitionSend(send, { type: "persisted" })!;
    try {
      const durable = cloudConversationOutbox.update({ ...candidate, send: queued });
      if (!durable) return null;
      replacePending(authority, clientMsgId, durable);
      return durable;
    } catch (error) {
      replacePending(authority, clientMsgId, {
        ...found,
        send: { kind: "not_sent", reason: "storage", message: reliableStorageError(error) },
      });
      return null;
    }
  },
  resolve(
    authority: CloudConversationOutboxAuthority,
    record: JournalRecord,
  ): void {
    if (!pending.length) return;
    const clientMsgId =
      record.kind === "message" ? record.clientMsgId : undefined;
    const acknowledged = pending.filter(
      (entry) =>
        ownsPending(entry, authority) &&
        ((clientMsgId !== undefined && entry.clientMsgId === clientMsgId) ||
          (clientMsgId !== undefined && entry.dispatchId === clientMsgId) ||
          (entry.turnId !== null && entry.turnId === record.turnId)),
    );
    if (!acknowledged.length) return;
    const removed = new Set<string>();
    for (const entry of acknowledged) {
      try {
        if (!entry.durable || cloudConversationOutbox.remove(entry)) {
          removed.add(entry.clientMsgId);
          inFlightPending.delete(pendingKey(authority, entry.clientMsgId));
        }
      } catch {
        // Keep the durable row. Exact backend dedupe makes a later replay safe,
        // while deleting it only in memory could lose the required retry.
      }
    }
    const next = pending.filter(
      (entry) =>
        !ownsPending(entry, authority) || !removed.has(entry.clientMsgId),
    );
    if (next.length !== pending.length) emitPending(next);
  },
  retainAccountScope(accountScope: string): void {
    activePendingAuthorityKey = null;
    activePendingAuthorityReady = false;
    inFlightPending.clear();
    try {
      cloudConversationOutbox.purgeOtherAccounts(accountScope);
    } catch {
      // Generation activation retries the synchronous purge before any send.
    }
    const next = pending.filter((entry) => entry.accountScope === accountScope);
    if (next.length !== pending.length) emitPending(next);
  },
  activateAuthority(authority: CloudConversationOutboxAuthority): boolean {
    const nextAuthorityKey = authorityKey(authority);
    if (
      activePendingAuthorityReady &&
      activePendingAuthorityKey === nextAuthorityKey
    ) {
      return true;
    }
    activePendingAuthorityKey = nextAuthorityKey;
    activePendingAuthorityReady = false;
    inFlightPending.clear();
    if (!isWebShell()) {
      try {
        cloudConversationOutbox.clear();
      } catch {
        // The desktop never sends through this outbox; leftover rows stay inert.
      }
      activePendingAuthorityReady = true;
      emitPending(EMPTY_PENDING);
      return true;
    }
    try {
      const hydrated = cloudConversationOutbox
        .activate(authority)
        .map((entry) => {
          const resumed = resumedOnActivation(entry.send);
          if (!resumed) return entry;
          return cloudConversationOutbox.update({ ...entry, send: resumed }) ?? entry;
        });
      activePendingAuthorityReady = true;
      const stored = new Set(hydrated.map((entry) => entry.clientMsgId));
      const inMemoryOnly = pending.filter(
        (entry) =>
          !entry.durable &&
          ownsPending(entry, authority) &&
          !stored.has(entry.clientMsgId),
      );
      emitPending(
        [...hydrated, ...inMemoryOnly].sort((a, b) => a.createdAtMs - b.createdAtMs),
      );
      return true;
    } catch {
      emitPending(EMPTY_PENDING);
      return false;
    }
  },
  isAuthorityReady(authority: CloudConversationOutboxAuthority): boolean {
    return (
      activePendingAuthorityReady &&
      activePendingAuthorityKey === authorityKey(authority)
    );
  },
  claimDispatch(
    authority: CloudConversationOutboxAuthority,
    clientMsgId: string,
  ): boolean {
    const entry = this.find(authority, clientMsgId);
    const key = pendingKey(authority, clientMsgId);
    if (
      !entry?.durable ||
      (entry.send.kind !== "queued" && entry.send.kind !== "dispatched") ||
      !this.isAuthorityReady(authority) ||
      inFlightPending.has(key)
    ) {
      return false;
    }
    if (
      entry.send.kind === "queued" &&
      this.transition(authority, clientMsgId, { type: "claimed" })?.send.kind !== "admitting"
    ) {
      return false;
    }
    inFlightPending.add(key);
    return true;
  },
  releaseDispatch(
    authority: CloudConversationOutboxAuthority,
    clientMsgId: string,
  ): void {
    inFlightPending.delete(pendingKey(authority, clientMsgId));
    if (this.find(authority, clientMsgId)?.send.kind === "admitting") {
      this.transition(authority, clientMsgId, { type: "released" });
    }
  },
};

const resumedOnActivation = (send: SendState): SendState | null => {
  if (send.kind === "admitting") return transitionSend(send, { type: "released" });
  if (send.kind === "not_sent" && send.reason === "network") {
    const retry = transitionSend(send, { type: "retry" });
    return retry && transitionSend(retry, { type: "persisted" });
  }
  return null;
};

const replacePending = (
  authority: CloudConversationOutboxAuthority,
  clientMsgId: string,
  next: PendingPrompt,
): void => {
  emitPending(
    pending.map((entry) =>
      ownsPending(entry, authority) && entry.clientMsgId === clientMsgId
        ? next
        : entry,
    ),
  );
};

const persistNew = (
  entry: PendingPrompt,
  refusal: string | null,
): { entry: PendingPrompt; current: readonly PendingPrompt[] } => {
  const notSent = (message: string): PendingPrompt => ({
    ...entry,
    send: { kind: "not_sent", reason: "storage", message },
  });
  if (refusal) return { entry: notSent(refusal), current: pending };
  const send = transitionSend(entry.send, { type: "persisted" });
  if (!send) return { entry, current: pending };
  try {
    const queued = cloudConversationOutbox.enqueue({ ...entry, send });
    return { entry: queued.entry, current: withoutEntries(pending, queued.pruned) };
  } catch (error) {
    return { entry: notSent(reliableStorageError(error)), current: pending };
  }
};
