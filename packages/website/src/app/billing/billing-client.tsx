"use client";

import type { BillingStatus } from "@stella/contracts/backend/billing";
import { getBackendClient, isBackendConfigured, useBackendValue } from "@/lib/backend";
import { useCallback, useEffect, useId, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { openSignInDialog } from "@/components/auth/sign-in-dialog";
import { authClient } from "@/lib/auth-client";
import { signOut } from "@/lib/sign-out";
import { useDesktopBridgeAuthUser } from "@/lib/desktop-bridge-auth";
import {
  PLAN_CATALOG,
  PLAN_ORDER,
  formatUsd,
  isPaidBillingPlan,
  normalizeBillingPlan,
  planPriceLabel,
  planRank,
  type BillingPlan,
  type PaidBillingPlan,
} from "@/lib/plans";
import { billingMockStatus, readBillingMockMode, type BillingMockMode } from "./billing-mock";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric" });
const timeFormat = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const weekdayFormat = new Intl.DateTimeFormat("en-US", { weekday: "long", hour: "numeric", minute: "2-digit" });

const whenLabel = (at: number, now: number): string => {
  const ms = at - now;
  if (ms <= 0) return "now";
  if (ms < 24 * 60 * 60 * 1000) return `at ${timeFormat.format(at)}`;
  if (ms < 7 * 24 * 60 * 60 * 1000) return `on ${weekdayFormat.format(at).replace(" at", ",")}`;
  return `on ${dateFormat.format(at)}`;
};

const resetLabel = (at: number, now: number): string => `Resets ${whenLabel(at, now)}`;

const pct = (used: number, limit: number) =>
  !Number.isFinite(limit) || limit <= 0 ? 0 : Math.min(100, Math.max(0, (used / limit) * 100));

const errorText = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

// A synthesized anchor opens Stripe once: window.open with noopener returns
// null even on success, which used to open it twice. In the desktop web view
// the click is routed to the system browser.
const openExternal = (url: string) => {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
};

const returnUrl = () => new URL("/billing", window.location.origin).toString();

type Boot = { mock: BillingMockMode | null; checkout: string | null; plan: BillingPlan | null };
let bootSnapshot: Boot | null = null;
const readBoot = (): Boot => {
  if (!bootSnapshot) {
    const params = new URL(window.location.href).searchParams;
    const plan = params.get("plan");
    bootSnapshot = {
      mock: readBillingMockMode(),
      checkout: params.get("checkout"),
      plan: plan ? normalizeBillingPlan(plan) : null,
    };
  }
  return bootSnapshot;
};
const subscribeNever = () => () => {};

export function BillingClient() {
  const boot = useSyncExternalStore(subscribeNever, readBoot, () => null);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("checkout")) return;
    url.searchParams.delete("checkout");
    window.history.replaceState(null, "", url.toString());
  }, []);

  if (boot === null) return <Shell />;
  if (boot.mock) return <MockAccount boot={boot} mode={boot.mock} />;
  if (!isBackendConfigured()) {
    return (
      <Shell>
        <Notice title="Not available here">This build of the site isn&apos;t connected to Stella.</Notice>
      </Shell>
    );
  }
  return <LiveAccount boot={boot} />;
}

type AccountUser = { email?: string; name?: string; isAnonymous?: boolean | null };

function MockAccount({ boot, mode }: { boot: Boot; mode: BillingMockMode }) {
  const status = billingMockStatus(mode);
  if (!status) return <SignedOut />;
  return <Account boot={boot} status={status} user={{ email: "you@example.com", name: "Alex Rivera" }} />;
}

function LiveAccount({ boot }: { boot: Boot }) {
  const session = authClient.useSession();
  const desktopUser = useDesktopBridgeAuthUser();
  const user: AccountUser | null =
    (session.data as { user?: AccountUser } | null | undefined)?.user ?? desktopUser;
  const signedIn = Boolean(user) && user?.isAnonymous !== true;
  const status = useBackendValue("billing.status", signedIn ? {} : "skip");
  if (session.isPending && !desktopUser) return <Shell />;
  if (!signedIn || !user) return <SignedOut />;
  if (!status) return <Shell user={user} />;
  if (!status.authenticated || status.isAnonymous) return <SignedOut />;
  return <Account boot={boot} status={status} user={user} />;
}

function Shell({ user, children }: { user?: AccountUser; children?: ReactNode }) {
  const [signingOut, setSigningOut] = useState(false);
  const email = user?.email?.trim();
  return (
    <main className="billing-main">
      <div className="billing-shell">
        <header className="billing-head">
          <div>
            <h1 className="billing-title">Plan &amp; usage</h1>
            <p className="billing-lede">{email ? `Signed in as ${email}` : " "}</p>
          </div>
          {user ? (
            <div className="billing-head-actions">
              <Link className="billing-btn billing-btn--ghost" href="/crew">
                Crew
              </Link>
              <button
                type="button"
                className="billing-btn billing-btn--ghost"
                disabled={signingOut}
                onClick={() => {
                  setSigningOut(true);
                  void signOut()
                    .catch(() => undefined)
                    .then(() => window.location.reload());
                }}
              >
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
            </div>
          ) : null}
        </header>
        {children ?? (
          <div className="billing-loading" aria-live="polite">
            <span className="billing-spinner" aria-hidden="true" />
            Loading
          </div>
        )}
      </div>
    </main>
  );
}

function Notice({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="billing-notice">
      <h2 className="billing-notice-title">{title}</h2>
      <p className="billing-notice-text">{children}</p>
      {action ? <div className="billing-notice-actions">{action}</div> : null}
    </div>
  );
}

function SignedOut() {
  return (
    <Shell>
      <Notice
        title="Sign in to see your plan"
        action={
          <button type="button" className="billing-btn billing-btn--primary" onClick={() => openSignInDialog()}>
            Sign in
          </button>
        }
      >
        Your plan, usage and extra credit belong to your Stella account.
      </Notice>
    </Shell>
  );
}

function Section({ id, title, lede, children }: { id: string; title: string; lede?: ReactNode; children: ReactNode }) {
  return (
    <section className="billing-section" id={id} aria-labelledby={`${id}-title`}>
      <header className="billing-section-head">
        <h2 className="billing-section-title" id={`${id}-title`}>
          {title}
        </h2>
        {lede ? <p className="billing-section-lede">{lede}</p> : null}
      </header>
      {children}
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="billing-row">
      <div className="billing-row-text">
        <span className="billing-row-label">{label}</span>
        {hint ? <p className="billing-row-hint">{hint}</p> : null}
      </div>
      <div className="billing-row-control">{children}</div>
    </div>
  );
}

function Meter({
  used,
  limit,
  reserved = 0,
  caption,
  large = false,
}: {
  used: number;
  limit: number;
  reserved?: number;
  caption: ReactNode;
  large?: boolean;
}) {
  const usedPct = pct(used, limit);
  const heldPct = Math.min(100 - usedPct, pct(reserved, limit));
  const full = used >= limit && limit > 0;
  return (
    <div className="billing-meter" data-large={large ? "" : undefined}>
      <div
        className="billing-meter-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(usedPct)}
        aria-valuetext={`${usd.format(used)} of ${usd.format(limit)} used`}
      >
        <span className="billing-meter-used" data-full={full ? "" : undefined} style={{ width: `${usedPct}%` }} />
        {heldPct > 0 ? <span className="billing-meter-held" style={{ width: `${heldPct}%` }} /> : null}
      </div>
      <div className="billing-meter-caption">{caption}</div>
    </div>
  );
}

const SECTIONS = [
  { id: "usage", label: "Usage" },
  { id: "plan", label: "Plan" },
  { id: "credit", label: "Extra credit" },
] as const;

function Account({ boot, status, user }: { boot: Boot; status: BillingStatus; user: AccountUser }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const plan = normalizeBillingPlan(status.plan);
  const isPaid = isPaidBillingPlan(plan);
  const [notice, setNotice] = useState<string | null>(() =>
    boot.checkout === "success"
      ? "Payment received. Your plan updates here in a moment."
      : boot.checkout === "cancel"
        ? "Checkout cancelled. Nothing changed."
        : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"checkout" | "portal" | "credit" | null>(null);

  const run = useCallback(async (kind: "checkout" | "portal" | "credit", action: () => Promise<{ url: string }>) => {
    setError(null);
    setNotice(null);
    setBusy(kind);
    try {
      const session = await action();
      openExternal(session.url);
      setNotice(
        kind === "portal"
          ? "Billing opened in a new tab. Changes show up here automatically."
          : "Checkout opened in a new tab. This page updates once payment completes.",
      );
    } catch (err) {
      setError(errorText(err, kind === "portal" ? "Couldn't open billing right now." : "Couldn't start checkout right now."));
    } finally {
      setBusy(null);
    }
  }, []);

  const mock = boot.mock !== null;
  const checkout = (target: PaidBillingPlan) =>
    mock
      ? setNotice(`Mock: would open checkout for ${PLAN_CATALOG[target].label}.`)
      : void run("checkout", () => getBackendClient().call("billing.checkout", { plan: target, returnUrl: returnUrl() }));
  const portal = () =>
    mock
      ? setNotice("Mock: would open Stripe billing.")
      : void run("portal", () => getBackendClient().call("billing.portal", { returnUrl: returnUrl() }));
  const buyCredit = (amountCents: number) =>
    mock
      ? setNotice(`Mock: would open checkout for ${usd.format(amountCents / 100)} of credit.`)
      : void run("credit", () => getBackendClient().call("billing.creditCheckout", { amountCents, returnUrl: returnUrl() }));

  return (
    <Shell user={user}>
      {error ? (
        <p className="billing-banner billing-banner--error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="billing-banner" role="status">
          {notice}
        </p>
      ) : null}
      <div className="billing-layout">
        <nav className="billing-nav" aria-label="Sections">
          <ul>
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>{s.label}</a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="billing-sections">
          <UsageSection status={status} plan={plan} now={now} onUpgrade={checkout} onPortal={portal} busy={busy} />
          <PlanSection
            status={status}
            plan={plan}
            isPaid={isPaid}
            initial={boot.plan}
            busy={busy}
            onCheckout={checkout}
            onPortal={portal}
          />
          <CreditSection status={status} busy={busy} onBuy={buyCredit} />
        </div>
      </div>
    </Shell>
  );
}

function UsageSection({
  status,
  plan,
  now,
  busy,
  onUpgrade,
  onPortal,
}: {
  status: BillingStatus;
  plan: BillingPlan;
  now: number;
  busy: string | null;
  onUpgrade: (plan: PaidBillingPlan) => void;
  onPortal: () => void;
}) {
  const usage = status.usage;
  const def = PLAN_CATALOG[plan];
  const lede = "One budget pays for everything Stella runs for you.";
  if (!usage || status.usagePolicy.kind !== "managed_cost") {
    return (
      <Section id="usage" title="Usage" lede={lede}>
        <p className="billing-muted">Usage isn&apos;t metered on this server.</p>
      </Section>
    );
  }

  const oneTime = plan === "free" && usage.lifetimeLimitUsd !== null;
  const mainUsed = oneTime ? usage.lifetimeUsedUsd : usage.monthlyUsedUsd;
  const mainLimit = oneTime ? (usage.lifetimeLimitUsd ?? 0) : usage.monthlyLimitUsd;
  const credit = status.credits.balanceUsd;
  const available = usage.availableUsd;
  const blocked = available !== null && available <= 0.0001;
  const blockingReset = (() => {
    if (oneTime) return null;
    const windows = [
      { used: usage.rollingUsedUsd, limit: usage.rollingLimitUsd, at: usage.rollingResetsAt },
      { used: usage.weeklyUsedUsd, limit: usage.weeklyLimitUsd, at: usage.weeklyResetsAt },
      { used: usage.monthlyUsedUsd, limit: usage.monthlyLimitUsd, at: usage.monthlyResetsAt },
    ].filter((w) => w.used >= w.limit && w.limit > 0);
    return windows.length ? Math.max(...windows.map((w) => w.at)) : null;
  })();
  const next = plan === "free" ? "plus" : plan === "plus" ? "pro" : plan === "pro" ? "max" : null;
  const windowCaption = (used: number, limit: number, at: number) => (
    <>
      <span>
        {usd.format(used)} <span className="billing-muted">of {formatUsd(limit)}</span>
      </span>
      <span className="billing-muted">{used > 0 ? resetLabel(at, now) : "Starts with your next use"}</span>
    </>
  );

  return (
    <Section id="usage" title="Usage" lede={lede}>
      <div className="billing-total">
        <div className="billing-total-head">
          <span className="billing-total-amount">{usd.format(mainUsed)}</span>
          <span className="billing-muted">
            of {formatUsd(mainLimit)} {oneTime ? "to try Stella" : "this month"}
          </span>
        </div>
        <Meter
          large
          used={mainUsed}
          limit={mainLimit}
          reserved={usage.reservedUsd}
          caption={
            <>
              <span className="billing-legend">
                <i className="billing-legend-used" aria-hidden="true" />
                Used
                {usage.reservedUsd > 0 ? (
                  <>
                    <i className="billing-legend-held" aria-hidden="true" />
                    Held by running work
                  </>
                ) : null}
              </span>
              <span className="billing-muted">{oneTime ? "One-time, doesn't reset" : resetLabel(usage.monthlyResetsAt, now)}</span>
            </>
          }
        />
      </div>

      {blocked ? (
        <div className="billing-callout" role="status">
          <div>
            <strong>{oneTime ? "You've used your free usage" : "You're out of usage for now"}</strong>
            <span>
              {oneTime
                ? "Choose a plan or add credit to keep going."
                : blockingReset
                  ? `Stella picks up again ${whenLabel(blockingReset, now)}. Add credit or upgrade to keep going now.`
                  : "Add credit or upgrade to keep going now."}
            </span>
          </div>
          {next ? (
            <button
              type="button"
              className="billing-btn billing-btn--primary"
              disabled={busy !== null}
              onClick={() => (plan === "free" ? onUpgrade(next) : onPortal())}
            >
              Upgrade to {PLAN_CATALOG[next].label}
            </button>
          ) : null}
        </div>
      ) : blockingReset !== null && credit > 0 ? (
        <div className="billing-callout billing-callout--info" role="status">
          <div>
            <strong>Running on extra credit</strong>
            <span>Your plan&apos;s limit is used up until {whenLabel(blockingReset, now)}. Credit covers what Stella does until then.</span>
          </div>
        </div>
      ) : null}

      <div className="billing-rows">
        {oneTime ? null : (
          <>
            <Row
              label={`Next ${def.budget.rollingWindowHours} hours`}
              hint={`Up to ${formatUsd(usage.rollingLimitUsd)} in any ${def.budget.rollingWindowHours} hours.`}
            >
              <Meter
                used={usage.rollingUsedUsd}
                limit={usage.rollingLimitUsd}
                caption={windowCaption(usage.rollingUsedUsd, usage.rollingLimitUsd, usage.rollingResetsAt)}
              />
            </Row>
            <Row label="This week" hint={`Up to ${formatUsd(usage.weeklyLimitUsd)} a week.`}>
              <Meter
                used={usage.weeklyUsedUsd}
                limit={usage.weeklyLimitUsd}
                caption={windowCaption(usage.weeklyUsedUsd, usage.weeklyLimitUsd, usage.weeklyResetsAt)}
              />
            </Row>
          </>
        )}
        <Row label="Held by running work" hint="Set aside while agents and media jobs finish. What they don't use comes back.">
          <span className="billing-value">{usd.format(usage.reservedUsd)}</span>
        </Row>
        <Row label="Extra credit" hint="Used once your plan's budget runs out.">
          <span className="billing-value">{usd.format(credit)}</span>
        </Row>
        <Row label="Available now" hint="What Stella can spend right now, credit included.">
          <span className="billing-value billing-value--strong">{available === null ? "Unlimited" : usd.format(available)}</span>
        </Row>
      </div>
    </Section>
  );
}

function PlanSection({
  status,
  plan,
  isPaid,
  initial,
  busy,
  onCheckout,
  onPortal,
}: {
  status: BillingStatus;
  plan: BillingPlan;
  isPaid: boolean;
  initial: BillingPlan | null;
  busy: string | null;
  onCheckout: (plan: PaidBillingPlan) => void;
  onPortal: () => void;
}) {
  const name = useId();
  const [selected, setSelected] = useState<BillingPlan>(initial ?? plan);
  const target = PLAN_CATALOG[selected];
  const periodEnd = status.currentPeriodEnd ? dateFormat.format(status.currentPeriodEnd) : null;

  const action = (() => {
    if (selected === plan) return null;
    if (!isPaid && isPaidBillingPlan(selected)) {
      return { label: `Continue to checkout · ${planPriceLabel(selected)}`, disabled: busy !== null, onClick: () => onCheckout(selected), danger: false };
    }
    if (selected === "free") return { label: "Cancel plan", disabled: busy !== null, onClick: onPortal, danger: true };
    const up = planRank(selected) > planRank(plan);
    return {
      label: `${up ? "Upgrade" : "Downgrade"} to ${target.label} · ${planPriceLabel(selected)}`,
      disabled: busy !== null,
      onClick: onPortal,
      danger: false,
    };
  })();

  const actionHint =
    selected === plan
      ? null
      : selected === "free"
        ? `You keep ${PLAN_CATALOG[plan].label} until ${periodEnd ?? "the end of this period"}, then move to Free.`
        : !isPaid
          ? "Payment opens in a new tab. Your budget starts right away."
          : "You'll confirm the change in Stripe.";

  return (
    <Section id="plan" title="Plan" lede="Every plan runs the same Stella. Bigger plans give it a bigger budget and more at once.">
      <div className="billing-radio-list" role="radiogroup" aria-label="Plans">
        {PLAN_ORDER.map((id) => {
          const def = PLAN_CATALOG[id];
          const checked = selected === id;
          return (
            <label key={id} className="billing-radio" data-checked={checked ? "" : undefined}>
              <input type="radio" name={name} value={id} checked={checked} onChange={() => setSelected(id)} />
              <span className="billing-radio-dot" aria-hidden="true" />
              <span className="billing-radio-text">
                <span className="billing-radio-label">
                  {def.label}
                  {id === plan ? <span className="billing-tag">Current</span> : null}
                </span>
                <span className="billing-radio-detail">{def.includes.join(" · ")}</span>
              </span>
              <span className="billing-radio-price">
                {def.interval ? (
                  <>
                    {planPriceLabel(id).replace("/mo", "")}
                    <span className="billing-muted">/mo</span>
                  </>
                ) : (
                  "$0"
                )}
              </span>
            </label>
          );
        })}
      </div>
      {action ? (
      <div className="billing-plan-action">
        <button
          type="button"
          className={`billing-btn ${action.danger ? "billing-btn--danger" : "billing-btn--primary"}`}
          disabled={action.disabled}
          onClick={action.onClick}
        >
          {busy === "checkout" || busy === "portal" ? "Opening…" : action.label}
        </button>
        {actionHint ? <p className="billing-row-hint">{actionHint}</p> : null}
      </div>
      ) : null}

      {isPaid ? (
        <div className="billing-rows">
          <Row
            label={status.cancelAtPeriodEnd ? "Ends" : "Renews"}
            hint={
              status.cancelAtPeriodEnd
                ? `${PLAN_CATALOG[plan].label} stays on until then. Resume it from Manage billing.`
                : `${planPriceLabel(plan)}, billed monthly by Stripe.`
            }
          >
            <span className="billing-value">{periodEnd ?? "—"}</span>
          </Row>
          <Row label="Payment and invoices" hint="Card, invoices, and cancelling.">
            <button type="button" className="billing-btn billing-btn--secondary" disabled={busy !== null} onClick={onPortal}>
              Manage billing
            </button>
          </Row>
        </div>
      ) : null}
    </Section>
  );
}

function CreditSection({
  status,
  busy,
  onBuy,
}: {
  status: BillingStatus;
  busy: string | null;
  onBuy: (amountCents: number) => void;
}) {
  const options = status.creditPurchase;
  const [preset, setPreset] = useState<number | null>(options.presetAmountCents[1] ?? options.presetAmountCents[0] ?? null);
  const [custom, setCustom] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);

  const amountCents = (() => {
    if (!custom.trim()) return preset;
    const parsed = Number(custom.trim());
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : null;
  })();

  const submit = () => {
    if (amountCents === null) return setInputError("Enter an amount in dollars.");
    if (amountCents < options.minAmountCents) return setInputError(`The minimum is ${usd.format(options.minAmountCents / 100)}.`);
    if (amountCents > options.maxAmountCents) return setInputError(`The maximum is ${usd.format(options.maxAmountCents / 100)}.`);
    setInputError(null);
    onBuy(amountCents);
  };

  return (
    <Section id="credit" title="Extra credit" lede="Keeps Stella going when your plan's budget runs out.">
      <div className="billing-rows">
        <Row label="Balance">
          <span className="billing-value billing-value--strong">{usd.format(status.credits.balanceUsd)}</span>
        </Row>
        <Row label="Add credit" hint="Pay once with Stripe. No subscription.">
          <div className="billing-credit">
            <div className="billing-segmented" role="radiogroup" aria-label="Amount">
              {options.presetAmountCents.map((cents) => (
                <button
                  key={cents}
                  type="button"
                  role="radio"
                  aria-checked={!custom.trim() && preset === cents}
                  data-on={!custom.trim() && preset === cents ? "" : undefined}
                  onClick={() => {
                    setPreset(cents);
                    setCustom("");
                    setInputError(null);
                  }}
                >
                  {formatUsd(cents / 100)}
                </button>
              ))}
            </div>
            <label className="billing-input-wrap">
              <span aria-hidden="true">$</span>
              <input
                className="billing-input"
                inputMode="decimal"
                placeholder="Other"
                value={custom}
                aria-label="Other amount in dollars"
                aria-invalid={inputError ? true : undefined}
                onChange={(event) => {
                  setCustom(event.target.value);
                  setInputError(null);
                }}
              />
            </label>
            <button type="button" className="billing-btn billing-btn--primary" disabled={busy !== null || amountCents === null} onClick={submit}>
              {busy === "credit" ? "Opening…" : amountCents ? `Add ${usd.format(amountCents / 100)}` : "Add credit"}
            </button>
          </div>
          {inputError ? <p className="billing-field-error">{inputError}</p> : null}
        </Row>
      </div>
    </Section>
  );
}
