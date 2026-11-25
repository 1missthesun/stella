import { useSyncExternalStore } from "react";
import { reportCloudReadiness } from "@/features/cloud/cloud-readiness-timing";

export const LAUNCH_SPLASH_MAX_HOLD_MS = 2_000;
export const LAUNCH_SPLASH_EXIT_MS = 260;
const RESCUE_DELAY_MS = 8_000;

export type LaunchSplashPhase = "showing" | "rescue" | "exiting" | "gone";

let phase: LaunchSplashPhase = "showing";
let holdTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

const set = (next: LaunchSplashPhase) => {
  if (phase === next) return;
  phase = next;
  for (const l of [...listeners]) l();
};

const rescueTimer = setTimeout(() => {
  if (phase === "showing") set("rescue");
}, RESCUE_DELAY_MS);

const clearHoldTimer = () => {
  if (holdTimer === null) return;
  clearTimeout(holdTimer);
  holdTimer = null;
};

export function dismissLaunchSplash(): void {
  clearHoldTimer();
  if (phase === "exiting" || phase === "gone") return;
  clearTimeout(rescueTimer);
  reportCloudReadiness("cloud.shell-live");
  set("exiting");
  setTimeout(() => set("gone"), LAUNCH_SPLASH_EXIT_MS);
}

export function holdLaunchSplashUntilLive(): void {
  if (phase === "exiting" || phase === "gone" || holdTimer !== null) return;
  holdTimer = setTimeout(() => {
    holdTimer = null;
    dismissLaunchSplash();
  }, LAUNCH_SPLASH_MAX_HOLD_MS);
}

/** Drops the splash at once, as CrashSurface removes `#stella-launch`. */
export function removeLaunchSplash(): void {
  clearHoldTimer();
  clearTimeout(rescueTimer);
  set("gone");
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export function useLaunchSplashPhase(): LaunchSplashPhase {
  return useSyncExternalStore(subscribe, () => phase);
}
