import { useEffect, useRef } from "react";

type Entry = { text: string; settle: (sent: boolean) => void };

const queue: Entry[] = [];
const listeners = new Set<() => void>();

export const sendToChat = (text: string, timeoutMs = 15_000): Promise<boolean> =>
  new Promise((resolve) => {
    let settled = false;
    const entry: Entry = {
      text,
      settle: (sent) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(sent);
      },
    };
    const timer = setTimeout(() => {
      const index = queue.indexOf(entry);
      if (index >= 0) queue.splice(index, 1);
      entry.settle(false);
    }, timeoutMs);
    queue.push(entry);
    for (const listener of listeners) listener();
  });

export const useChatSendQueue = (send: ((text: string) => unknown) | undefined, ready: boolean): void => {
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    const drain = () => {
      if (!ready || !sendRef.current) return;
      while (queue.length > 0) {
        const entry = queue.shift()!;
        try {
          void Promise.resolve(sendRef.current(entry.text)).then(
            (result) => entry.settle(result !== false && result !== null),
            () => entry.settle(false),
          );
        } catch {
          entry.settle(false);
        }
      }
    };
    drain();
    listeners.add(drain);
    return () => {
      listeners.delete(drain);
    };
  }, [ready]);
};
