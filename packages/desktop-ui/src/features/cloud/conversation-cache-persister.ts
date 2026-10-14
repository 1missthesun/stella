import type { JournalRecord } from "@stella/contracts/conversation-protocol";
import type {
  CloudConversationCacheAuthority,
  CloudConversationCacheVersion,
} from "@stella/contracts/cloud-conversation-cache";
import { cloudCacheDelta } from "./cloud-cache-delta";
import {
  cloudConversationCacheClient,
  type RenderableCloudConversationCacheSnapshot,
} from "./cloud-conversation-cache-client";

export type ConversationCacheSnapshot = {
  epoch: number;
  headSeq: number;
  floorSeq: number;
  title: string;
  records: readonly JournalRecord[];
};

const CACHE_WRITE_IDLE_TIMEOUT_MS = 1_000;

const cacheVersionsEqual = (
  left: CloudConversationCacheVersion | null,
  right: CloudConversationCacheVersion | null,
): boolean =>
  left === right ||
  (left !== null &&
    right !== null &&
    left.epoch === right.epoch &&
    left.headSeq === right.headSeq &&
    left.floorSeq === right.floorSeq &&
    left.revision === right.revision);

const versionOf = (
  snapshot: RenderableCloudConversationCacheSnapshot | null,
): CloudConversationCacheVersion | null =>
  snapshot
    ? {
        epoch: snapshot.epoch,
        headSeq: snapshot.headSeq,
        floorSeq: snapshot.floorSeq,
        revision: snapshot.revision,
      }
    : null;

const whenIdle = (callback: () => void): (() => void) => {
  if (typeof requestIdleCallback === "function") {
    const handle = requestIdleCallback(callback, {
      timeout: CACHE_WRITE_IDLE_TIMEOUT_MS,
    });
    return () => cancelIdleCallback(handle);
  }
  const handle = setTimeout(callback, CACHE_WRITE_IDLE_TIMEOUT_MS);
  return () => clearTimeout(handle);
};

export class ConversationCachePersister {
  private readonly authority: CloudConversationCacheAuthority;
  private readonly isCurrent: () => boolean;
  private readonly snapshot: () => ConversationCacheSnapshot | null;
  private version: CloudConversationCacheVersion | null = null;
  private persistedRecords: readonly JournalRecord[] = [];
  private operationGeneration = 0;
  private cancelScheduled: (() => void) | null = null;
  private chain: Promise<void> = Promise.resolve();

  constructor(options: {
    authority: CloudConversationCacheAuthority;
    isCurrent: () => boolean;
    snapshot: () => ConversationCacheSnapshot | null;
  }) {
    this.authority = Object.freeze({ ...options.authority });
    this.isCurrent = options.isCurrent;
    this.snapshot = options.snapshot;
  }

  get generation(): number {
    return this.operationGeneration;
  }

  read(): Promise<RenderableCloudConversationCacheSnapshot | null> {
    return cloudConversationCacheClient.read(this.authority);
  }

  observe(cached: RenderableCloudConversationCacheSnapshot | null): void {
    this.version = versionOf(cached);
  }

  schedule(): void {
    if (this.cancelScheduled) return;
    const generation = this.operationGeneration;
    this.cancelScheduled = whenIdle(() => {
      this.cancelScheduled = null;
      this.chain = this.chain.then(() => this.persist(generation));
    });
  }

  retire(): void {
    this.operationGeneration += 1;
    this.cancelPending();
    this.version = null;
    this.persistedRecords = [];
  }

  purge(): void {
    this.retire();
    const authority = this.authority;
    this.chain = this.chain.then(async () => {
      await cloudConversationCacheClient.purgeConversation(authority);
    });
  }

  private cancelPending(): void {
    this.cancelScheduled?.();
    this.cancelScheduled = null;
  }

  private async persist(generation: number): Promise<void> {
    if (generation !== this.operationGeneration || !this.isCurrent()) return;
    const view = this.snapshot();
    if (!view) return;
    const records = [...view.records];
    const tail = records.at(-1)?.seq ?? -1;
    if (tail !== view.headSeq) return;
    let expected = this.version;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await cloudConversationCacheClient.replace({
        ...this.authority,
        expected,
        epoch: view.epoch,
        headSeq: view.headSeq,
        floorSeq: view.floorSeq,
        title: view.title,
        ...(expected?.epoch === view.epoch
          ? cloudCacheDelta(this.persistedRecords, records)
          : { records }),
      });
      if (generation !== this.operationGeneration || !this.isCurrent()) {
        return;
      }
      if (result.status === "applied") {
        this.version = result.version;
        this.persistedRecords = records;
        return;
      }
      if (result.status === "inactive") {
        const reactivated =
          await cloudConversationCacheClient.activateAuthority({
            accountScope: this.authority.accountScope,
            ownerGeneration: this.authority.ownerGeneration,
          });
        if (!reactivated || !this.isCurrent()) return;
        const currentVersion = versionOf(await this.read());
        if (
          currentVersion !== null &&
          !cacheVersionsEqual(currentVersion, expected)
        ) {
          return;
        }
        expected = currentVersion;
        this.version = currentVersion;
        continue;
      }
      if (result.current !== null) return;
      this.version = null;
      this.persistedRecords = [];
      expected = null;
    }
  }
}
