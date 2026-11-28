// The phone's cloud conversation cache: what desktop-ui's `cloudConversationCacheClient` reads
// through `window.electronAPI.cloudConversationCache` on a computer (Electron's SQLite store,
// desktop/electron/services/cloud-conversation-cache-store.ts), here in the app's Documents. The
// chat store hydrates from it as the app opens, so the last session's messages show at once and
// the socket syncs what is new on top (packages/mobile's cloud-conversation-cache), instead of the
// chat loading from scratch on every launch.
//
// Same contract as the desktop store: an account scope and owner generation must be active for
// reads and writes; `replace` is versioned (`expected` must match, revisions count up) and may keep
// a retained range of what it already holds; at most eight conversations, least recent dropped.
// Each conversation is held in memory once read and written to its own file shortly after it
// changes, trimmed on disk to its latest 1,000 records and 4 MB, as the RN app keeps its journal
// tail (its window's floor moves up to match).

import {
  MAX_CLOUD_CONVERSATION_CACHE_CONVERSATIONS,
  type CloudConversationCacheAuthority,
  type CloudConversationCacheLifecycleAuthority,
  type CloudConversationCachePurgeResult,
  type CloudConversationCacheReplaceInput,
  type CloudConversationCacheReplaceResult,
  type CloudConversationCacheSnapshot,
  type CloudConversationCacheVersion,
} from "@stella/contracts/cloud-conversation-cache";

const DISK_MAX_RECORDS = 1_000;
const DISK_MAX_BYTES = 4 * 1024 * 1024;
const WRITE_DELAY_MS = 400;

type Entry = CloudConversationCacheAuthority &
  CloudConversationCacheVersion & {
    title: string;
    cachedAtMs: number;
    records: { seq: number }[];
    file: string;
  };

type IndexRow = CloudConversationCacheAuthority & { cachedAtMs: number; file: string };

const dir = () => `${__native.env.documents}/conversation-cache`;
const INDEX = () => `${dir()}/index.json`;
// Files are named within the folder: the app's container path changes with each install.
const pathOf = (file: string) => `${dir()}/${file.slice(file.lastIndexOf("/") + 1)}`;

let active: CloudConversationCacheLifecycleAuthority | { accountScope: string; ownerGeneration: null } | null = null;
let index: IndexRow[] | null = null;
const loaded = new Map<string, Entry | null>();
const dirty = new Set<string>();
let writeTimer: ReturnType<typeof setTimeout> | null = null;

const keyOf = (a: CloudConversationCacheAuthority) => `${a.accountScope}\u0000${a.ownerGeneration}\u0000${a.conversationId}`;

function readJson<T>(path: string): T | null {
  const text = __native.readText(path);
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function rows(): IndexRow[] {
  if (!index) {
    const stored = readJson<IndexRow[]>(INDEX());
    index = Array.isArray(stored) ? stored.filter((r) => r && typeof r.file === "string" && typeof r.conversationId === "string") : [];
  }
  return index;
}

function saveIndex() {
  __native.writeFile(INDEX(), JSON.stringify(rows()));
}

function fileFor(a: CloudConversationCacheAuthority): string {
  const digest = __native.digest("SHA-256", new TextEncoder().encode(keyOf(a)));
  let hex = "";
  for (let i = 0; i < 12; i++) hex += digest[i]!.toString(16).padStart(2, "0");
  return `${hex}.json`;
}

function load(a: CloudConversationCacheAuthority): Entry | null {
  const key = keyOf(a);
  if (loaded.has(key)) return loaded.get(key) ?? null;
  const row = rows().find((r) => keyOf(r) === key);
  const stored = row ? readJson<Entry>(pathOf(row.file)) : null;
  const entry =
    stored &&
    stored.conversationId === a.conversationId &&
    stored.accountScope === a.accountScope &&
    stored.ownerGeneration === a.ownerGeneration &&
    Array.isArray(stored.records)
      ? { ...stored, file: row!.file }
      : null;
  loaded.set(key, entry);
  return entry;
}

function drop(key: string) {
  const row = rows().find((r) => keyOf(r) === key);
  if (row) __native.removeFile(pathOf(row.file));
  index = rows().filter((r) => keyOf(r) !== key);
  loaded.set(key, null);
  dirty.delete(key);
}

function dropWhere(keep: (r: IndexRow) => boolean): number {
  const gone = rows().filter((r) => !keep(r));
  for (const r of gone) drop(keyOf(r));
  for (const [key, entry] of loaded) if (entry && !keep(entry)) drop(key);
  if (gone.length) saveIndex();
  return gone.length;
}

/** What goes to disk: the window's latest records within the phone's budget, its floor moved up to the first kept. */
function onDisk(e: Entry): Entry {
  let bytes = 0;
  let from = e.records.length;
  while (from > 0 && e.records.length - from < DISK_MAX_RECORDS) {
    const size = JSON.stringify(e.records[from - 1]).length;
    if (bytes + size > DISK_MAX_BYTES) break;
    bytes += size;
    from -= 1;
  }
  if (from === 0) return e;
  const records = e.records.slice(from);
  return { ...e, records, floorSeq: records[0]?.seq ?? e.headSeq + 1 };
}

function flush() {
  writeTimer = null;
  for (const key of dirty) {
    const e = loaded.get(key);
    if (e) __native.writeFile(pathOf(e.file), JSON.stringify(onDisk(e)));
  }
  dirty.clear();
  saveIndex();
}

function scheduleWrite(key: string) {
  dirty.add(key);
  if (!writeTimer) writeTimer = setTimeout(flush, WRITE_DELAY_MS);
}

const isActive = (a: CloudConversationCacheLifecycleAuthority) => active?.accountScope === a.accountScope && active.ownerGeneration === a.ownerGeneration;

const versionOf = (e: Entry | null): CloudConversationCacheVersion | null => (e ? { epoch: e.epoch, headSeq: e.headSeq, floorSeq: e.floorSeq, revision: e.revision } : null);

const sameVersion = (a: CloudConversationCacheVersion | null, b: CloudConversationCacheVersion | null) =>
  a === b || (!!a && !!b && a.epoch === b.epoch && a.headSeq === b.headSeq && a.floorSeq === b.floorSeq && a.revision === b.revision);

function pruneLeastRecent() {
  const byRecency = [...rows()].sort((x, y) => y.cachedAtMs - x.cachedAtMs);
  for (const r of byRecency.slice(MAX_CLOUD_CONVERSATION_CACHE_CONVERSATIONS)) drop(keyOf(r));
}

export function phoneConversationCache() {
  return {
    async retainAccount(accountScope: string): Promise<CloudConversationCachePurgeResult> {
      const purgedConversations = dropWhere((r) => r.accountScope === accountScope);
      active = { accountScope, ownerGeneration: null };
      return { purgedConversations };
    },
    async activateAuthority(authority: CloudConversationCacheLifecycleAuthority): Promise<CloudConversationCachePurgeResult> {
      const purgedConversations = dropWhere((r) => r.accountScope === authority.accountScope && r.ownerGeneration === authority.ownerGeneration);
      active = { accountScope: authority.accountScope, ownerGeneration: authority.ownerGeneration };
      return { purgedConversations };
    },
    async read(authority: CloudConversationCacheAuthority): Promise<CloudConversationCacheSnapshot | null> {
      if (!isActive(authority)) return null;
      const e = load(authority);
      if (!e) return null;
      const { file: _file, ...snapshot } = e;
      return { ...snapshot, records: [...e.records] };
    },
    async replace(input: CloudConversationCacheReplaceInput): Promise<CloudConversationCacheReplaceResult> {
      if (!isActive(input)) return { status: "inactive", current: null };
      const key = keyOf(input);
      const current = load(input);
      const version = versionOf(current);
      if (!sameVersion(version, input.expected)) return { status: "conflict", current: version };
      if (version && version.epoch === input.epoch && (input.headSeq < version.headSeq || input.floorSeq < version.floorSeq)) {
        return { status: "conflict", current: version };
      }
      let kept: { seq: number }[] = [];
      if (input.retainedRange) {
        const { fromSeq, toSeq } = input.retainedRange;
        kept = current && current.epoch === input.epoch ? current.records.filter((r) => r.seq >= fromSeq && r.seq <= toSeq) : [];
        if (kept.length !== toSeq - fromSeq + 1) {
          drop(key);
          saveIndex();
          return { status: "conflict", current: null };
        }
      }
      const records = [...kept, ...(input.records as { seq: number }[])].sort((a, b) => a.seq - b.seq);
      const revision = (version?.revision ?? 0) + 1;
      const cachedAtMs = Date.now();
      const entry: Entry = {
        accountScope: input.accountScope,
        ownerGeneration: input.ownerGeneration,
        conversationId: input.conversationId,
        epoch: input.epoch,
        headSeq: input.headSeq,
        floorSeq: input.floorSeq,
        revision,
        title: input.title,
        cachedAtMs,
        records,
        file: current?.file ?? fileFor(input),
      };
      loaded.set(key, entry);
      index = [...rows().filter((r) => keyOf(r) !== key), { accountScope: entry.accountScope, ownerGeneration: entry.ownerGeneration, conversationId: entry.conversationId, cachedAtMs, file: entry.file }];
      pruneLeastRecent();
      scheduleWrite(key);
      return { status: "applied", version: { epoch: input.epoch, headSeq: input.headSeq, floorSeq: input.floorSeq, revision } };
    },
    async purgeConversation(authority: CloudConversationCacheAuthority): Promise<CloudConversationCachePurgeResult> {
      if (!isActive(authority)) return { purgedConversations: 0 };
      const present = rows().some((r) => keyOf(r) === keyOf(authority)) || !!loaded.get(keyOf(authority));
      drop(keyOf(authority));
      saveIndex();
      return { purgedConversations: present ? 1 : 0 };
    },
    /** Writes what is waiting now (the app is going to the background). */
    flush() {
      if (writeTimer) clearTimeout(writeTimer);
      if (dirty.size) flush();
    },
  };
}
