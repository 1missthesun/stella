import { useMemo, type ReactNode } from "react";
import { LocalI18nProvider } from "@/shared/i18n/I18nProvider";
import { UiStateProvider } from "@/context/ui-state";
import type { WindowSnapshot } from "../../host/electron/browser-window";
import { ThemeProvider } from "../theme";
import { ErrorBoundary } from "./ErrorBoundary";
import { mounted, Nothing } from "./mount";
import { AuxWindowProvider } from "../shell/aux-window";
import { OverlayRoot } from "../shell/overlay/OverlayRoot";

const CompanionMarkRoot = mounted(import.meta.glob("../shell/companion/CompanionMarkRoot.tsx", { eager: true }), "CompanionMarkRoot", Nothing);
const CompanionPanelRoot = mounted(import.meta.glob("../shell/companion/CompanionPanelRoot.tsx", { eager: true }), "CompanionPanelRoot", Nothing);

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
  if (mode === "overlay") return <OverlayRoot />;
  if (mode === "companion") return <CompanionMarkRoot />;
  if (mode === "companion-panel") return <CompanionPanelRoot />;
  return null;
};

/** An app window other than the full shell, by its mode: desktop-ui's overlay and companion entries. */
export function AuxWindow({ snapshot }: { snapshot: WindowSnapshot }) {
  const api = useMemo(() => stella.host?.apiFor(snapshot.id) ?? null, [snapshot.id]);
  const aux = useMemo(() => ({ snapshot, api }), [snapshot, api]);
  const body = bodyFor(snapshot.mode);
  if (!body) return <col w="full" h="full" fill={snapshot.transparent ? undefined : snapshot.backgroundColor} />;
  return (
    <AuxWindowProvider value={aux}>
      <AuxProviders>{body}</AuxProviders>
    </AuxWindowProvider>
  );
}
