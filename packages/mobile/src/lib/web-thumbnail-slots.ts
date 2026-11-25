import { useEffect, useState } from "react";

const MAX_LIVE = 6;

type Waiter = { grant: () => void };

let live = 0;
const waiting: Waiter[] = [];

const settle = () => {
  while (live < MAX_LIVE) {
    const next = waiting.pop();
    if (!next) return;
    live += 1;
    next.grant();
  }
};

/**
 * Each live web thumbnail is a WKWebView with its own content process, so only
 * a screenful run at once; the newest on screen goes first.
 */
export const useWebThumbnailSlot = (): boolean => {
  const [granted, setGranted] = useState(false);
  useEffect(() => {
    let held = false;
    const waiter: Waiter = {
      grant: () => {
        held = true;
        setGranted(true);
      },
    };
    waiting.push(waiter);
    settle();
    return () => {
      if (held) live -= 1;
      else waiting.splice(waiting.indexOf(waiter), 1);
      settle();
    };
  }, []);
  return granted;
};
