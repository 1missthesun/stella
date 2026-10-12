import type { WebContents } from "electron";

const listeners = new WeakMap<WebContents, Array<() => void>>();

export const noteAppPainted = (contents: WebContents): void => {
  const pending = listeners.get(contents);
  if (!pending) return;
  listeners.delete(contents);
  for (const listener of pending) listener();
};

export const onceAppPainted = (contents: WebContents, listener: () => void): void => {
  listeners.set(contents, [...(listeners.get(contents) ?? []), listener]);
};

let markStartupPainted: () => void = () => undefined;
export const startupAppPainted = new Promise<void>((resolve) => {
  markStartupPainted = resolve;
});
export const noteStartupAppPainted = (): void => markStartupPainted();
