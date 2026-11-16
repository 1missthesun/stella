import { isWebsiteHost } from "@/platform/capabilities";

export type FeedbackClientInfo = { appVersion?: string; platform: string };

const browserName = (ua: string): string => {
  if (/\bEdg\//.test(ua)) return "Edge";
  if (/\bOPR\//.test(ua)) return "Opera";
  if (/\bFirefox\//.test(ua)) return "Firefox";
  if (/\bChrome\//.test(ua)) return "Chrome";
  if (/\bVersion\/[\d.]+.*\bSafari\//.test(ua)) return "Safari";
  return "a browser";
};

const systemName = (ua: string): string => {
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Android/.test(ua)) return "Android";
  if (/Mac OS X|Macintosh/.test(ua)) return "macOS";
  if (/Windows/.test(ua)) return "Windows";
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Linux/.test(ua)) return "Linux";
  return "an unknown system";
};

const webInfo = (): FeedbackClientInfo => {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const version = import.meta.env.VITE_STELLA_WEB_VERSION;
  return {
    platform: `Web · ${browserName(ua)} on ${systemName(ua)}`,
    ...(typeof version === "string" && version ? { appVersion: version } : {}),
  };
};

/** What the feedback dialog sends (and shows it sends) about this copy of Stella. */
export const readFeedbackClientInfo = async (): Promise<FeedbackClientInfo> => {
  const api = window.electronAPI;
  if (isWebsiteHost() || !api) return webInfo();
  try {
    const info = await api.system.getReleaseInfo();
    return { appVersion: info.appVersion, platform: `Desktop · ${info.platform}` };
  } catch {
    return { platform: `Desktop · ${api.platform}` };
  }
};
