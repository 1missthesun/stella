import "./platform/swap/swap-runtime";
import "./index.css";
import "./ui/register-styles";
import "./shared/styles/app-base.css";
import "./shared/styles/app-components.css";
import "./shared/i18n/rtl.css";

import "./platform/dev/vite-error-recovery";
import "./shared/lib/interface-preferences";
import { applyLowPowerDocumentFlag } from "./shared/lib/device-perf";
import "./shared/lib/native-font-smoothing";
import { installRendererErrorReporting } from "./platform/diagnostics/report-error";
import { AppRoot } from "./app-root";
import { prefetchAuthSessionBeforeRender } from "./global/auth/services/auth-session";
import { startDomState } from "./platform/view-state/dom-state";
import { mountApp } from "./platform/swap/app-mount";

applyLowPowerDocumentFlag();
installRendererErrorReporting();
prefetchAuthSessionBeforeRender();
if (import.meta.env.VITE_STELLA_WEB_BUILD === "1") {
  void import("./platform/web-renderer-switch").then((module) =>
    module.startWebRendererSwitch(),
  );
  void import("./platform/web-static-home").then((module) =>
    module.adoptStaticHome(),
  );
}

document.documentElement.dataset.stellaWindow = "full";

mountApp(document.getElementById("root")!, AppRoot);
startDomState();
