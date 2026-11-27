import { useCallback, useState, type AnimationEvent } from "react";

const arrivals = new Map<string, number>();

export const recordMessageArrival = (messageId: string): boolean => {
  if (arrivals.has(messageId)) return false;
  arrivals.set(messageId, performance.now());
  return true;
};

export const recordPresentMessage = (messageId: string): boolean => {
  if (arrivals.has(messageId)) return false;
  arrivals.set(messageId, Number.NEGATIVE_INFINITY);
  return true;
};

/** A sent message the runtime accepted under a new id is the same bubble: it keeps its arrival. */
export const carryMessageArrival = (fromId: string, toId: string): void => {
  const arrivedAt = arrivals.get(fromId);
  if (arrivedAt !== undefined && !arrivals.has(toId)) arrivals.set(toId, arrivedAt);
};

export const messageArrivedAt = (messageId: string): number | undefined => {
  const arrivedAt = arrivals.get(messageId);
  return arrivedAt === undefined || arrivedAt === Number.NEGATIVE_INFINITY
    ? undefined
    : arrivedAt;
};

export const useEntrance = (
  arrivedAt: number | undefined,
  durationMs: number,
  animationName: string,
): {
  delayMs: number | null;
  onAnimationEnd: (event: AnimationEvent) => void;
} => {
  const [entrance, setEntrance] = useState<{
    arrivedAt: number;
    delayMs: number | null;
  } | null>(null);
  if (arrivedAt !== undefined && entrance?.arrivedAt !== arrivedAt) {
    const elapsed = performance.now() - arrivedAt;
    setEntrance({ arrivedAt, delayMs: elapsed < durationMs ? -elapsed : null });
  }
  const onAnimationEnd = useCallback(
    (event: AnimationEvent) => {
      if (event.animationName !== animationName) return;
      setEntrance((current) =>
        current && current.delayMs !== null
          ? { ...current, delayMs: null }
          : current,
      );
    },
    [animationName],
  );
  return {
    delayMs:
      entrance && entrance.arrivedAt === arrivedAt ? entrance.delayMs : null,
    onAnimationEnd,
  };
};
