"use client";

import { authClient } from "@/lib/auth-client";
import { useDesktopBridgeAuthUser } from "@/lib/desktop-bridge-auth";
import { AccountMenu } from "./account-menu";
import { SignInButton } from "./sign-in-button";

type SessionUser = {
  email?: string;
  name?: string;
  isAnonymous?: boolean | null;
};

export function SiteHeaderAccountInner() {
  const session = authClient.useSession();
  const desktopUser = useDesktopBridgeAuthUser();
  const user =
    (session.data as { user?: SessionUser } | null | undefined)?.user ??
    desktopUser;
  const isSignedIn = Boolean(user) && user?.isAnonymous !== true;

  if (isSignedIn && user) {
    return <AccountMenu user={user} />;
  }

  return <SignInButton />;
}
