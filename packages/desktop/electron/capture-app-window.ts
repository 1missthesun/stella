import { captureWindowScreenshotByPid } from "./window-capture.js";

export type AppWindowCapture = {
  title: string;
  axTree?: string | null;
  screenshot: {
    dataUrl: string;
    width: number;
    height: number;
  };
};

export const captureAppWindow = async (
  pid: number,
): Promise<AppWindowCapture | null> => {
  if (process.platform !== "darwin" && process.platform !== "win32") return null;
  try {
    const capture = await captureWindowScreenshotByPid(pid);
    if (!capture) return null;
    return {
      title: capture.windowInfo.title ?? "",
      axTree: capture.axTree ?? capture.windowInfo.axTree ?? null,
      screenshot: capture.screenshot,
    };
  } catch (error) {
    console.warn("[home] captureWindowScreenshotByPid failed", error);
    return null;
  }
};
