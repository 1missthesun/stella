export type LinuxWindow = Readonly<{
  id: string;
  pid: number;
  appId: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  workspace: string;
  offscreen: boolean;
  minimized: boolean;
  fullscreen: boolean;
  xwayland: boolean;
  focusOrder?: number;
  scale?: number;
  captureId?: string;
}>;

export type LinuxCapture = Readonly<{
  rgba: Uint8Array;
  width: number;
  height: number;
  scale: number;
  method: string;
}>;

export type LinuxFocusSnapshot = Readonly<{
  windowId: string | null;
  pointer: { x: number; y: number } | null;
  workspaces: readonly string[];
}>;

export type LinuxKeyChord = Readonly<{ mods: readonly string[]; key: string }>;

export class LinuxDesktopUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinuxDesktopUnavailableError";
  }
}

export interface LinuxDesktop {
  readonly name: string;
  listWindows(): Promise<LinuxWindow[]>;
  focusedWindowId(): Promise<string | null>;
  pointer(): Promise<{ x: number; y: number } | null>;
  captureWindow(window: LinuxWindow): Promise<LinuxCapture>;
  prepareWindow(window: LinuxWindow): Promise<void>;
  closeInput?(): Promise<void>;
  release(windowIds: readonly string[]): Promise<void>;
  foreground: {
    snapshot(): Promise<LinuxFocusSnapshot>;
    focus(window: LinuxWindow): Promise<void>;
    movePointer(x: number, y: number): Promise<void>;
    click(button: "left" | "right" | "middle", count: number): Promise<void>;
    drag(path: readonly { x: number; y: number }[]): Promise<void>;
    scroll(dx: number, dy: number): Promise<void>;
    pressKey(window: LinuxWindow, chord: LinuxKeyChord): Promise<void>;
    typeText(window: LinuxWindow, text: string): Promise<void>;
    restore(snapshot: LinuxFocusSnapshot): Promise<void>;
  };
}
