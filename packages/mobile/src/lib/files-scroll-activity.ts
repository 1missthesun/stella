const QUIET_MS = 350;

let moving = false;
let settledAt = 0;
let quietTimer: ReturnType<typeof setTimeout> | null = null;
const waiting = new Set<() => void>();

const flush = () => {
  quietTimer = null;
  if (moving) return;
  const due = [...waiting];
  waiting.clear();
  for (const run of due) run();
};

export const noteFilesScrolling = (active: boolean): void => {
  if (active === moving) return;
  moving = active;
  if (quietTimer) clearTimeout(quietTimer);
  quietTimer = null;
  if (active) return;
  settledAt = Date.now();
  quietTimer = setTimeout(flush, QUIET_MS);
};

export const filesScrollIsQuiet = (): boolean =>
  !moving && Date.now() - settledAt >= QUIET_MS;

/** Runs `work` once the Files list has been still for a moment; the returned function cancels it. */
export const afterFilesScrollSettles = (work: () => void): (() => void) => {
  if (filesScrollIsQuiet()) {
    work();
    return () => {};
  }
  waiting.add(work);
  if (!moving && !quietTimer) {
    quietTimer = setTimeout(flush, Math.max(0, QUIET_MS - (Date.now() - settledAt)));
  }
  return () => {
    waiting.delete(work);
  };
};
