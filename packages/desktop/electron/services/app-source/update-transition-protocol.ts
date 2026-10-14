export type Rect = { x: number; y: number; w: number; h: number };

export type LiveRectTuple = [number, number, number, number];

export type MotionKeyframe = {
  [property: string]: string | number | null | undefined;
  offset?: number | null;
  easing?: string;
};

export type MotionTiming = {
  duration: number;
  delay?: number;
  easing?: string;
  fill?: "none" | "forwards" | "backwards" | "both" | "auto";
};

export type Motion = { keyframes: MotionKeyframe[]; timing: MotionTiming };

export type FocusPullMotion = { out: Motion; in: Motion };
export type FrostMotion = {
  frost: Motion;
  shownMs: number;
  tintLight: string;
  tintDark: string;
  blur: number;
  saturate: number;
};
export type HoldOptions = {
  labelDelayMs: number;
  heldMs: number;
  dark: boolean;
  label: string;
  markSvg: string;
  appear: Motion;
};
export type FocusInMotion = { focus: Motion; fade: Motion; leave: Motion };
export type RevealItem = {
  rect: Rect;
  feather: [number, number, number, number];
  after: string;
};
export type RevealReport = {
  prepMs: number;
};

export type UpdateTransitionApi = {
  cover(url: string, liveRects: LiveRectTuple[]): Promise<void>;
  fillLive(): void;
  reveal(
    items: RevealItem[],
    whole: boolean,
    motion: FocusPullMotion,
  ): Promise<RevealReport>;
  frost(motion: FrostMotion): Promise<{ frosted: string; dark: boolean }>;
  frosted(): Promise<void>;
  renderMark(svg: string, dark: boolean, size: number): Promise<string>;
  hold(url: string, options: HoldOptions): Promise<void>;
  focusIn(url: string, motion: FocusInMotion): Promise<void>;
  clear(): void;
};
