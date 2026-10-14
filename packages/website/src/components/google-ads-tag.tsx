"use client";

import Script from "next/script";
import { useEffect } from "react";

const GOOGLE_ADS_ID = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID?.trim() || "";
const GOOGLE_ADS_SCRIPT_ID = "google-ads-tag";
const GOOGLE_ADS_LOAD_DELAY_MS = 3000;
const conversionDestination = (label: string | undefined) =>
  GOOGLE_ADS_ID && label?.trim() ? `${GOOGLE_ADS_ID}/${label.trim()}` : "";
const DOWNLOAD_CONVERSION_DESTINATION = conversionDestination(
  process.env.NEXT_PUBLIC_GOOGLE_ADS_DOWNLOAD_LABEL,
);
const SIGNUP_CONVERSION_DESTINATION = conversionDestination(
  process.env.NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_LABEL,
);
const SIGNUP_REPORTED_KEY = "stella-google-ads-signup-reported";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export function GoogleAdsTag() {
  if (!GOOGLE_ADS_ID) return null;
  return <GoogleAdsTagLoader />;
}

function GoogleAdsTagLoader() {
  useEffect(() => {
    let timer = 0;

    const load = () => {
      if (timer) window.clearTimeout(timer);
      timer = 0;
      window.removeEventListener("pointerdown", load);
      window.removeEventListener("keydown", load);
      window.removeEventListener("touchstart", load);

      if (document.getElementById(GOOGLE_ADS_SCRIPT_ID)) return;
      const script = document.createElement("script");
      script.id = GOOGLE_ADS_SCRIPT_ID;
      script.async = true;
      script.src = `https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ADS_ID}`;
      document.head.appendChild(script);
    };

    const schedule = () => {
      timer = window.setTimeout(load, GOOGLE_ADS_LOAD_DELAY_MS);
    };

    if (document.readyState === "complete") schedule();
    else window.addEventListener("load", schedule, { once: true });

    window.addEventListener("pointerdown", load, { once: true, passive: true });
    window.addEventListener("keydown", load, { once: true });
    window.addEventListener("touchstart", load, { once: true, passive: true });

    return () => {
      if (timer) window.clearTimeout(timer);
      window.removeEventListener("load", schedule);
      window.removeEventListener("pointerdown", load);
      window.removeEventListener("keydown", load);
      window.removeEventListener("touchstart", load);
    };
  }, []);

  return (
    <Script id="google-ads-config" strategy="afterInteractive">
      {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          window.gtag = gtag;
          gtag('js', new Date());
          gtag('config', '${GOOGLE_ADS_ID}');
        `}
    </Script>
  );
}

function gtagSafe(...args: unknown[]): void {
  if (typeof window.gtag !== "function") {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() {
      // gtag.js requires the real Arguments object, not an array.
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer?.push(arguments);
    };
  }
  window.gtag(...args);
}

export function reportGoogleAdsDownload(url: string) {
  if (typeof window === "undefined") return;

  if (!DOWNLOAD_CONVERSION_DESTINATION || typeof window.gtag !== "function") {
    window.location.assign(url);
    return;
  }

  let redirected = false;
  const redirect = () => {
    if (redirected) return;
    redirected = true;
    window.location.assign(url);
  };

  window.setTimeout(redirect, 800);
  window.gtag("event", "conversion", {
    send_to: DOWNLOAD_CONVERSION_DESTINATION,
    event_callback: redirect,
  });
}

export function reportGoogleAdsSignup() {
  if (typeof window === "undefined" || !SIGNUP_CONVERSION_DESTINATION) return;

  try {
    if (window.localStorage.getItem(SIGNUP_REPORTED_KEY)) return;
    window.localStorage.setItem(SIGNUP_REPORTED_KEY, String(Date.now()));
  } catch {
    // Storage blocked — still report; Google dedupes per ad click server-side.
  }

  gtagSafe("event", "conversion", {
    send_to: SIGNUP_CONVERSION_DESTINATION,
    value: 1.0,
    currency: "USD",
  });
}
