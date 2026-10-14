import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { RouterProvider } from "@tanstack/react-router";
import { useTheme } from "@/context/theme-context";
import {
  readLocalOnboardingCompleted,
  useOnboardingState,
} from "@/global/onboarding/use-onboarding-state";
import { setPendingComposerDraft } from "@/global/onboarding/chat/pending-handoff";
import type { OnboardingChatHandoff } from "@/global/onboarding/chat/use-onboarding-chat";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import { router } from "@/router";
import { ShiftingGradient } from "./background/ShiftingGradient";
import { AskStellaSelectionChip } from "./selection/AskStellaSelectionChip";
import "./full-shell.layout.css";
import "./mobile.css";
import { platformCapabilities } from "@/platform/capabilities";
import {
  dismissLaunchSplash,
  holdLaunchSplashUntilLive,
} from "./launch-splash";
import { reportFirstAppPaint } from "./app-paint";

const onboardingChunkPromise: { current: Promise<unknown> | null } = {
  current: null,
};
const loadOnboardingChunk = () => {
  if (!onboardingChunkPromise.current) {
    onboardingChunkPromise.current = import(
      "@/global/onboarding/chat/OnboardingChat"
    );
  }
  return onboardingChunkPromise.current;
};

const OnboardingChatView = lazy(() =>
  import("@/global/onboarding/chat/OnboardingChat").then((module) => ({
    default: module.OnboardingChat,
  })),
);

type OnboardingExperienceProps = {
  onEnteredApp: () => void;
};

function OnboardingExperience({ onEnteredApp }: OnboardingExperienceProps) {
  const { completed: onboardingDone, complete: completeOnboarding } =
    useOnboardingState();
  const { hasConnectedAccount } = useAuthSessionState();

  useEffect(() => {
    let cancelled = false;
    void loadOnboardingChunk().finally(() => {
      if (!cancelled) dismissLaunchSplash();
    });
    return () => {
      cancelled = true;
    };
  }, []);

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

  return (
    <Suspense fallback={null}>
      <OnboardingChatView
        isAuthenticated={hasConnectedAccount}
        onComplete={handleComplete}
      />
    </Suspense>
  );
}

function ShellChrome({
  windowMode,
  children,
}: {
  windowMode: "app" | "onboarding";
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
    <RouterProvider router={router} />
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
  const { completed: onboardingDone, hydrated: onboardingHydrated } =
    useOnboardingState();
  const [hasEnteredApp, setHasEnteredApp] = useState(() =>
    readLocalOnboardingCompleted(),
  );

  const onboardingResolved = onboardingHydrated || onboardingDone;
  const appReady = onboardingResolved && onboardingDone && hasEnteredApp;
  const needsOnboarding = onboardingHydrated && !onboardingDone;

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
    <ShellChrome windowMode={needsOnboarding ? "onboarding" : "app"}>
      {appReady ? (
        <HostedChatSurface />
      ) : needsOnboarding ? (
        <OnboardingExperience onEnteredApp={() => setHasEnteredApp(true)} />
      ) : null}
    </ShellChrome>
  );
};

export const FullShell = () =>
  platformCapabilities.onboarding ? <DesktopFullShell /> : <WebsiteShell />;
