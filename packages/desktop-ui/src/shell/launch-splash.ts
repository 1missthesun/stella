import { reportCloudReadiness } from "@/features/cloud/cloud-readiness-timing";

const LAUNCH_SPLASH_ID = "stella-launch";

const LAUNCH_SPLASH_EXIT_MS = 260;

export const LAUNCH_SPLASH_MAX_HOLD_MS = 2_000;

let dismissed = false;
let holdTimer: number | null = null;

const clearHoldTimer = () => {
  if (holdTimer === null) return;
  window.clearTimeout(holdTimer);
  holdTimer = null;
};

export function dismissLaunchSplash(): void {
  clearHoldTimer();
  if (dismissed) return;
  dismissed = true;
  reportCloudReadiness("cloud.shell-live");
  const launch = document.getElementById(LAUNCH_SPLASH_ID);
  if (!launch) return;
  launch.dataset.exiting = "true";
  window.setTimeout(() => {
    launch.remove();
  }, LAUNCH_SPLASH_EXIT_MS);
}

export function holdLaunchSplashUntilLive(): void {
  if (dismissed || holdTimer !== null) return;
  holdTimer = window.setTimeout(() => {
    holdTimer = null;
    dismissLaunchSplash();
  }, LAUNCH_SPLASH_MAX_HOLD_MS);
}

