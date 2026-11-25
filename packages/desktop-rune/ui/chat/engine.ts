export type { MenuItem as NativeMenuItem } from "../../host/bridge";

/** The engine API (`host/bridge`'s `engine`) as the host exposes it to the UI bundle. */
export const rune = () => globalThis.stella.engine;
