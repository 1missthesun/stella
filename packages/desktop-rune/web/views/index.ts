// `stella.views` on the web, installed at start (web/entry.ts) so the UI draws views here as it does
// on the desktop. The host itself (the session, the TSX compiler, the WebAssembly) loads on first
// use: when a conversation carries a view, or a surface opens one.
import type { ViewSnapshot } from "@stella/views/session";
import type { ViewTheme } from "@stella/views/protocol";
import { VIEW_TOOL, type ViewToolEvent } from "@stella/views/conversation";
import { isViewPath } from "@stella/views/paths";
import type { WebViewsHost } from "./views-host";

type Message = { toolEvents?: readonly ViewToolEvent[] };

let host: WebViewsHost | null = null;
let loading: Promise<WebViewsHost> | null = null;

const load = (): Promise<WebViewsHost> =>
  (loading ??= import("./views-host").then(
    (m) => (host = m.createWebViewsHost()),
    (error: unknown) => {
      loading = null;
      throw error;
    },
  ));

// Whether a turn ran the `view` tool (the source itself may be in the call rather than the result).
const carriesView = (messages: readonly Message[]) =>
  messages.some((m) => m.toolEvents?.some((e) => e.type === "tool_result" && (e.payload as { toolName?: unknown } | undefined)?.toolName === VIEW_TOOL));

let pending: readonly Message[] | null = null;

export const webViews = {
  isViewPath,
  subscribe(filePath: string, theme: ViewTheme, listener: (snapshot: ViewSnapshot) => void): () => void {
    if (host) return host.subscribe(filePath, theme, listener);
    let release: (() => void) | null = null;
    let released = false;
    load().then(
      (h) => {
        if (!released) release = h.subscribe(filePath, theme, listener);
      },
      (error: unknown) => console.error("[views] the views host didn't load", error),
    );
    return () => {
      released = true;
      release?.();
    };
  },
  snapshot: (filePath: string): ViewSnapshot | null => host?.snapshot(filePath) ?? null,
  dispatch: (filePath: string, handler: number, value?: unknown) => host?.dispatch(filePath, handler, value),
  key: (filePath: string, chord: string) => host?.key(filePath, chord),
  viewport: (filePath: string, width: number, height: number) => host?.viewport(filePath, width, height),
  theme: (filePath: string, theme: ViewTheme) => host?.theme(filePath, theme),
  restart: (filePath: string) => host?.restart(filePath),
  logs: (filePath: string) => host?.logs(filePath) ?? [],
  reload: (filePath: string) => host?.reload(filePath),
  /** The views a conversation carries (its messages' `view` tool results): the newest of each runs. */
  offerMessages(messages: readonly Message[]) {
    if (host) return host.offerMessages(messages);
    if (!pending && !carriesView(messages)) return;
    const first = !pending;
    pending = messages;
    if (!first) return;
    load().then(
      (h) => {
        const latest = pending;
        pending = null;
        if (latest) h.offerMessages(latest);
      },
      (error: unknown) => {
        pending = null;
        console.error("[views] the views host didn't load", error);
      },
    );
  },
};
