import { useEffect, useState } from "react";
import {
  afterFilesScrollSettles,
  filesScrollIsQuiet,
} from "./files-scroll-activity";

const MAX_LIVE = 6;
const GRANT_SPACING_MS = 160;

type Waiter = { grant: () => void };

let live = 0;
const waiting: Waiter[] = [];
let scheduled = false;

const grantNext = () => {
  scheduled = false;
  if (live >= MAX_LIVE || waiting.length === 0) return;
  if (!filesScrollIsQuiet()) {
    schedule();
    return;
  }
  const next = waiting.pop();
  if (!next) return;
  live += 1;
  next.grant();
  if (waiting.length > 0 && live < MAX_LIVE) {
    scheduled = true;
    setTimeout(grantNext, GRANT_SPACING_MS);
  }
};

const schedule = () => {
  if (scheduled || live >= MAX_LIVE || waiting.length === 0) return;
  scheduled = true;
  afterFilesScrollSettles(grantNext);
};

/**
 * Each live web thumbnail is a WKWebView with its own content process, whose
 * creation blocks the main thread for tens of milliseconds: only a screenful
 * run at once, the newest on screen goes first, one at a time, and none
 * starts while the list is moving.
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
    schedule();
    return () => {
      if (held) live -= 1;
      else waiting.splice(waiting.indexOf(waiter), 1);
      schedule();
    };
  }, []);
  return granted;
};
