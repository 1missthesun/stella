// `stella.views` on the web, installed at start (web/entry.ts) so the UI draws views here as it does
// on the desktop. The host itself (the session, the TSX compiler, the WebAssembly) loads on first
// use: when a conversation carries a view, or a surface opens one.
import type { ViewSnapshot } from "@stella/views/session";
import type { ViewTheme } from "@stella/views/protocol";
import { VIEW_TOOL, type ViewToolEvent } from "@stella/views/conversation";
import { isViewPath } from "@stella/views/paths";
import type { ViewStorageBackend } from "@stella/views/storage-sync";
import type { WebViewsHost } from "./views-host";

type Message = { toolEvents?: readonly ViewToolEvent[] };

let host: WebViewsHost | null = null;
let loading: Promise<WebViewsHost> | null = null;

const load = (): Promise<WebViewsHost> =>
  (loading ??= import("./views-host").then(
    (m) => {
      host = m.createWebViewsHost();
      if (account !== undefined) host.connectBackend(backend, account);
      return host;
    },
    (error: unknown) => {
      loading = null;
      throw error;
    },
  ));

// Whether a turn ran the `view` tool (the source itself may be in the call rather than the result).
const carriesView = (messages: readonly Message[]) =>
  messages.some((m) => m.toolEvents?.some((e) => e.type === "tool_result" && (e.payload as { toolName?: unknown } | undefined)?.toolName === VIEW_TOOL));

let pending: { messages: readonly Message[]; conversationId: string | null } | null = null;
let backend: ViewStorageBackend | null = null;
/** Not told yet: undefined. */
let account: string | null | undefined;

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
  onNotice(listener: (notice: { filePath: string; kind: "copied" }) => void): () => void {
    if (host) return host.onNotice(listener);
    let release: (() => void) | null = null;
    let released = false;
    void load().then((h) => {
      if (!released) release = h.onNotice(listener);
    }, () => undefined);
    return () => {
      released = true;
      release?.();
    };
  },
  reload: (filePath: string) => host?.reload(filePath),
  syncState: (filePath: string) => host?.syncState(filePath) ?? null,
  /** The signed-in account (`account:<userId>`) and its backend, which views' storage syncs through. */
  connectBackend(client: ViewStorageBackend | null, signedIn?: string | null) {
    backend = client;
    account = signedIn ?? null;
    host?.connectBackend(client, account);
  },
  /** The views a conversation carries (its messages' `view` tool results): the newest of each runs. */
  offerMessages(messages: readonly Message[], conversationId?: string | null) {
    if (host) return host.offerMessages(messages, conversationId);
    if (!pending && !carriesView(messages)) return;
    const first = !pending;
    pending = { messages, conversationId: conversationId ?? null };
    if (!first) return;
    load().then(
      (h) => {
        const latest = pending;
        pending = null;
        if (latest) h.offerMessages(latest.messages, latest.conversationId);
      },
      (error: unknown) => {
        pending = null;
        console.error("[views] the views host didn't load", error);
      },
    );
  },
};
