import * as SecureStore from "./secure-store";
import { isSelfHostedLaunch } from "./server-registry";

const CONSENT_KEY = isSelfHostedLaunch
  ? "stella-mobile_ai-data-consent-selfhosted-v2"
  : "stella-mobile_ai-data-consent-v5";

let cached: boolean | null = null;

type Listener = () => void;
const requestListeners = new Set<Listener>();

export async function loadAiConsent(): Promise<boolean> {
  if (cached !== null) return cached;
  const value = await SecureStore.getItemAsync(CONSENT_KEY);
  cached = value === "1";
  return cached;
}

export async function grantAiConsent(): Promise<void> {
  cached = true;
  await SecureStore.setItemAsync(CONSENT_KEY, "1");
}

export function hasAiConsent(): boolean {
  return cached === true;
}

export function requestAiConsent(): void {
  for (const listener of requestListeners) listener();
}

export function subscribeAiConsentRequested(listener: Listener): () => void {
  requestListeners.add(listener);
  return () => {
    requestListeners.delete(listener);
  };
}

export function clearAiConsent(): void {
  cached = false;
  void SecureStore.deleteItemAsync(CONSENT_KEY);
}
