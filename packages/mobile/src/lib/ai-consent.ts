/**
 * Tracks whether the user has explicitly agreed to share data with the
 * third-party AI providers Stella routes through (DeepSeek directly, plus
 * OpenRouter / Fireworks gateways → Anthropic / OpenAI / Google for text;
 * Meta Muse for voice transcription; OpenAI for live realtime audio).
 *
 * Required by App Store Review Guideline 5.1.1(i) / 5.1.2(i): we must
 * disclose what is sent, who it is sent to, and get the user's permission
 * BEFORE any data leaves the device.
 */

import * as SecureStore from "./secure-store";
import { isSelfHostedLaunch } from "./server-registry";

// Version 4 names Meta Muse as the direct transcription recipient. Do not
// silently treat consent naming xAI as consent to a different company.
// A self-hosted server names different recipients (the owner's server and
// the AI accounts connected to it), so it asks for its own consent.
const CONSENT_KEY = isSelfHostedLaunch
  ? "stella-mobile_ai-data-consent-selfhosted-v1"
  : "stella-mobile_ai-data-consent-v4";

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
