type ScrollCompositingOptions = {
  commandLine: {
    appendSwitch: (switchName: string, value?: string) => void;
  };
  platform?: NodeJS.Platform;
};

// Below a 1.5 device scale factor Chromium keeps scrollers with transparent
// backgrounds on the main thread to preserve LCD text, so every scrolled frame
// is repainted there. macOS has no LCD text and always composites them.
export const configureScrollCompositing = ({
  commandLine,
  platform = process.platform,
}: ScrollCompositingOptions): boolean => {
  if (platform === "darwin") {
    return false;
  }

  commandLine.appendSwitch("disable-lcd-text");
  return true;
};
