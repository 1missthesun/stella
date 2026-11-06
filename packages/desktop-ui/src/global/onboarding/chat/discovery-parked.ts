import type { DiscoveryCategory } from "@stella/contracts/discovery";
import { uiState } from "@/platform/ui-state";

const PARKED_DISCOVERY_KEY = "stella-onboarding-discovery-parked";
const MAX_PARKED_ATTEMPTS = 3;

export type ParkedDiscovery = {
  formattedSections: Partial<Record<DiscoveryCategory, string>>;
  categories: DiscoveryCategory[];
  attempts: number;
};

export const parkDiscovery = (parked: ParkedDiscovery) => {
  uiState.setItem(PARKED_DISCOVERY_KEY, JSON.stringify(parked));
};

export const readParkedDiscovery = (): ParkedDiscovery | null => {
  const raw = uiState.getItem(PARKED_DISCOVERY_KEY);
  if (!raw) return null;
  try {
    const parked = JSON.parse(raw) as ParkedDiscovery;
    if (parked.attempts >= MAX_PARKED_ATTEMPTS) {
      clearParkedDiscovery();
      return null;
    }
    return parked;
  } catch {
    clearParkedDiscovery();
    return null;
  }
};

export const clearParkedDiscovery = () => {
  uiState.removeItem(PARKED_DISCOVERY_KEY);
};
