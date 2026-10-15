// Messages between Electron main and the panel mirror of an offscreen agent tab
// (offscreen-tabs.ts and electron/offscreen-tab-mirror-preload.ts).

export const MIRROR_FRAME_CHANNEL = "offscreen-mirror:frame";
export const MIRROR_FRAME_ACK_CHANNEL = "offscreen-mirror:frame-ack";
export const MIRROR_CURSOR_CHANNEL = "offscreen-mirror:cursor";
export const MIRROR_INPUT_CHANNEL = "offscreen-mirror:input";

/**
 * One painted region of the tab (offscreen tabs render at scale 1, so these
 * are CSS pixels too). The payload sent with it is the region's BGRA
 * premultiplied pixels, row by row.
 */
export type MirrorFrame = {
  frameWidth: number;
  frameHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MirrorModifier =
  | "shift"
  | "control"
  | "alt"
  | "meta"
  | "leftbuttondown"
  | "middlebuttondown"
  | "rightbuttondown";

/** Input in page CSS pixels, shaped like Electron's `sendInputEvent` events. */
export type MirrorInput =
  | {
      type: "mouseDown" | "mouseUp" | "mouseMove" | "mouseLeave";
      x: number;
      y: number;
      button?: "left" | "middle" | "right";
      clickCount?: number;
      modifiers: MirrorModifier[];
    }
  | {
      type: "mouseWheel";
      x: number;
      y: number;
      deltaX: number;
      deltaY: number;
      modifiers: MirrorModifier[];
    }
  | {
      type: "keyDown" | "keyUp" | "char";
      keyCode: string;
      modifiers: MirrorModifier[];
    }
  | { type: "insertText"; text: string };
