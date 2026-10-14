"use client";

import { lazy, Suspense, useEffect, useState } from "react";
import { isBackendConfigured } from "@/lib/backend-url";
import { SignInButton } from "./sign-in-button";

const SiteHeaderAccountInner = lazy(() =>
  import("./site-header-account-inner").then((module) => ({
    default: module.SiteHeaderAccountInner,
  })),
);

export function SiteHeaderAccount() {
  const [loadSession, setLoadSession] = useState(false);

  useEffect(() => {
    const requestIdle = window.requestIdleCallback;
    if (requestIdle) {
      const id = requestIdle(() => setLoadSession(true), { timeout: 1500 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(() => setLoadSession(true), 1);
    return () => window.clearTimeout(id);
  }, []);

  if (!isBackendConfigured()) {
    return null;
  }
  return loadSession ? (
    <Suspense fallback={<SignInButton />}>
      <SiteHeaderAccountInner />
    </Suspense>
  ) : (
    <SignInButton />
  );
}
