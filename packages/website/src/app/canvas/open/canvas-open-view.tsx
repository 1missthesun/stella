"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ArrowRight, MailCheck } from "lucide-react";
import { BackendRequestError } from "@stella/contracts/backend/client";
import {
  CANVAS_OWNER_OPEN_SLUG_PARAM,
  isCanvasShareSlug,
  parseCanvasShareSlug,
} from "@stella/contracts/canvas-share";
import { authClient } from "@/lib/auth-client";
import { clearCachedToken } from "@/lib/auth-token";
import { getBackendClient, isBackendConfigured } from "@/lib/backend";
import { useMagicLinkAuth } from "@/lib/use-magic-link-auth";
import { SocialSignInButtons } from "@/components/auth/social-sign-in-buttons";
import { StellaMark } from "@/components/stella-mark";
import styles from "@/app/sign-in/sign-in.module.css";

/**
 * Where the share domain's "private" page sends a private canvas's owner when
 * their browser holds no view cookie. Signed in here as the owner, the page
 * asks the backend for the link's view URL (`shares.viewLink`, which carries
 * a short grant) and goes there; the share domain trades the grant for its
 * view cookie. The backend answers only for the caller's own links, so
 * anyone else is told the canvas isn't theirs.
 */

type SessionUser = {
  email?: string;
  isAnonymous?: boolean | null;
};

type Phase =
  | { kind: "opening" }
  | { kind: "not-owner" }
  | { kind: "error"; message: string };

const subscribeToNothing = () => () => {};
const readSearch = (): string => window.location.search;
const readNoSearch = (): null => null;

const slugFrom = (search: string): string | null => {
  const value = new URLSearchParams(search).get(CANVAS_OWNER_OPEN_SLUG_PARAM);
  return value && isCanvasShareSlug(value) ? value : null;
};

/** The view URL the backend returned, if it is this link's on an https origin. */
const viewUrlFor = (url: string, slug: string): string | null => {
  try {
    const parsed = new URL(url);
    const local =
      parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && local)) {
      return null;
    }
    return parseCanvasShareSlug(parsed.href, parsed.origin) === slug
      ? parsed.href
      : null;
  } catch {
    return null;
  }
};

export function CanvasOpenView() {
  const search = useSyncExternalStore(subscribeToNothing, readSearch, readNoSearch);
  if (search === null) return <Shell />;
  const slug = slugFrom(search);
  if (!isBackendConfigured()) {
    return (
      <Shell>
        <h1 className={styles.title}>Can&apos;t open canvases here</h1>
        <p className={styles.subtitle}>
          This build of the site isn&apos;t connected to Stella.
        </p>
      </Shell>
    );
  }
  if (!slug) {
    return (
      <Shell>
        <h1 className={styles.title}>Canvas link not recognized</h1>
        <p className={styles.subtitle}>
          Open the canvas link again from Stella.
        </p>
      </Shell>
    );
  }
  return <ConfiguredCanvasOpen slug={slug} />;
}

function ConfiguredCanvasOpen({ slug }: { slug: string }) {
  const session = authClient.useSession();
  const user = (session.data as { user?: SessionUser } | null | undefined)?.user;
  const signedIn = Boolean(user) && user?.isAnonymous !== true;
  const [phase, setPhase] = useState<Phase>({ kind: "opening" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    getBackendClient()
      .call("shares.viewLink", { slug })
      .then(({ url }) => {
        if (cancelled) return;
        const target = viewUrlFor(url, slug);
        if (!target) {
          setPhase({ kind: "error", message: "Stella sent back a link this page can't open." });
          return;
        }
        window.location.replace(target);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof BackendRequestError && error.code === "NOT_FOUND") {
          setPhase({ kind: "not-owner" });
          return;
        }
        setPhase({
          kind: "error",
          message:
            error instanceof Error && error.message
              ? error.message
              : "Couldn't reach Stella.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn, slug, attempt]);

  const signOut = useCallback(async () => {
    setPhase({ kind: "opening" });
    try {
      await authClient.signOut();
    } finally {
      clearCachedToken();
    }
  }, []);

  if (session.isPending) return <Shell />;
  if (!signedIn) return <SignInToOpen />;

  if (phase.kind === "not-owner") {
    return (
      <Shell>
        <h1 className={styles.title}>This canvas isn&apos;t yours</h1>
        <p className={styles.subtitle}>
          It&apos;s private, and it isn&apos;t in the Stella account you&apos;re
          signed in with{user?.email ? <> ({user.email})</> : null}. If you
          made it, sign in with that account instead.
        </p>
        <div className={styles.actions}>
          <button type="button" className={styles.linkButton} onClick={() => void signOut()}>
            Sign in with another account
          </button>
        </div>
      </Shell>
    );
  }

  if (phase.kind === "error") {
    return (
      <Shell>
        <h1 className={styles.title}>Couldn&apos;t open the canvas</h1>
        <p className={styles.errorBanner}>{phase.message}</p>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.linkButton}
            onClick={() => {
              setPhase({ kind: "opening" });
              setAttempt((value) => value + 1);
            }}
          >
            Try again
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className={styles.title}>Opening your canvas…</h1>
      <p className={styles.subtitle}>
        <span className={styles.spinner} aria-hidden="true" />
      </p>
    </Shell>
  );
}

function SignInToOpen() {
  const returnTo = useCallback(() => window.location.href, []);
  const { email, setEmail, status, error, handleMagicLinkSubmit, reset } =
    useMagicLinkAuth({ returnTo });
  const sending = status === "sending";

  if (status === "sent") {
    return (
      <Shell>
        <h1 className={styles.title}>Check your inbox</h1>
        <div className={styles.statusCard}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <MailCheck size={18} aria-hidden="true" />
            <p className={styles.statusBody}>
              We sent a sign-in link to{" "}
              <span className={styles.statusEmail}>{email}</span>.
            </p>
          </div>
          <p className={styles.statusFootnote}>
            Open it in this browser and the canvas opens right after.
          </p>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.linkButton} onClick={reset}>
            Use a different email
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className={styles.title}>Sign in to open your canvas</h1>
      <p className={styles.subtitle}>
        This canvas is private. Sign in with the Stella account that made it
        and it opens here.
      </p>
      <SocialSignInButtons />
      <div className={styles.methodDivider}>
        <span>or use email</span>
      </div>
      <form className={styles.form} onSubmit={handleMagicLinkSubmit}>
        <label className={styles.field}>
          <span className={styles.label}>Email</span>
          <input
            className={styles.input}
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={sending}
            required
          />
        </label>
        {error ? <p className={styles.errorBanner}>{error}</p> : null}
        <button
          className={styles.button}
          type="submit"
          disabled={sending || !email.trim()}
        >
          {sending ? (
            <>
              <span className={styles.spinner} aria-hidden="true" />
              Sending link…
            </>
          ) : (
            <>
              Email me a sign-in link
              <ArrowRight size={16} />
            </>
          )}
        </button>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children?: ReactNode }) {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <Link className={styles.brand} href="/">
          <span className={styles.brandLogo}>
            <StellaMark size={32} />
          </span>
          <span className={styles.brandText}>Stella</span>
        </Link>
        {children}
      </div>
    </main>
  );
}
