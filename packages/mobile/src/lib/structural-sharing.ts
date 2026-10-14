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

export const reuseEqualChatMessages = (
  previous: readonly ChatMessage[] | null,
  next: ChatMessage[],
): ChatMessage[] => {
  if (!previous || previous === next || previous.length === 0) return next;
  let previousById: Map<string, ChatMessage> | null = null;
  const priorFor = (message: ChatMessage, index: number) => {
    const aligned = previous[index];
    if (aligned?.id === message.id) return aligned;
    if (!previousById) {
      previousById = new Map();
      for (const entry of previous) previousById.set(entry.id, entry);
    }
    return previousById.get(message.id);
  };
  let same = previous.length === next.length;
  const shared = next.map((message, index) => {
    const prior = priorFor(message, index);
    const kept = prior ? replaceEqualDeep(prior, message) : message;
    if (kept !== previous[index]) same = false;
    return kept;
  });
  return same ? (previous as ChatMessage[]) : shared;
};
