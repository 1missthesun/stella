/**
 * Only `background` means the UI is genuinely off screen.
 *
 * `inactive` covers the app switcher, the notification shade and an incoming
 * call, where the app can still be partly visible, so animations keep running
 * through it rather than freezing a frame in view.
 */
export const isAppVisible = (appState: string): boolean =>
  appState !== "background";

export type ContinuousAnimationInput = {
  logicalActive: boolean;
  appVisible: boolean;
  reducedMotion: boolean;
};

export const shouldRunContinuousAnimation = ({
  logicalActive,
  appVisible,
  reducedMotion,
}: ContinuousAnimationInput): boolean =>
  logicalActive && appVisible && !reducedMotion;
