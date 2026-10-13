"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { SIGN_IN_DIALOG_EVENT } from "./sign-in-dialog-events";

const LazySignInDialogProvider = dynamic(() =>
  import("./sign-in-dialog").then((module) => module.SignInDialogProvider),
);

type HostMode = "idle" | "verify" | "open";

/** Loads the auth dialog implementation only when a sign-in is requested. */
export function SignInDialogHost() {
  const [mode, setMode] = useState<HostMode>("idle");

  useEffect(() => {
    const activate = () => setMode("open");
    const verify = () =>
      setMode((current) => (current === "idle" ? "verify" : current));
    window.addEventListener(SIGN_IN_DIALOG_EVENT, activate);

    // OAuth and magic-link returns land on a route with a one-time token.
    // Load the dialog module to verify it, but keep the dialog closed: the
    // user has just signed in.
    const returnUrl = new URL(window.location.href);
    if (
      new URLSearchParams(returnUrl.hash.replace(/^#\??/, "")).has("ott") ||
      returnUrl.searchParams.has("ott")
    )
      verify();

    return () => window.removeEventListener(SIGN_IN_DIALOG_EVENT, activate);
  }, []);

  if (mode === "idle") return null;
  return <LazySignInDialogProvider initiallyOpen={mode === "open"} />;
}
