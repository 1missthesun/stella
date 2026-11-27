// Rune host elements for JSX: the prop types live in host/rune-jsx/props.ts (host/ELEMENTS.md).
import type {} from "react";

export type * from "../host/rune-jsx/props";

declare global {
  // eslint-disable-next-line no-var
  var stella: {
    store: import("../host/store").Store;
    useStore: <T>(sel: (s: import("../host/store").AppState) => T) => T;
    command: (v: Record<string, unknown>) => void;
    engine: typeof import("../host/bridge").engine;
    on: typeof import("../host/bridge").onEngineEvent;
    now: () => number;
    /** Renders a `<window>` as a root child from anywhere in the tree, keeping context. */
    windowPortal: typeof import("../host/reconciler").windowPortal;
    /** Whether the press being handled came from Return or Space, not the pointer (a menu the keys opened focuses its first item). */
    pressedByKeys: () => boolean;
    /** The runtime's default conversation, when the host runs Stella's services. */
    chat?: { conversationId: string; send(text: string): Promise<void> };
    /** Electron main's windows, their electronAPI and message boxes, when the host runs Stella's services. */
    host?: import("../host/services/ui-host").UiHost;
    /** Runs Stella Views (`*.view.tsx`) on the engine's script VM and hands their trees to the UI. */
    views?: import("../host/views/views-host").ViewsHost & {
      /** Hosts without the views' files (the web) run the newest version each conversation's `view` tool results carry. */
      offerMessages?(messages: readonly { toolEvents?: readonly import("@stella/views/conversation").ViewToolEvent[] }[]): void;
    };
  };
}
