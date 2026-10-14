import { useEffect, useState } from "react";
import type { MemorySyncStatus } from "@stella/contracts/desktop/memory-sync";

export function useMemorySyncStatus(): MemorySyncStatus | null {
  const [status, setStatus] = useState<MemorySyncStatus | null>(null);
  useEffect(() => {
    const api = window.electronAPI?.memorySync;
    if (!api) return;
    let live = true;
    const stop = api.onStatus((next) => {
      if (live) setStatus(next);
    });
    void api
      .getStatus()
      .then((current) => {
        if (live) setStatus((pushed) => pushed ?? current);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      stop();
    };
  }, []);
  return status;
}

export const requestMemorySync = (): Promise<void> =>
  (window.electronAPI?.memorySync?.syncNow() ?? Promise.resolve())
    .then(() => undefined)
    .catch(() => undefined);
