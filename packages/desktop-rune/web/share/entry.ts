// The page a shared Stella View opens on (stella.sh/c/<slug>; web/share/build.ts): the view's
// version written into the page by the share Worker runs here in PsychoScript's WebAssembly, as the
// web chat runs views (web/views), for a visitor with no Stella account. Its storage is local to
// the visitor's browser, and it can't ask Stella or send to a chat; everything else a view can do
// is the browser's (fetch subject to CORS, clipboard, links, downloads, notifications).
import "../globals";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { parseSharedViewPayload, VIEW_SHARE_PAYLOAD_ELEMENT_ID } from "@stella/contracts/view-share";
import { installSheet } from "../dom/sheet";
import { pressedByKeys } from "../dom/host";
import { createWebViewsHost } from "../views/views-host";
import { preloadViews } from "../views/wasm-vm";
import { LocalI18nProvider } from "@/shared/i18n/I18nProvider";
import { SharedViewPage } from "../../ui/views/SharedViewPage";

const ONLY_IN_STELLA = (what: string) => async () => {
  throw new Error(`${what} works only inside Stella, not on a shared view.`);
};

preloadViews();
installSheet();

const views = createWebViewsHost({
  capabilities: (browser) => ({ ...browser, ask: ONLY_IN_STELLA("stella.ask"), send: ONLY_IN_STELLA("stella.send") }),
});
(globalThis as Record<string, unknown>).stella = {
  now: () => performance.timeOrigin + performance.now(),
  command: () => {},
  windowPortal: () => null,
  pressedByKeys,
  views,
};

const root = document.getElementById("root")!;
const element = document.getElementById(VIEW_SHARE_PAYLOAD_ELEMENT_ID);
let payload: ReturnType<typeof parseSharedViewPayload> = null;
try {
  payload = element ? parseSharedViewPayload(JSON.parse(element.textContent ?? "")) : null;
} catch {
  payload = null;
}
if (!payload) {
  root.textContent = "This shared view couldn't be read.";
} else {
  const slug = /^\/c\/([^/]+)/u.exec(location.pathname)?.[1] ?? "view";
  // Its own file per link, so each shared view keeps its own storage in this browser.
  const filePath = `shared/${slug}.view.tsx`;
  views.offerMessages([
    {
      toolEvents: [
        {
          type: "tool_result",
          timestamp: payload.createdAt,
          payload: { toolName: "view", details: { filePath, slug, title: payload.title, source: payload.source, createdAt: payload.createdAt, ...(payload.data !== undefined ? { data: payload.data } : {}) } },
        },
      ],
    },
  ]);
  createRoot(root).render(createElement(LocalI18nProvider, null, createElement(SharedViewPage, { filePath })));
}
