"use client";

import { useState, useSyncExternalStore } from "react";
import { reportGoogleAdsDownload } from "@/components/google-ads-tag";
import { INSTALL_COMMAND } from "@/lib/downloads";

function AppleIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
    >
      <path d="M16.365 12.86c-.023-2.36 1.93-3.49 2.018-3.546-1.099-1.606-2.81-1.826-3.42-1.852-1.456-.148-2.84.86-3.58.86-.74 0-1.881-.838-3.094-.815-1.59.024-3.057.926-3.874 2.351-1.652 2.863-.422 7.094 1.188 9.418.787 1.138 1.724 2.418 2.954 2.373 1.187-.048 1.636-.768 3.07-.768 1.434 0 1.84.768 3.094.744 1.28-.024 2.09-1.16 2.872-2.303.906-1.32 1.279-2.6 1.301-2.667-.029-.013-2.495-.957-2.529-3.795zM14.07 5.638c.655-.793 1.097-1.895.976-2.99-.944.038-2.085.628-2.762 1.42-.607.7-1.139 1.82-.995 2.894 1.052.082 2.126-.534 2.781-1.324z" />
    </svg>
  );
}

function WindowsIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
    >
      <path d="M3 5.4 11.2 4.3v7.4H3V5.4zm0 13.2v-6.3h8.2v7.4L3 18.6zm9.2-14.4L21 3v8.7h-8.8V4.2zm0 16.8v-8.4H21V21l-8.8-1.2z" />
    </svg>
  );
}

function LinuxIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
    >
      <path d="M12 2c-1.9 0-3.2 1.6-3.2 3.9 0 1.2.3 2.2.3 3.1 0 .9-.6 1.6-1.4 2.7-.9 1.2-2 2.6-2 4.6 0 .5.1.9.3 1.2-.3.3-.5.7-.5 1.2 0 .8.6 1.3 1.4 1.6.8.3 1.8.4 2.7.9.8.5 1.6.9 2.4.9s1.6-.4 2.4-.9c.9-.5 1.9-.6 2.7-.9.8-.3 1.4-.8 1.4-1.6 0-.5-.2-.9-.5-1.2.2-.3.3-.7.3-1.2 0-2-1.1-3.4-2-4.6-.8-1.1-1.4-1.8-1.4-2.7 0-.9.3-1.9.3-3.1C15.2 3.6 13.9 2 12 2zm-1.5 4c.4 0 .7.4.7.9s-.3.9-.7.9-.7-.4-.7-.9.3-.9.7-.9zm3 0c.4 0 .7.4.7.9s-.3.9-.7.9-.7-.4-.7-.9.3-.9.7-.9zM12 9.2c.9 0 1.9.5 1.9 1 0 .3-.4.5-.9.8-.4.2-.7.5-1 .5s-.6-.3-1-.5c-.5-.3-.9-.5-.9-.8 0-.5 1-1 1.9-1z" />
    </svg>
  );
}

function PlayIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
    >
      <path d="M6 3.6v16.8c0 .8.9 1.3 1.6.9l13.3-8.4c.6-.4.6-1.3 0-1.7L7.6 2.8C6.9 2.3 6 2.8 6 3.6z" />
    </svg>
  );
}

const DOWNLOADS = {
  mac: "/download/mac",
  windows: "/download/windows",
  linux: "/download/linux",
  linuxArm64: "/download/linux-arm64",
} as const;

export const APP_STORE_URL = "https://apps.apple.com/us/app/stella-your-ai/id6761148311";
export const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.fromyou.stella";
const DOWNLOAD_PAGE_PATH = "/download";

/**
 * "unknown" is the server render and anything we can't place: it links to
 * /download, which lists every build, so nothing is downloaded on a guess.
 */
export type Platform = "unknown" | "mac" | "windows" | "linux" | "ios" | "android";

const ariaLabels: Record<"mac" | "windows" | "linux", string> = {
  mac: "Download for Mac",
  windows: "Download for Windows",
  linux: "Install Stella for Linux",
};

function subscribeNoop() {
  return () => {};
}

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (ua.includes("android")) return "android";
  if (ua.includes("mac")) {
    // iPadOS Safari asks for the desktop site with a Mac user agent; only the
    // touch screen tells it apart from a Mac.
    return navigator.maxTouchPoints > 0 ? "ios" : "mac";
  }
  if (ua.includes("windows")) return "windows";
  if (ua.includes("linux") || ua.includes("cros") || ua.includes("x11")) return "linux";
  return "unknown";
}

export function usePlatform(): Platform {
  return useSyncExternalStore<Platform>(
    subscribeNoop,
    detectPlatform,
    () => "unknown",
  );
}

export function isPhonePlatform(platform: Platform): platform is "ios" | "android" {
  return platform === "ios" || platform === "android";
}

/** On a phone: get the desktop link onto the computer without downloading anything here. */
export function SendToComputer({ className }: { className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function send() {
    const url = `${window.location.origin}${DOWNLOAD_PAGE_PATH}`;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: "Stella for your computer",
          text: "Download Stella on your computer:",
          url,
        });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2500);
  }

  return (
    <p className={["download-handoff", className].filter(Boolean).join(" ")}>
      <span>
        For your computer: <strong>stella.sh/download</strong>
      </span>
      <button type="button" className="download-handoff__send" onClick={send}>
        {state === "copied" ? "Link copied" : state === "failed" ? "Copy failed" : "Send link"}
      </button>
    </p>
  );
}

export function LinuxInstallOptions({
  onSelectAsset,
}: {
  onSelectAsset?: (url: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard denied (insecure context, permissions). The command is
      // visible and selectable in the DOM either way.
    }
  }

  return (
    <>
      <div className="download-menu__install">
        <strong>One-line install</strong>
        <span>Installs the launcher and adds Stella to your app menu.</span>
        <code data-testid="linux-install-command">{INSTALL_COMMAND}</code>
        <button
          type="button"
          className="button button--compact"
          onClick={copyCommand}
          aria-label="Copy the Stella install command"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <a
        className="download-menu__option"
        href={DOWNLOADS.linux}
        onClick={(event) => {
          event.preventDefault();
          onSelectAsset?.(DOWNLOADS.linux);
        }}
      >
        <strong>Launcher (x64)</strong>
        <span>Direct download — you run chmod +x yourself</span>
      </a>
      <a
        className="download-menu__option"
        href={DOWNLOADS.linuxArm64}
        onClick={(event) => {
          event.preventDefault();
          onSelectAsset?.(DOWNLOADS.linuxArm64);
        }}
      >
        <strong>Launcher (arm64)</strong>
        <span>Direct download — you run chmod +x yourself</span>
      </a>
    </>
  );
}

export function DownloadButton() {
  const platform = usePlatform();

  if (isPhonePlatform(platform)) {
    const ios = platform === "ios";
    return (
      <>
        <a
          className="button button--primary button--download"
          href={ios ? APP_STORE_URL : PLAY_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={ios ? "Get Stella on the App Store" : "Get Stella on Google Play"}
        >
          Get the app
          {ios ? <AppleIcon size={18} /> : <PlayIcon size={18} />}
        </a>
        <SendToComputer />
      </>
    );
  }

  if (platform === "unknown") {
    return (
      <a className="button button--primary button--download" href={DOWNLOAD_PAGE_PATH}>
        Download Stella
      </a>
    );
  }

  if (platform === "linux") {
    return (
      <details className="download-menu">
        <summary
          className="button button--primary button--download"
          aria-label={ariaLabels.linux}
          title={ariaLabels.linux}
        >
          Install Stella
          <LinuxIcon size={18} />
        </summary>

        <div className="download-menu__options">
          <LinuxInstallOptions
            onSelectAsset={(url) => reportGoogleAdsDownload(url)}
          />
        </div>
      </details>
    );
  }

  const url = DOWNLOADS[platform];
  const PlatformIcon = platform === "windows" ? WindowsIcon : AppleIcon;

  return (
    <a
      className="button button--primary button--download"
      href={url}
      onClick={(event) => {
        event.preventDefault();
        reportGoogleAdsDownload(url);
      }}
      aria-label={ariaLabels[platform]}
      title={ariaLabels[platform]}
    >
      Download Stella
      <PlatformIcon size={18} />
    </a>
  );
}
