import { memo, useMemo, type ReactNode } from "react";
import { LocalI18nProvider } from "@/shared/i18n/I18nProvider";
import { UiStateProvider } from "@/context/ui-state";
import type { WindowSnapshot } from "../../host/electron/browser-window";
import { ThemeProvider } from "../theme";
import { ErrorBoundary } from "./ErrorBoundary";
import { lazyScreen, useLazyReady, type LazyScreen } from "../kit/lazy";
import { AuxWindowProvider } from "../shell/aux-window";
import { OverlayRoot } from "../shell/overlay/OverlayRoot";
import { VoiceRuntimeRoot } from "@/features/voice/runtime/VoiceRuntimeRoot";

const CompanionMarkRoot = lazyScreen(() => import("../shell/companion/CompanionMarkRoot"), (module) => module.CompanionMarkRoot);
const CompanionPanelRoot = lazyScreen(() => import("../shell/companion/CompanionPanelRoot"), (module) => module.CompanionPanelRoot);
/** Companion windows load their surface when one opens. */
const LAZY_BODY: Record<string, LazyScreen<object>> = { companion: CompanionMarkRoot, "companion-panel": CompanionPanelRoot };

function AuxProviders({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <LocalI18nProvider>
        <ThemeProvider>
          <UiStateProvider>{children}</UiStateProvider>
        </ThemeProvider>
      </LocalI18nProvider>
    </ErrorBoundary>
  );
}

const bodyFor = (mode: string | null) => {
  if (mode === "overlay") return <><VoiceRuntimeRoot /><OverlayRoot /></>;
  if (mode === "companion") return <CompanionMarkRoot />;
  if (mode === "companion-panel") return <CompanionPanelRoot />;
  return null;
};

/** An app window other than the full shell, by its mode: desktop-ui's overlay and companion entries. */
export const AuxWindow = memo(function AuxWindow({ snapshot }: { snapshot: WindowSnapshot }) {
  const api = useMemo(() => stella.host?.apiFor(snapshot.id) ?? null, [snapshot.id]);
  const aux = useMemo(() => ({ snapshot, api }), [snapshot, api]);
  const lazyBody = snapshot.mode ? LAZY_BODY[snapshot.mode] : undefined;
  const ready = useLazyReady(Boolean(lazyBody), ...(lazyBody ? [lazyBody] : []));
  const body = ready ? bodyFor(snapshot.mode) : null;
  if (!body) return <col w="full" h="full" fill={snapshot.transparent ? undefined : snapshot.backgroundColor} />;
  return (
    <AuxWindowProvider value={aux}>
      <AuxProviders>{body}</AuxProviders>
    </AuxWindowProvider>
  );
});
