/**
 * Whether the phone shows its voice/call controls at all.
 *
 * Mirrors the desktop `realtimeVoice.enabled` preference: voice is off until
 * the user turns it on in Settings, and the controls are not rendered while
 * it is off. Dictation is a separate feature and never consults this flag.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "stella-mobile_voice.enabled";

type Listener = (enabled: boolean) => void;

let enabled = false;
const listeners = new Set<Listener>();

export function getVoiceEnabled(): boolean {
  return enabled;
}

export async function loadVoiceEnabled(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    enabled = raw === "1";
  } catch {
    enabled = false;
  }
  for (const fn of listeners) fn(enabled);
  return enabled;
}

export async function setVoiceEnabled(next: boolean): Promise<void> {
  enabled = next;
  try {
    if (next) {
      await AsyncStorage.setItem(STORAGE_KEY, "1");
    } else {
      await AsyncStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // ignore — in-memory value still wins until next reload
  }
  for (const fn of listeners) fn(enabled);
}

export function subscribeVoiceEnabled(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
