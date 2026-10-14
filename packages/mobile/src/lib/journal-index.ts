import type { JournalRecord } from "@stella/contracts/conversation-protocol";

/**
 * Incremental view of a conversation's retained journal window.
 *
 * The store only ever appends records (trimming the oldest at the retention
 * cap), prepends an older page, or replaces the window. Each new window is
 * derived from the previous one by touching just the records that changed, so
 * an arrival in a 3,000-record chat costs about what it costs in a short one.
 * Turn and view arrays keep their identity while their records are unchanged,
 * which is what downstream memos key on.
 */

export type JournalTurn = {
  readonly turnId: string;
  readonly records: readonly JournalRecord[];
  readonly firstSeq: number;
  /** Per-version scratch space for consumers; a changed turn gets a new one. */
  readonly memo: Record<string, unknown>;
};

export type JournalView = {
  readonly id: string;
  readonly test: (record: JournalRecord) => boolean;
};

export type JournalIndex = {
  readonly records: readonly JournalRecord[];
  readonly turns: readonly JournalTurn[];
  turn(turnId: string): JournalTurn | undefined;
  recordAt(seq: number): JournalRecord | undefined;
  view(spec: JournalView): readonly JournalRecord[];
};

const EMPTY: readonly JournalRecord[] = [];

const lowerBound = (records: readonly JournalRecord[], seq: number): number => {
  let low = 0;
  let high = records.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (records[mid]!.seq < seq) low = mid + 1;
    else high = mid;
  }
  return low;
};

/**
 * A changed turn keeps its previous version's memo under `prior` (one level
 * deep), so consumers can share what didn't change.
 */
const makeTurn = (
  turnId: string,
  records: readonly JournalRecord[],
  prior?: JournalTurn,
): JournalTurn => {
  const memo: Record<string, unknown> = {};
  if (prior) {
    delete prior.memo.prior;
    memo.prior = prior.memo;
  }
  return { turnId, records, firstSeq: records[0]!.seq, memo };
};

const sameRecords = (
  a: readonly JournalRecord[],
  b: readonly JournalRecord[],
): boolean => a.length === b.length && a.every((record, i) => record === b[i]);

class Index implements JournalIndex {
  readonly records: readonly JournalRecord[];
  readonly turns: readonly JournalTurn[];
  private byId: Map<string, JournalTurn> | null;
  private readonly views = new Map<JournalView, readonly JournalRecord[]>();
  private base: { index: Index; dropped: number; prepended: number } | null;

  constructor(
    records: readonly JournalRecord[],
    turns: readonly JournalTurn[],
    byId: Map<string, JournalTurn>,
    base: { index: Index; dropped: number; prepended: number } | null,
  ) {
    this.records = records;
    this.turns = turns;
    this.byId = byId;
    this.base = base;
    if (base) {
      for (const [spec, view] of base.index.views) {
        this.views.set(spec, this.deriveView(spec, view, base));
      }
      this.base = null;
    }
  }

  turn(turnId: string): JournalTurn | undefined {
    return this.turnMap().get(turnId);
  }

  /**
   * The turn map is handed to the next window derived from this one; a window
   * that has been superseded rebuilds its own on demand.
   */
  turnMap(): Map<string, JournalTurn> {
    return (this.byId ??= new Map(this.turns.map((turn) => [turn.turnId, turn])));
  }

  releaseTurnMap(): Map<string, JournalTurn> {
    const map = this.turnMap();
    this.byId = null;
    return map;
  }

  recordAt = (seq: number): JournalRecord | undefined => {
    const record = this.records[lowerBound(this.records, seq)];
    return record?.seq === seq ? record : undefined;
  };

  view(spec: JournalView): readonly JournalRecord[] {
    let view = this.views.get(spec);
    if (!view) {
      const matched = this.records.filter(spec.test);
      view = matched.length ? matched : EMPTY;
      this.views.set(spec, view);
    }
    return view;
  }

  private deriveView(
    spec: JournalView,
    previous: readonly JournalRecord[],
    base: { index: Index; dropped: number; prepended: number },
  ): readonly JournalRecord[] {
    let view = previous;
    const first = this.records[0]!.seq;
    if (base.dropped > 0) {
      const cut = lowerBound(view, first);
      if (cut > 0) view = view.slice(cut);
    }
    if (base.prepended > 0) {
      const older = this.records.slice(0, base.prepended).filter(spec.test);
      if (older.length) view = older.concat(view);
    }
    const kept = base.index.records.length - base.dropped;
    const appendedFrom = base.prepended + kept;
    if (appendedFrom < this.records.length) {
      const fresh = this.records.slice(appendedFrom).filter(spec.test);
      if (fresh.length) view = view.concat(fresh);
    }
    return view.length ? view : EMPTY;
  }
}

const build = (
  records: readonly JournalRecord[],
  previous: Index | null,
): Index => {
  const grouped = new Map<string, JournalRecord[]>();
  for (const record of records) {
    const turn = grouped.get(record.turnId);
    if (turn) turn.push(record);
    else grouped.set(record.turnId, [record]);
  }
  const byId = new Map<string, JournalTurn>();
  const turns: JournalTurn[] = [];
  for (const [turnId, turnRecords] of grouped) {
    const prior = previous?.turn(turnId);
    const turn =
      prior && sameRecords(prior.records, turnRecords)
        ? prior
        : makeTurn(turnId, turnRecords, prior);
    byId.set(turnId, turn);
    turns.push(turn);
  }
  return new Index(records, turns, byId, null);
};

const derive = (
  previous: Index,
  records: readonly JournalRecord[],
): Index | null => {
  const old = previous.records;
  if (!old.length || !records.length) return null;
  const oldLast = old[old.length - 1]!;
  let dropped = 0;
  let prepended = 0;
  if (records[0] === old[0]) {
    if (records.length < old.length || records[old.length - 1] !== oldLast) {
      return null;
    }
  } else if (records[0]!.seq > old[0]!.seq) {
    dropped = lowerBound(old, records[0]!.seq);
    const kept = old.length - dropped;
    if (
      old[dropped] !== records[0] ||
      records.length < kept ||
      records[kept - 1] !== oldLast
    ) {
      return null;
    }
  } else {
    prepended = records.length - old.length;
    if (
      prepended <= 0 ||
      records[prepended] !== old[0] ||
      records[records.length - 1] !== oldLast
    ) {
      return null;
    }
  }
  const kept = old.length - dropped;
  const appendedFrom = prepended + kept;
  if (dropped === 0 && prepended === 0 && appendedFrom === records.length) {
    return null;
  }
  const middle = prepended + (kept >> 1);
  if (records[middle] !== old[dropped + (kept >> 1)]) return null;

  const byId = previous.releaseTurnMap();
  const changed = new Map<string, JournalRecord[] | readonly JournalRecord[]>();
  const turnRecords = (turnId: string) =>
    changed.get(turnId) ?? byId.get(turnId)?.records ?? EMPTY;
  let reorder = false;

  if (dropped > 0) {
    const firstSeq = records[0]!.seq;
    for (let index = 0; index < dropped; index += 1) {
      const turnId = old[index]!.turnId;
      if (changed.has(turnId)) continue;
      const current = turnRecords(turnId);
      changed.set(turnId, current.slice(lowerBound(current, firstSeq)));
    }
    reorder = true;
  }
  if (prepended > 0) {
    const older = new Map<string, JournalRecord[]>();
    for (let index = 0; index < prepended; index += 1) {
      const record = records[index]!;
      const list = older.get(record.turnId);
      if (list) list.push(record);
      else older.set(record.turnId, [record]);
    }
    for (const [turnId, list] of older) {
      changed.set(turnId, list.concat(turnRecords(turnId)));
    }
    reorder = true;
  }
  const fresh: string[] = [];
  for (let index = appendedFrom; index < records.length; index += 1) {
    const record = records[index]!;
    const current = changed.get(record.turnId);
    if (current) {
      (current as JournalRecord[]).push(record);
      continue;
    }
    const existing = byId.get(record.turnId)?.records;
    if (!existing) fresh.push(record.turnId);
    changed.set(record.turnId, existing ? existing.concat(record) : [record]);
  }

  let turns: JournalTurn[];
  if (reorder) {
    turns = [];
    for (const turn of previous.turns) {
      if (changed.has(turn.turnId)) continue;
      turns.push(turn);
    }
  } else {
    turns = previous.turns.slice();
  }
  const freshSet = new Set(fresh);
  const placed: JournalTurn[] = [];
  for (const [turnId, list] of changed) {
    if (!list.length) {
      byId.delete(turnId);
      if (!reorder) {
        const at = turns.findIndex((turn) => turn.turnId === turnId);
        if (at >= 0) turns.splice(at, 1);
      }
      continue;
    }
    const turn = makeTurn(turnId, list, byId.get(turnId));
    byId.set(turnId, turn);
    if (reorder || freshSet.has(turnId)) {
      placed.push(turn);
      continue;
    }
    for (let at = turns.length - 1; at >= 0; at -= 1) {
      if (turns[at]!.turnId === turnId) {
        turns[at] = turn;
        break;
      }
    }
  }
  if (placed.length) {
    placed.sort((a, b) => a.firstSeq - b.firstSeq);
    if (reorder) {
      turns = mergeByFirstSeq(turns, placed);
    } else {
      turns.push(...placed);
    }
  }
  return new Index(records, turns, byId, { index: previous, dropped, prepended });
};

const mergeByFirstSeq = (
  sorted: readonly JournalTurn[],
  extra: readonly JournalTurn[],
): JournalTurn[] => {
  const merged: JournalTurn[] = [];
  let i = 0;
  let j = 0;
  while (i < sorted.length || j < extra.length) {
    if (
      j >= extra.length ||
      (i < sorted.length && sorted[i]!.firstSeq < extra[j]!.firstSeq)
    ) {
      merged.push(sorted[i++]!);
    } else {
      merged.push(extra[j++]!);
    }
  }
  return merged;
};

const latest = new Map<string, Index>();
const MAX_CACHED_CONVERSATIONS = 4;

/**
 * The index for `records`, derived from the last window seen under `key`
 * when the new one extends, trims or prepends to it.
 */
export const journalIndex = (
  key: string,
  records: readonly JournalRecord[],
): JournalIndex => {
  const previous = latest.get(key);
  if (previous?.records === records) return previous;
  const next =
    (previous && derive(previous, records)) ??
    build(records, previous ?? null);
  latest.delete(key);
  latest.set(key, next);
  while (latest.size > MAX_CACHED_CONVERSATIONS) {
    const oldest = latest.keys().next().value;
    if (oldest === undefined) break;
    latest.delete(oldest);
  }
  return next;
};
