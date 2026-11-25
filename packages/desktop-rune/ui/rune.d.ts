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
    now: () => number;
    /** The runtime's default conversation, when the host runs Stella's services. */
    chat?: { conversationId: string; send(text: string): Promise<void> };
  };
}
