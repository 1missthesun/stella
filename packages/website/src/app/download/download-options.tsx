"use client";

import Link from "next/link";
import { useState } from "react";
import {
  APP_STORE_URL,
  DownloadButton,
  isPhonePlatform,
  PLAY_STORE_URL,
  usePlatform,
  type Platform,
} from "@/components/download-button";
import { reportGoogleAdsDownload } from "@/components/google-ads-tag";
import { WindowsInstallNote } from "@/components/windows-install-note";
import pg from "@/components/landing/page.module.css";
import { INSTALL_COMMAND } from "@/lib/downloads";
import d from "./download.module.css";

type Row = {
  id: string;
  name: string;
  detail: string;
  platforms: Platform[];
  desktop: boolean;
  action: React.ReactNode;
};

function DesktopLink({ href, label, phone }: { href: string; label: string; phone: boolean }) {
  if (phone) return <span className={d.later}>On your computer</span>;
  return (
    <a
      className={d.action}
      href={href}
      onClick={(event) => {
        event.preventDefault();
        reportGoogleAdsDownload(href);
      }}
    >
      {label}
    </a>
  );
}

function CopyCommand() {
  const [copied, setCopied] = useState(false);
  return (
    <div className={d.command}>
      <code>{INSTALL_COMMAND}</code>
      <button
        type="button"
        className={d.action}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(INSTALL_COMMAND);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            // The command stays visible and selectable.
          }
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function DownloadOptions() {
  const platform = usePlatform();
  const phone = isPhonePlatform(platform);

  const rows: Row[] = [
    {
      id: "mac",
      name: "Mac",
      detail: "Apple silicon and Intel",
      platforms: ["mac"],
      desktop: true,
      action: <DesktopLink href="/download/mac" label="Download" phone={phone} />,
    },
    {
      id: "windows",
      name: "Windows",
      detail: "Signed by FromYou, LLC",
      platforms: ["windows"],
      desktop: true,
      action: <DesktopLink href="/download/windows" label="Download" phone={phone} />,
    },
    {
      id: "linux",
      name: "Linux",
      detail: "One-line install, adds Stella to your app menu",
      platforms: ["linux"],
      desktop: true,
      action: phone ? (
        <span className={d.later}>On your computer</span>
      ) : (
        <span className={d.actions}>
          <DesktopLink href="/download/linux" label="x64" phone={false} />
          <DesktopLink href="/download/linux-arm64" label="arm64" phone={false} />
        </span>
      ),
    },
    {
      id: "iphone",
      name: "iPhone and iPad",
      detail: "App Store",
      platforms: ["ios"],
      desktop: false,
      action: (
        <a className={d.action} href={APP_STORE_URL} target="_blank" rel="noopener noreferrer">
          Get the app
        </a>
      ),
    },
    {
      id: "android",
      name: "Android",
      detail: "Google Play",
      platforms: ["android"],
      desktop: false,
      action: (
        <a className={d.action} href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer">
          Get the app
        </a>
      ),
    },
    {
      id: "web",
      name: "Web",
      detail: "Chat with Stella in your browser",
      platforms: [],
      desktop: false,
      action: (
        <Link className={d.action} href="/chat">
          Open
        </Link>
      ),
    },
  ];

  // A phone sees its own store first; a computer sees the computers first.
  const ordered = phone ? [...rows.filter((r) => !r.desktop), ...rows.filter((r) => r.desktop)] : rows;

  return (
    <>
      <section id="get" className={`${pg.hero} ${pg.center} ${d.hero}`} data-tone="light" data-bg="#ffffff">
        <p className={pg.eyebrow}>Download</p>
        <h1 className={pg.title}>Get Stella.</h1>
        <p className={pg.lede}>The easy way to use ChatGPT or Claude on your computer. Free with the plan you already have.</p>
        <div className={pg.cta}>
          <DownloadButton />
        </div>
        <p className={pg.reassure}>No credit card, no trial.</p>
        <div className={pg.note}>
          <WindowsInstallNote />
        </div>
      </section>

      <section className={d.list} data-tone="light" data-bg="#ffffff" aria-labelledby="all-downloads">
        <h2 id="all-downloads" className={d.listTitle}>
          Every download
        </h2>
        <ul>
          {ordered.map((row) => (
            <li key={row.id} id={row.id} className={d.row} data-current={row.platforms.includes(platform) ? "" : undefined}>
              <div className={d.label}>
                <strong>
                  {row.name}
                  {row.platforms.includes(platform) ? <span className={d.yours}>This device</span> : null}
                </strong>
                <span>{row.detail}</span>
              </div>
              {row.action}
              {row.id === "linux" && !phone ? <CopyCommand /> : null}
            </li>
          ))}
        </ul>
        <p className={d.after}>
          The first launch sets Stella up on your computer, which can take a few minutes. After that it opens straight
          away.
        </p>
      </section>
    </>
  );
}
