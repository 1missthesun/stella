// A view's versions, as its conversation carries them: each of Stella's `view` calls, each of a
// task's view cards, and each restore the user made (a restore is a view card too, so it is a new
// latest version: history is never rewritten, and a restore can itself be undone). Shared by every
// host (the Rune desktop, the web, the phone): the history list, previews of an older version, and
// the card a restore publishes.
import type { PublishViewArgs } from "@stella/contracts/backend/conversations";
import { VIEW_RESTORE_AUTHOR } from "@stella/contracts/view-card";
import { viewAuthorOf, viewFromToolEvent, viewOwnedBy, viewToolCallArgs, type ViewAuthor, type ViewToolEvent } from "./conversation";
import { viewLiveKey, viewSourceHash } from "./paths";
import type { ViewStorage } from "./session";

export type { ViewAuthor } from "./conversation";

/** One version of a view. */
export type ViewVersion = {
  /** Stable across devices: when it was written, and what it holds. */
  id: string;
  filePath: string;
  slug: string;
  title: string;
  source: string;
  createdAt: number;
  by: ViewAuthor;
};

export const viewVersionId = (createdAt: number, source: string): string => `${Math.max(0, Math.round(createdAt)).toString(36)}-${viewSourceHash(source)}`;

const slugOf = (filePath: string) => (filePath.split(/[\\/]/u).pop() ?? filePath).replace(/\.view\.(tsx|ts|jsx|js)$/iu, "");

const asRecord = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/**
 * Whether a `view` result reports problems (it was saved but doesn't compile, lint or render):
 * a broken draft the agent fixes next, so not a version anyone would go back to.
 */
export function viewResultHasProblems(payload: unknown): boolean {
  const p = asRecord(payload);
  const details = asRecord(p?.details) ?? asRecord(p?.result) ?? p;
  return Array.isArray(details?.problems) && details.problems.length > 0;
}

/** Every version of every view among `events` (one message's, in order), leaving out broken drafts. */
export function viewVersionsOf(events: readonly ViewToolEvent[]): ViewVersion[] {
  const calls = new Map<string, Record<string, unknown>>();
  const out: ViewVersion[] = [];
  for (const event of events) {
    const args = viewToolCallArgs(event);
    if (args) {
      if (event.requestId) calls.set(event.requestId, args);
      continue;
    }
    const view = viewFromToolEvent(event, event.requestId ? calls.get(event.requestId) : null);
    if (!view || viewResultHasProblems(event.payload)) continue;
    out.push({
      id: viewVersionId(view.createdAt, view.source),
      filePath: view.filePath,
      slug: view.slug ?? slugOf(view.filePath),
      title: view.title ?? slugOf(view.filePath),
      source: view.source,
      createdAt: view.createdAt,
      by: view.by ?? viewAuthorOf({}),
    });
  }
  return out;
}

type Message = { toolEvents?: readonly ViewToolEvent[] };

/**
 * The versions of each view, from what the conversations shown so far carry, plus the restores
 * made here that haven't come back with the conversation yet. A view is its `viewLiveKey`, so a
 * computer's file and the cloud's Drive copy of it share one history; every method takes either
 * path, and listeners hear the key.
 */
export class ViewHistory {
  private byFile = new Map<string, ViewVersion[]>();
  private conversations = new Map<string, string>();
  private pending = new Map<string, ViewVersion[]>();
  private scanned = new WeakMap<readonly ViewToolEvent[], ViewVersion[]>();
  private listeners = new Set<(filePath: string) => void>();
  private previews = new Map<string, string>();

  /** A conversation's messages, as the chat has them: adds the versions of each view they carry. */
  offerMessages(messages: readonly Message[], conversationId?: string | null) {
    const versions: ViewVersion[] = [];
    for (const message of messages) {
      const events = message.toolEvents;
      if (!events?.length) continue;
      let found = this.scanned.get(events);
      if (!found) {
        found = viewVersionsOf(events);
        this.scanned.set(events, found);
      }
      versions.push(...found);
    }
    this.offerVersions(versions, conversationId);
  }

  /** Versions from one conversation (in any order), merged by identity into each view's history. */
  offerVersions(versions: readonly ViewVersion[], conversationId?: string | null) {
    const grouped = new Map<string, ViewVersion[]>();
    for (const version of versions) {
      if (!viewOwnedBy(version, conversationId)) continue;
      const key = viewLiveKey(version.filePath);
      const list = grouped.get(key) ?? [];
      list.push(version);
      grouped.set(key, list);
    }
    for (const [filePath, list] of grouped) {
      if (conversationId) this.conversations.set(filePath, conversationId);
      const pending = this.pending.get(filePath);
      if (pending) {
        const seen = new Set(list.map((v) => v.id));
        const still = pending.filter((v) => !seen.has(v.id));
        if (still.length) this.pending.set(filePath, still);
        else this.pending.delete(filePath);
      }
      // What's offered adds to what's known (the chat's versions and the Apps list's newest alike).
      this.set(filePath, [...(this.byFile.get(filePath) ?? []), ...list]);
    }
  }

  /** A restore made here, shown until the conversation brings it back. */
  addPending(version: ViewVersion) {
    const key = viewLiveKey(version.filePath);
    this.pending.set(key, [...(this.pending.get(key) ?? []), version]);
    this.set(key, this.byFile.get(key) ?? []);
  }

  private set(filePath: string, list: readonly ViewVersion[]) {
    const merged = new Map<string, ViewVersion>();
    for (const version of [...list, ...(this.pending.get(filePath) ?? [])]) merged.set(version.id, version);
    const sorted = [...merged.values()].sort((a, b) => a.createdAt - b.createdAt);
    const before = this.byFile.get(filePath);
    if (before && before.length === sorted.length && before.every((v, i) => v.id === sorted[i]!.id)) return;
    this.byFile.set(filePath, sorted);
    for (const listener of this.listeners) listener(filePath);
  }

  /** The view's versions, oldest first. */
  versions(filePath: string): readonly ViewVersion[] {
    return this.byFile.get(viewLiveKey(filePath)) ?? [];
  }

  latest(filePath: string): ViewVersion | null {
    return this.byFile.get(viewLiveKey(filePath))?.at(-1) ?? null;
  }

  find(filePath: string, id: string): ViewVersion | null {
    return this.byFile.get(viewLiveKey(filePath))?.find((v) => v.id === id) ?? null;
  }

  /** The conversation that carries the view (where its restores go). */
  conversationOf(filePath: string): string | null {
    return this.conversations.get(viewLiveKey(filePath)) ?? null;
  }

  /** The older version every surface of the view shows instead of the live one, while the user looks at it. */
  preview(filePath: string): ViewVersion | null {
    const id = this.previews.get(viewLiveKey(filePath));
    return id ? this.find(filePath, id) : null;
  }

  setPreview(filePath: string, id: string | null) {
    const key = viewLiveKey(filePath);
    if ((this.previews.get(key) ?? null) === id) return;
    if (id) this.previews.set(key, id);
    else this.previews.delete(key);
    for (const listener of this.listeners) listener(key);
  }

  /** Calls `listener` with the `viewLiveKey` of the view whose history (or preview) changed; returns the release. */
  subscribe(listener: (filePath: string) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

/** What "Undo last change" brings back: the newest earlier version with a different source, when an agent made the latest. */
export function undoTarget(versions: readonly ViewVersion[]): ViewVersion | null {
  const latest = versions.at(-1);
  if (!latest || latest.by.kind === "restore") return null;
  for (let i = versions.length - 2; i >= 0; i -= 1) {
    if (versions[i]!.source !== latest.source) return versions[i]!;
  }
  return null;
}

/** The card a restore of `target` publishes (a new latest version; the data stays as it is). */
export function restoreCardArgs(target: ViewVersion, latest: ViewVersion | null, conversationId: string, createdAt: number): PublishViewArgs {
  return {
    conversationId,
    agentId: VIEW_RESTORE_AUTHOR,
    filePath: latest?.filePath ?? target.filePath,
    slug: latest?.slug ?? target.slug,
    title: target.title,
    source: target.source,
    createdAt,
    restoredFrom: target.createdAt,
  };
}

/** The version a restore makes, as the history shows it until the conversation brings it back. */
export const restoredVersion = (args: PublishViewArgs): ViewVersion => ({
  id: viewVersionId(args.createdAt, args.source),
  filePath: args.filePath,
  slug: args.slug,
  title: args.title,
  source: args.source,
  createdAt: args.createdAt,
  by: { kind: "restore", from: args.restoredFrom ?? args.createdAt },
});

/** How a host publishes a restore to the conversation, so every device runs it. */
export type ViewPublishBackend = { call(name: "conversations.publishView", args: PublishViewArgs): Promise<{ posted: boolean }> };

/**
 * A preview's storage: the live view's saved values as they are now, and changes the preview makes
 * kept to itself, so trying an older version never touches the view's data.
 */
export function previewStorage(live: ViewStorage | null): ViewStorage {
  let values: Record<string, unknown> | null = null;
  const read = async () => (values ??= { ...((await live?.load().catch(() => ({}))) ?? {}) });
  return {
    load: async () => ({ ...(await read()) }),
    set: async (key, value) => {
      (await read())[key] = value;
    },
    remove: async (key) => {
      delete (await read())[key];
    },
    clear: async () => {
      values = {};
    },
  };
}

/** The key a host runs a preview of `versionId` under (beside the live view, never in its place). */
export const viewPreviewKey = (filePath: string, versionId: string): string => `${filePath}#version=${versionId}`;
