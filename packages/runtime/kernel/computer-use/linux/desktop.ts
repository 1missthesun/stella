/**
 * What Linux computer use needs from the desktop it runs on: which windows
 * exist, which one the user has, a picture of one window even when it is
 * covered or on another workspace, and (only for delivery: "foreground")
 * real input. Hyprland is the first implementation (hyprland.ts); GNOME,
 * KDE and X11 slot in behind the same interface.
 */

export type LinuxWindow = Readonly<{
  /** Stable id Stella hands to agents (`window_id`). */
  id: string;
  pid: number;
  appId: string;
  title: string;
  /** Logical (layout) pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  workspace: string;
  /** On a workspace no monitor shows right now. */
  offscreen: boolean;
  minimized: boolean;
  fullscreen: boolean;
  xwayland: boolean;
  /** Most recently focused first, when the desktop knows. */
  focusOrder?: number;
  /** Device pixels per logical pixel on the window's monitor. */
  scale?: number;
  /** The desktop's own handle for capturing this window. */
  captureId?: string;
}>;

export type LinuxCapture = Readonly<{
  /** Row-major RGBA at the window's logical size. */
  rgba: Uint8Array;
  width: number;
  height: number;
  /** Device pixels per logical pixel in the raw capture. */
  scale: number;
  method: string;
}>;

/** What the user had before a foreground action, to give it back. */
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
  /**
   * Called when Stella first looks at a window: stop it from taking the
   * user's focus on its own (apps "activate" themselves after some actions)
   * and keep it drawing while it is not on screen, so pictures stay current.
   */
  prepareWindow(window: LinuxWindow): Promise<void>;
  /** Closes input devices Stella opened for foreground actions. */
  closeInput?(): Promise<void>;
  /** Undoes prepareWindow for these windows. */
  release(windowIds: readonly string[]): Promise<void>;
  foreground: {
    snapshot(): Promise<LinuxFocusSnapshot>;
    focus(window: LinuxWindow): Promise<void>;
    /** Layout coordinates (logical px). Moves the user's real cursor. */
    movePointer(x: number, y: number): Promise<void>;
    click(button: "left" | "right" | "middle", count: number): Promise<void>;
    drag(path: readonly { x: number; y: number }[]): Promise<void>;
    /** Wheel scroll in pixels at the pointer (positive = down/right). */
    scroll(dx: number, dy: number): Promise<void>;
    pressKey(window: LinuxWindow, chord: LinuxKeyChord): Promise<void>;
    typeText(window: LinuxWindow, text: string): Promise<void>;
    restore(snapshot: LinuxFocusSnapshot): Promise<void>;
  };
}
