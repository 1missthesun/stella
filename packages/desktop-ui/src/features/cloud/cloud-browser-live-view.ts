const LIVE_VIEW_ORIGIN = "https://live.browser.run";

export const parseCloudBrowserLiveViewUrl = (value: string): URL | null => {
  try {
    const url = new URL(value);
    if (url.origin !== LIVE_VIEW_ORIGIN) return null;
    if (url.username || url.password || url.port) return null;
    return url;
  } catch {
    return null;
  }
};

