import type { ChatMessage } from "../types";

const hasOwn = Object.prototype.hasOwnProperty;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

export const replaceEqualDeep = <T>(previous: unknown, next: T): T => {
  if (previous === next) return next;
  if (Array.isArray(previous) && Array.isArray(next)) {
    let shared: unknown[] | null =
      previous.length === next.length ? null : [];
    for (let index = 0; index < next.length; index += 1) {
      const kept = replaceEqualDeep(previous[index], next[index]);
      if (shared) shared.push(kept);
      else if (kept !== previous[index]) {
        shared = previous.slice(0, index);
        shared.push(kept);
      }
    }
    return (shared ?? previous) as T;
  }
  if (isPlainObject(previous) && isPlainObject(next)) {
    let shared: Record<string, unknown> | null = null;
    let count = 0;
    for (const key in next) {
      if (!hasOwn.call(next, key)) continue;
      const kept = replaceEqualDeep(previous[key], next[key]);
      if (shared) shared[key] = kept;
      else if (kept !== previous[key] || !hasOwn.call(previous, key)) {
        shared = {};
        for (const earlier in next) {
          if (earlier === key) break;
          if (hasOwn.call(next, earlier)) shared[earlier] = previous[earlier];
        }
        shared[key] = kept;
      }
      count += 1;
    }
    if (shared) return shared as T;
    if (count === Object.keys(previous).length) return previous as T;
    const trimmed: Record<string, unknown> = {};
    for (const key in next) {
      if (hasOwn.call(next, key)) trimmed[key] = previous[key];
    }
    return trimmed as T;
  }
  return next;
};

const NEARBY = 8;
const TAIL = 4;

/**
 * Keeps the previous object for every message that didn't change. Messages are
 * matched by position, following the shift when rows leave the top or arrive
 * at the bottom; an id lookup is built only for bigger moves, and new rows at
 * the tail never need it.
 */
export const reuseEqualChatMessages = (
  previous: readonly ChatMessage[] | null,
  next: ChatMessage[],
): ChatMessage[] => {
  if (!previous || previous === next || previous.length === 0) return next;
  let previousIndex: Map<string, number> | null = null;
  let offset = 0;
  const priorFor = (message: ChatMessage, index: number) => {
    const expected = index + offset;
    if (previous[expected]?.id === message.id) return previous[expected];
    for (let step = 1; step <= NEARBY; step += 1) {
      for (const at of [expected + step, expected - step]) {
        if (previous[at]?.id !== message.id) continue;
        offset = at - index;
        return previous[at];
      }
    }
    if (!previousIndex) {
      if (index >= next.length - TAIL) return undefined;
      previousIndex = new Map();
      previous.forEach((entry, at) => previousIndex!.set(entry.id, at));
    }
    const at = previousIndex.get(message.id);
    if (at === undefined) return undefined;
    offset = at - index;
    return previous[at];
  };
  // Rows above the newest change usually come through as the very same
  // objects; skip them with a plain loop before any per-row matching.
  const limit = Math.min(previous.length, next.length);
  let start = 0;
  while (start < limit && next[start] === previous[start]) start += 1;
  if (start === next.length) {
    return previous.length === next.length ? (previous as ChatMessage[]) : next;
  }
  let same = previous.length === next.length;
  let shared: ChatMessage[] | null = null;
  for (let index = start; index < next.length; index += 1) {
    const message = next[index]!;
    const prior = priorFor(message, index);
    const kept = prior ? replaceEqualDeep(prior, message) : message;
    if (kept !== previous[index]) same = false;
    if (kept !== message) (shared ??= next.slice())[index] = kept;
  }
  return same ? (previous as ChatMessage[]) : (shared ?? next);
};
