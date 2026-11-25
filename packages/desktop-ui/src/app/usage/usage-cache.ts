import { steadyNow } from "@stella/contracts/server-clock";
import type { LocalModelUsagePage } from "@stella/contracts/local-chat";
import { rangeStartMs, type UsageRange } from "./usage-data";

const CACHE_FRESH_MS = 15_000;
const USAGE_LIMIT = 10_000;

type CachedUsage = {
  page: LocalModelUsagePage;
  fetchedAt: number;
};

// @reloadable client cache of local usage pages read from the runtime worker
const usageCache = new Map<UsageRange, CachedUsage>();
// @reloadable in-flight IPC requests deduplicated per range
const inFlightUsage = new Map<UsageRange, Promise<LocalModelUsagePage>>();

let usagePanelPreloaded = false;

export const readCachedUsagePage = (
  range: UsageRange,
): LocalModelUsagePage | undefined => usageCache.get(range)?.page;

export const isUsageCacheFresh = (range: UsageRange): boolean => {
  const entry = usageCache.get(range);
  return entry !== undefined && steadyNow() - entry.fetchedAt < CACHE_FRESH_MS;
};

export const fetchUsagePage = async (
  range: UsageRange,
  options?: { force?: boolean },
): Promise<LocalModelUsagePage> => {
  const api = window.electronAPI?.localChat;
  if (!api?.listModelUsage) {
    throw new Error("desktop-only");
  }
  if (!options?.force && isUsageCacheFresh(range)) {
    return usageCache.get(range)!.page;
  }
  const existing = inFlightUsage.get(range);
  if (existing && !options?.force) return existing;

  const request = api
    .listModelUsage({
      fromMs: rangeStartMs(range),
      limit: USAGE_LIMIT,
    })
    .then((page) => {
      usageCache.set(range, { page, fetchedAt: steadyNow() });
      return page;
    })
    .finally(() => {
      if (inFlightUsage.get(range) === request) {
        inFlightUsage.delete(range);
      }
    });
  inFlightUsage.set(range, request);
  return request;
};

export const preloadUsageSurface = (range: UsageRange = "7d"): void => {
  if (!usagePanelPreloaded) {
    usagePanelPreloaded = true;
    void import("./App").catch(() => {
      usagePanelPreloaded = false;
    });
  }
  if (window.electronAPI?.localChat?.listModelUsage && !isUsageCacheFresh(range)) {
    void fetchUsagePage(range).catch(() => undefined);
  }
};
