import {
  releaseKey,
  releaseSummary,
  stellaReleases,
  type StellaRelease,
} from "@stella/contracts/stella-releases";
import { uiState } from "@/platform/ui-state";

const LATEST_SHOWN_KEY = "stella.whatsNew.latestShown";
const ARRIVALS_KEY = "stella.whatsNew.arrivals";
const ARRIVALS_KEPT = 20;

const signature = (release: StellaRelease) => `${releaseKey(release)}\n${releaseSummary(release)}`;

const readArrivals = (): [string, string][] => {
  try {
    const value = JSON.parse(uiState.getItem(ARRIVALS_KEY) ?? "[]") as unknown;
    return Array.isArray(value)
      ? value.filter(
          (entry): entry is [string, string] =>
            Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1] === "string",
        )
      : [];
  } catch {
    return [];
  }
};

export const latestRelease = (): StellaRelease | null => stellaReleases[0] ?? null;

export const releaseNewIn = (arrivedSha: string): StellaRelease | null => {
  const arrivals = readArrivals();
  const known = arrivals.find(([sha]) => sha === arrivedSha);
  const latest = latestRelease();
  if (known) {
    return known[1] ? (stellaReleases.find((release) => releaseKey(release) === known[1]) ?? null) : null;
  }
  const isNew = latest !== null && uiState.getItem(LATEST_SHOWN_KEY) !== signature(latest);
  const news = isNew ? latest : null;
  uiState.setItem(
    ARRIVALS_KEY,
    JSON.stringify([...arrivals, [arrivedSha, news ? releaseKey(news) : ""]].slice(-ARRIVALS_KEPT)),
  );
  if (latest) uiState.setItem(LATEST_SHOWN_KEY, signature(latest));
  return news;
};
