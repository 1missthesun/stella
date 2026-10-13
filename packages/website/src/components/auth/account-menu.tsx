"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronDown, CreditCard, LogOut, MessagesSquare } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { clearCachedToken } from "@/lib/auth-token";
import styles from "./account-menu.module.css";

export type AccountMenuUser = {
  email?: string;
  name?: string;
};

export function AccountMenu({ user }: { user: AccountMenuUser }) {
  const name = user.name?.trim() ?? "";
  const email = user.email?.trim() ?? "";
  const label = name || email || "Account";
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const handleSignOut = useCallback(async () => {
    setSigningOut(true);
    await authClient.signOut().catch(() => undefined);
    clearCachedToken();
    setSigningOut(false);
    setOpen(false);
  }, []);

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`site-nav__trigger ${styles.trigger}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label="Account menu"
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.triggerLabel}>{label}</span>
        <span className={styles.triggerShort}>Account</span>
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={styles.chevron}
          data-open={open ? "true" : "false"}
        />
      </button>

      <div
        id={menuId}
        className={styles.menu}
        role="menu"
        aria-label="Account"
        data-open={open ? "true" : "false"}
        hidden={!open}
      >
        <div className={styles.identity}>
          <p className={styles.identityLabel}>Signed in as</p>
          {name ? <p className={styles.identityName}>{name}</p> : null}
          {email ? <p className={styles.identityEmail}>{email}</p> : null}
        </div>

        <div className={styles.group}>
          <Link href="/billing" role="menuitem" className={styles.item} onClick={close}>
            <CreditCard size={18} aria-hidden="true" className={styles.icon} />
            <span>Plan &amp; billing</span>
          </Link>
          <Link href="/slack" role="menuitem" className={styles.item} onClick={close}>
            <MessagesSquare size={18} aria-hidden="true" className={styles.icon} />
            <span>Stella for Slack</span>
          </Link>
        </div>

        <div className={styles.group}>
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            onClick={() => void handleSignOut()}
            disabled={signingOut}
          >
            <LogOut size={18} aria-hidden="true" className={styles.icon} />
            <span>{signingOut ? "Signing out…" : "Sign out"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
