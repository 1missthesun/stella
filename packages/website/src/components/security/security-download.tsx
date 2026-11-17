"use client";

import { useState } from "react";
import { AppleIcon, LinuxIcon, WindowsIcon, isPhonePlatform, usePlatform } from "@/components/download-button";
import { SECURITY_DOWNLOADS, SECURITY_PATH, SECURITY_PLATFORM_LABELS, type SecurityPlatform } from "@/lib/security";

const ICONS: Record<SecurityPlatform, (props: { size?: number }) => React.ReactElement> = {
  mac: AppleIcon,
  windows: WindowsIcon,
  linux: LinuxIcon,
};

/**
 * The one Download button on /security. On a computer it points at that
 * computer's installer (SECURITY_DOWNLOADS); on a phone, where there is
 * nothing to install, it sends the page to the user's computer instead.
 */
export function SecurityDownload() {
  const platform = usePlatform();
  const [sent, setSent] = useState<"idle" | "copied" | "failed">("idle");

  if (isPhonePlatform(platform)) {
    const send = async () => {
      const url = `${window.location.origin}${SECURITY_PATH}`;
      if (typeof navigator.share === "function") {
        try {
          await navigator.share({ title: "Stella Security", text: "Get Stella Security on your computer:", url });
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") return;
        }
      }
      try {
        await navigator.clipboard.writeText(url);
        setSent("copied");
      } catch {
        setSent("failed");
      }
      setTimeout(() => setSent("idle"), 2500);
    };
    return (
      <button type="button" className="button button--primary button--download" onClick={send}>
        {sent === "copied" ? "Link copied" : sent === "failed" ? "Copy failed" : "Send to my computer"}
      </button>
    );
  }

  if (platform === "unknown") {
    return (
      <a className="button button--primary button--download" href="#get">
        Download
      </a>
    );
  }

  const Icon = ICONS[platform];
  return (
    <a
      className="button button--primary button--download"
      href={SECURITY_DOWNLOADS[platform]}
      aria-label={`Download Stella Security for ${SECURITY_PLATFORM_LABELS[platform]}`}
    >
      Download
      <Icon size={18} />
    </a>
  );
}

/** Every computer's installer, for the closing section. */
export function SecurityPlatformLinks({ className }: { className?: string }) {
  return (
    <nav className={className} aria-label="Download for">
      {(Object.keys(SECURITY_DOWNLOADS) as SecurityPlatform[]).map((p) => (
        <a key={p} href={SECURITY_DOWNLOADS[p]}>
          {SECURITY_PLATFORM_LABELS[p]}
        </a>
      ))}
    </nav>
  );
}
