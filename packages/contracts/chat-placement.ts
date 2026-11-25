export type ChatRowPlace = {
  id: string;
  ownerId?: string;
  sequence?: number;
  afterSequence?: number;
  beforeId?: string;
};

export const placeUnrecordedRows = <T>(
  recorded: readonly T[],
  unrecorded: readonly T[],
  placeOf: (row: T) => ChatRowPlace,
): T[] => {
  const out = recorded.map((row) => ({ row, place: placeOf(row) }));
  for (const row of unrecorded) {
    const place = placeOf(row);
    const at = insertionIndex(out, place);
    out.splice(at, 0, { row, place });
  }
  return out.map((entry) => entry.row);
};

const insertionIndex = (rows: readonly { place: ChatRowPlace }[], place: ChatRowPlace): number => {
  if (place.ownerId !== undefined) {
    const owner = rows.findLastIndex(
      (row) => row.place.id === place.ownerId || row.place.ownerId === place.ownerId,
    );
    if (owner >= 0) return owner + 1;
  }
  const firstReply = rows.findIndex((row) => row.place.ownerId === place.id);
  if (firstReply >= 0) return firstReply;
  if (place.beforeId !== undefined) {
    const before = rows.findIndex((row) => row.place.id === place.beforeId);
    if (before >= 0) return before;
  }
  if (place.afterSequence !== undefined) {
    const later = rows.findIndex(
      (row) =>
        row.place.ownerId === undefined &&
        row.place.sequence !== undefined &&
        row.place.sequence > place.afterSequence!,
    );
    if (later >= 0) return later;
  }
  return rows.length;
};

export class ChatRowAnchors {
  private readonly anchors = new Map<string, string | null>();

  insert<T>(rows: readonly T[], extras: readonly T[], idOf: (row: T) => string): T[] {
    const out = [...rows];
    for (const extra of extras) {
      const id = idOf(extra);
      const anchor = this.anchors.get(id);
      let at = anchor === null ? 0 : out.findIndex((row) => idOf(row) === anchor) + 1;
      if (anchor === undefined || (anchor !== null && at === 0)) {
        const newest = out.at(-1);
        this.anchors.set(id, newest === undefined ? null : idOf(newest));
        at = out.length;
      }
      while (at < out.length && this.anchors.get(idOf(out[at]!)) === anchor && anchor !== undefined) at += 1;
      out.splice(at, 0, extra);
    }
    return out;
  }
}
