import { useEffect, useState, type ReactNode } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { useTheme } from "@/context/theme-context";
import { readLocalOnboardingCompleted, useOnboardingState } from "@/global/onboarding/use-onboarding-state";
import { beginFirstRun } from "@/features/welcome/first-run";
import { platformCapabilities } from "@/platform/capabilities";
import { reportFirstAppPaint } from "@/shell/app-paint";
import { ThemeBackdrop } from "../theme";
import { appRouter } from "../app/routes";
import { holdLaunchSplashUntilLive } from "./launch-splash";
import { AskStellaSelectionChip } from "./selection/AskStellaSelectionChip";

/** `.window-shell.full`: the shifting gradient behind `.full-body`. */
function ShellChrome({ children }: { children: ReactNode }) {
  const { gradientMode, gradientColor } = useTheme();
  return (
    <col id="window-shell" w="full" h="full" grow={1} minH={0} clip={0}>
      <ThemeBackdrop mode={gradientMode} colorMode={gradientColor} />
      <row id="full-body" w="full" grow={1} minH={0}>
        {children}
      </row>
    </col>
  );
}

const HostedChatSurface = () => (
  <>
    <RouterProvider router={appRouter()} />
    <AskStellaSelectionChip />
  </>
);

const WebsiteShell = () => (
  <ShellChrome>
    <HostedChatSurface />
  </ShellChrome>
);

const DesktopFullShell = () => {
  const { completed: onboardingDone, hydrated: onboardingHydrated, complete: completeOnboarding } = useOnboardingState();
  const [hasEnteredApp, setHasEnteredApp] = useState(() => readLocalOnboardingCompleted());

  const onboardingResolved = onboardingHydrated || onboardingDone;
  const appReady = onboardingResolved && onboardingDone && hasEnteredApp;
  const firstRun = onboardingHydrated && !onboardingDone;

  // A new install opens on its chat, whose welcome message offers what setup used to.
  useEffect(() => {
    if (!firstRun) return;
    beginFirstRun();
    completeOnboarding();
  }, [completeOnboarding, firstRun]);

  useEffect(() => {
    if (!onboardingResolved || !onboardingDone) return;
    const timer = window.setTimeout(() => setHasEnteredApp(true), 0);
    return () => window.clearTimeout(timer);
  }, [onboardingDone, onboardingResolved]);

  useEffect(() => reportFirstAppPaint(), []);

  useEffect(() => {
    window.electronAPI?.ui.setAppReady?.(appReady);
  }, [appReady]);

  useEffect(() => {
    if (appReady) holdLaunchSplashUntilLive();
  }, [appReady]);

  return (
    <ShellChrome>
      {appReady ? <HostedChatSurface /> : null}
    </ShellChrome>
  );
};

export const FullShell = () => (platformCapabilities.onboarding ? <DesktopFullShell /> : <WebsiteShell />);
