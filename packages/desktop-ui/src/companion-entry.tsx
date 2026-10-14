import { createRoot } from "react-dom/client";
import "./index.css";
import "./ui/register-styles";
import { ThemeProvider } from "./context/theme-context";
import { ErrorBoundary } from "./shell/ErrorBoundary";
import { UiStateProvider } from "./context/ui-state";
import { LocalI18nProvider } from "./shared/i18n/I18nProvider";
import { ToastProvider } from "./ui/toast";
import { applyLowPowerDocumentFlag } from "./shared/lib/device-perf";
import { CompanionMarkRoot } from "./shell/companion/CompanionMarkRoot";
import { CompanionPanelRoot } from "./shell/companion/CompanionPanelRoot";

applyLowPowerDocumentFlag();
document.documentElement.dataset.stellaWindow = "companion";

const kind =
  new URLSearchParams(window.location.search).get("window") ===
  "companion-panel"
    ? "panel"
    : "mark";

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <LocalI18nProvider>
      <ThemeProvider>
        <ToastProvider>
          <UiStateProvider>
            {kind === "panel" ? <CompanionPanelRoot /> : <CompanionMarkRoot />}
          </UiStateProvider>
        </ToastProvider>
      </ThemeProvider>
    </LocalI18nProvider>
  </ErrorBoundary>,
);
