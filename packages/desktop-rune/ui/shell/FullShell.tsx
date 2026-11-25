import { useCallback, useEffect, useState, type ReactNode } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { useTheme } from "@/context/theme-context";
import { readLocalOnboardingCompleted, useOnboardingState } from "@/global/onboarding/use-onboarding-state";
import { setPendingComposerDraft } from "@/global/onboarding/chat/pending-handoff";
import type { OnboardingChatHandoff } from "@/global/onboarding/chat/use-onboarding-chat";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import { platformCapabilities } from "@/platform/capabilities";
import { reportFirstAppPaint } from "@/shell/app-paint";
import { ThemeBackdrop } from "../theme";
import { appRouter } from "../app/routes";
import { mounted, Nothing } from "../app/mount";
import { dismissLaunchSplash, holdLaunchSplashUntilLive } from "./launch-splash";
import { AskStellaSelectionChip } from "./selection/AskStellaSelectionChip";

type OnboardingChatProps = { isAuthenticated: boolean; onComplete: (handoff: OnboardingChatHandoff) => void };
const OnboardingChatView = mounted<OnboardingChatProps>(import.meta.glob("../replace/global/onboarding/chat/OnboardingChat.tsx", { eager: true }), "OnboardingChat", Nothing);

function OnboardingExperience({ onEnteredApp }: { onEnteredApp: () => void }) {
  const { completed: onboardingDone, complete: completeOnboarding } = useOnboardingState();
  const { hasConnectedAccount } = useAuthSessionState();

  useEffect(() => dismissLaunchSplash(), []);

  useEffect(() => {
    if (!onboardingDone) return;
    onEnteredApp();
  }, [onEnteredApp, onboardingDone]);

  const handleComplete = useCallback(
    (handoff: OnboardingChatHandoff) => {
      if (handoff.composerDraft) setPendingComposerDraft(handoff.composerDraft);
      completeOnboarding();
    },
    [completeOnboarding],
  );

  return <OnboardingChatView isAuthenticated={hasConnectedAccount} onComplete={handleComplete} />;
}

/** `.window-shell.full`: the shifting gradient behind `.full-body`. */
function ShellChrome({ windowMode, children }: { windowMode: "app" | "onboarding"; children: ReactNode }) {
  const { gradientMode, gradientColor } = useTheme();
  return (
    <col id="window-shell" w="full" h="full" grow={1} minH={0} clip={0} label={windowMode === "onboarding" ? "Onboarding" : undefined}>
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
  <ShellChrome windowMode="app">
    <HostedChatSurface />
  </ShellChrome>
);

const DesktopFullShell = () => {
  const { completed: onboardingDone, hydrated: onboardingHydrated } = useOnboardingState();
  const [hasEnteredApp, setHasEnteredApp] = useState(() => readLocalOnboardingCompleted());

  const onboardingResolved = onboardingHydrated || onboardingDone;
  const appReady = onboardingResolved && onboardingDone && hasEnteredApp;
  const needsOnboarding = onboardingHydrated && !onboardingDone;

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
    <ShellChrome windowMode={needsOnboarding ? "onboarding" : "app"}>
      {appReady ? <HostedChatSurface /> : needsOnboarding ? <OnboardingExperience onEnteredApp={() => setHasEnteredApp(true)} /> : null}
    </ShellChrome>
  );
};

export const FullShell = () => (platformCapabilities.onboarding ? <DesktopFullShell /> : <WebsiteShell />);
