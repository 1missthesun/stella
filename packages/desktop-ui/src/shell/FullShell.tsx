import { useEffect, useState, type ReactNode } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { useTheme } from "@/context/theme-context";
import {
  readLocalOnboardingCompleted,
  useOnboardingState,
} from "@/global/onboarding/use-onboarding-state";
import { beginFirstRun } from "@/features/welcome/first-run";
import { routerFor } from "@/router";
import { routeTree } from "@/routeTree.gen";
import { ShiftingGradient } from "./background/ShiftingGradient";
import { AskStellaSelectionChip } from "./selection/AskStellaSelectionChip";
import "./full-shell.layout.css";
import "./mobile.css";
import { platformCapabilities } from "@/platform/capabilities";
import { holdLaunchSplashUntilLive } from "./launch-splash";
import { reportFirstAppPaint } from "./app-paint";

function ShellChrome({
  windowMode,
  children,
}: {
  windowMode: "app";
  children: ReactNode;
}) {
  const { gradientMode, gradientColor } = useTheme();
  return (
    <div className="window-shell full" data-window-mode={windowMode}>
      <ShiftingGradient
        mode={gradientMode}
        colorMode={gradientColor}
        lightweight={false}
      />
      <div className="full-body">{children}</div>
    </div>
  );
}

const HostedChatSurface = () => (
  <>
    <RouterProvider router={routerFor(routeTree)} />
    <AskStellaSelectionChip />
  </>
);

const WebsiteShell = () => {
  return (
    <ShellChrome windowMode="app">
      <HostedChatSurface />
    </ShellChrome>
  );
};

const DesktopFullShell = () => {
  const {
    completed: onboardingDone,
    hydrated: onboardingHydrated,
    complete: completeOnboarding,
  } = useOnboardingState();
  const [hasEnteredApp, setHasEnteredApp] = useState(() =>
    readLocalOnboardingCompleted(),
  );

  const onboardingResolved = onboardingHydrated || onboardingDone;
  const appReady = onboardingResolved && onboardingDone && hasEnteredApp;
  const firstRun = onboardingHydrated && !onboardingDone;

  // There is no setup to go through: a new install opens on its chat, whose
  // welcome message offers what setup used to.
  useEffect(() => {
    if (!firstRun) return;
    beginFirstRun();
    completeOnboarding();
  }, [completeOnboarding, firstRun]);

  useEffect(() => {
    if (!onboardingResolved || !onboardingDone) return;
    const timer = window.setTimeout(() => {
      setHasEnteredApp(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [onboardingDone, onboardingResolved]);

  useEffect(() => {
    reportFirstAppPaint();
  }, []);

  useEffect(() => {
    window.electronAPI?.ui.setAppReady?.(appReady);
  }, [appReady]);

  useEffect(() => {
    if (appReady) {
      holdLaunchSplashUntilLive();
    }
  }, [appReady]);

  return (
    <ShellChrome windowMode="app">
      {appReady ? <HostedChatSurface /> : null}
    </ShellChrome>
  );
};

export const FullShell = () =>
  platformCapabilities.onboarding ? <DesktopFullShell /> : <WebsiteShell />;
