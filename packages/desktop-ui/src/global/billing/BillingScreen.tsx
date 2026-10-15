import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { BillingStatus } from "@stella/contracts/backend/billing";
import {
  PLAN_CATALOG,
  PLAN_ORDER,
  isPaidBillingPlan,
  nextPlanUp,
  normalizeBillingPlan,
  planRank,
  type BillingPlan,
  type PaidBillingPlan,
} from "@stella/contracts/billing-plans";
import { backendClient } from "@/platform/backend/backend-client";
import { useBackendValue } from "@/platform/backend/use-backend-view";
import { useLocale, useT } from "@/shared/i18n";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import { openExternalUrl } from "@/platform/electron/open-external";
import { planUsageDialog } from "./plan-usage-dialog-store";
import "./BillingScreen.css";

type Translate = ReturnType<typeof useT>;
type Busy = "checkout" | "portal" | "credit" | null;

const HOUR = 60 * 60 * 1000;

const useFormatters = (locale: string) =>
  useMemo(() => {
    const usd = new Intl.NumberFormat(locale, { style: "currency", currency: "USD", minimumFractionDigits: 2 });
    const whole = new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
    const time = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" });
    const weekday = new Intl.DateTimeFormat(locale, { weekday: "long", hour: "numeric", minute: "2-digit" });
    const day = new Intl.DateTimeFormat(locale, { month: "long", day: "numeric" });
    const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 });
    return {
      percent: (used: number, limit: number) => percent.format(usedShare(used, limit) / 100),
      usd: (value: number) => usd.format(value),
      amount: (value: number) => (Number.isInteger(value) ? whole.format(value) : usd.format(value)),
      day: (ms: number) => day.format(ms),
      when: (ms: number, now: number) =>
        ms - now < 24 * HOUR ? time.format(ms) : ms - now < 7 * 24 * HOUR ? weekday.format(ms) : day.format(ms),
    };
  }, [locale]);

type Formatters = ReturnType<typeof useFormatters>;

const pct = (used: number, limit: number) =>
  !Number.isFinite(limit) || limit <= 0 ? 0 : Math.min(100, Math.max(0, (used / limit) * 100));

// Whole percent for display: never 0% once anything is used, never 100% until it's all used.
export const usedShare = (used: number, limit: number): number => {
  if (!Number.isFinite(limit) || limit <= 0 || !(used > 0)) return 0;
  if (used >= limit) return 100;
  return Math.min(99, Math.max(1, Math.floor((used / limit) * 100)));
};

const errorText = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const getBillingReturnUrl = async (): Promise<string> => {
  let baseUrl = (import.meta.env.VITE_STELLA_WEB_URL as string | undefined)?.trim() || "https://stella.sh";
  try {
    const resolved = await window.electronAPI?.website?.getBaseUrl?.();
    if (resolved) baseUrl = resolved;
  } catch {
    // Fall through to the production default.
  }
  return new URL("/billing", baseUrl).toString();
};

const openSignInDialog = () => {
  void import("@/router").then(({ router }) => {
    void router.navigate({
      to: ".",
      search: (prev: { dialog?: "auth" | "connect" }) => ({ ...prev, dialog: "auth" as const }),
    });
  });
};

export const RECOMMENDED_PLAN: PaidBillingPlan = "pro";

export const planTagline = (plan: BillingPlan, t: Translate): string => t(`billing.v3.tagline.${plan}`);

export const planIncludesLines = (plan: BillingPlan, t: Translate): string[] => {
  const def = PLAN_CATALOG[plan];
  if (!def.interval) return [t("billing.v3.includes.local"), t("billing.v3.includes.voice")];
  return [
    t("billing.v3.includes.cloud", { count: def.limits.cloudAgentsAtOnce }),
    ...(def.mediaGeneration ? [t("billing.v3.includes.media")] : []),
    t("billing.v3.includes.drive", { size: `${Math.round(def.limits.driveBytes / 1024 ** 3)} GB` }),
  ];
};

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="billing-row">
      <div className="billing-row-text">
        <span className="billing-row-label">{label}</span>
        {hint ? <span className="billing-row-hint">{hint}</span> : null}
      </div>
      <div className="billing-row-control">{children}</div>
    </div>
  );
}

function Meter({
  used,
  limit,
  reserved = 0,
  label,
  caption,
  large = false,
}: {
  used: number;
  limit: number;
  reserved?: number;
  label: string;
  caption: ReactNode;
  large?: boolean;
}) {
  const usedPct = pct(used, limit);
  const heldPct = Math.min(100 - usedPct, pct(reserved, limit));
  return (
    <div className="billing-meter" data-large={large || undefined}>
      <div
        className="billing-meter-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(usedPct)}
      >
        <span className="billing-meter-used" data-full={(limit > 0 && used >= limit) || undefined} style={{ width: `${usedPct}%` }} />
        {heldPct > 0 ? <span className="billing-meter-held" style={{ width: `${heldPct}%` }} /> : null}
      </div>
      <div className="billing-meter-caption">{caption}</div>
    </div>
  );
}

function Section({ id, title, lede, children }: { id?: string; title: string; lede?: string; children: ReactNode }) {
  return (
    <section className="billing-section" id={id}>
      <header className="billing-section-head">
        <h2 className="billing-section-title">{title}</h2>
        {lede ? <p className="billing-section-lede">{lede}</p> : null}
      </header>
      {children}
    </section>
  );
}

export function BillingPanel() {
  const { hasConnectedAccount } = useAuthSessionState();
  const t = useT();
  const f = useFormatters(useLocale());
  const status = useBackendValue("billing.status", hasConnectedAccount ? {} : "skip");
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const hasAccount = Boolean(hasConnectedAccount && status?.authenticated && !status.isAnonymous);

  const loaded = status !== undefined;
  useEffect(() => {
    if (!loaded || !planUsageDialog.consumeFocusPlans()) return;
    document.getElementById("billing-plans")?.scrollIntoView({ block: "start" });
  }, [loaded]);

  const run = useCallback(
    async (kind: Exclude<Busy, null>, action: (returnUrl: string) => Promise<{ url: string }>) => {
      if (!hasAccount) {
        openSignInDialog();
        return;
      }
      setError(null);
      setNotice(null);
      setBusy(kind);
      try {
        const session = await action(await getBillingReturnUrl());
        openExternalUrl(session.url);
        setNotice(kind === "portal" ? t("billing.v3.notice.portalOpened") : t("billing.v3.notice.checkoutOpened"));
      } catch (err) {
        setError(errorText(err, kind === "portal" ? t("billing.v3.notice.portalFailed") : t("billing.v3.notice.checkoutFailed")));
      } finally {
        setBusy(null);
      }
    },
    [hasAccount, t],
  );

  const checkout = useCallback(
    (plan: PaidBillingPlan) => void run("checkout", (returnUrl) => backendClient.call("billing.checkout", { plan, returnUrl })),
    [run],
  );
  const portal = useCallback(
    () => void run("portal", (returnUrl) => backendClient.call("billing.portal", { returnUrl })),
    [run],
  );
  const buyCredit = useCallback(
    (amountCents: number) =>
      void run("credit", (returnUrl) => backendClient.call("billing.creditCheckout", { amountCents, returnUrl })),
    [run],
  );

  if (!hasConnectedAccount) {
    return (
      <div className="billing-panel">
        <div className="billing-empty" role="status">
          <strong>{t("billing.v3.signIn.title")}</strong>
          <span>{t("billing.v3.signIn.body")}</span>
          <button type="button" className="billing-btn billing-btn--primary" onClick={openSignInDialog}>
            {t("common.signIn")}
          </button>
        </div>
      </div>
    );
  }

  if (!status) {
    return <div className="billing-panel billing-panel--loading" aria-busy="true" />;
  }

  const plan = normalizeBillingPlan(status.plan);

  return (
    <div className="billing-panel">
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
      <UsageSection status={status} plan={plan} now={now} f={f} t={t} busy={busy} onCheckout={checkout} onPortal={portal} />
      <PlanSection status={status} plan={plan} f={f} t={t} busy={busy} onCheckout={checkout} onPortal={portal} />
      <CreditSection status={status} f={f} t={t} busy={busy} onBuy={buyCredit} />
    </div>
  );
}

function UsageSection({
  status,
  plan,
  now,
  f,
  t,
  busy,
  onCheckout,
  onPortal,
}: {
  status: BillingStatus;
  plan: BillingPlan;
  now: number;
  f: Formatters;
  t: Translate;
  busy: Busy;
  onCheckout: (plan: PaidBillingPlan) => void;
  onPortal: () => void;
}) {
  const usage = status.usage;
  if (!usage || status.usagePolicy.kind !== "managed_cost") return null;

  const def = PLAN_CATALOG[plan];
  const oneTime = plan === "free" && usage.lifetimeLimitUsd !== null;
  const mainLimit = oneTime ? (usage.lifetimeLimitUsd ?? 0) : usage.monthlyLimitUsd;
  const mainUsed = Math.min(mainLimit, oneTime ? usage.lifetimeUsedUsd : usage.monthlyUsedUsd);
  const credit = status.credits.balanceUsd;
  const reserved = Number.isFinite(usage.reservedUsd) ? usage.reservedUsd : 0;
  // Backends before pricing v3 send no reservation or availability.
  const available: number | null | undefined = usage.availableUsd;
  const blocked = typeof available === "number" && available <= 0.0001;
  const exceeded = oneTime
    ? []
    : [
        { used: usage.rollingUsedUsd, limit: usage.rollingLimitUsd, at: usage.rollingResetsAt },
        { used: usage.weeklyUsedUsd, limit: usage.weeklyLimitUsd, at: usage.weeklyResetsAt },
        { used: usage.monthlyUsedUsd, limit: usage.monthlyLimitUsd, at: usage.monthlyResetsAt },
      ].filter((w) => w.limit > 0 && w.used >= w.limit && typeof w.at === "number");
  const resumesAt = exceeded.length ? Math.max(...exceeded.map((w) => w.at)) : null;
  const next = nextPlanUp(plan);
  const resets = (at: number | undefined) =>
    typeof at === "number" && at > 0 ? t("billing.v3.usage.resets", { date: f.when(at, now) }) : "";
  const windowCaption = (used: number, limit: number, at: number) => (
    <>
      <span>{t("billing.v3.usage.percentUsed", { percent: f.percent(used, limit) })}</span>
      <span className="billing-muted">{used > 0 ? resets(at) : t("billing.v3.usage.startsNext")}</span>
    </>
  );

  return (
    <Section title={t("billing.v3.usage.title")} lede={t("billing.v3.usage.lede")}>
      <div className="billing-total">
        <div className="billing-total-head">
          <span className="billing-total-amount">{f.percent(mainUsed, mainLimit)}</span>
          <span className="billing-muted">
            {oneTime ? t("billing.v3.usage.usedOneTime") : t("billing.v3.usage.usedMonth")}
          </span>
        </div>
        <Meter
          large
          label={t("billing.v3.usage.title")}
          used={mainUsed}
          limit={mainLimit}
          reserved={reserved}
          caption={
            <>
              <span className="billing-legend">
                <i className="billing-legend-used" aria-hidden="true" />
                <span>{t("billing.v3.usage.used")}</span>
                {reserved > 0 ? (
                  <>
                    <i className="billing-legend-held" aria-hidden="true" />
                    <span>{t("billing.v3.usage.held")}</span>
                  </>
                ) : null}
              </span>
              <span className="billing-muted">{oneTime ? t("billing.v3.usage.oneTimeNote") : resets(usage.monthlyResetsAt)}</span>
            </>
          }
        />
      </div>

      {blocked ? (
        <div className="billing-callout" data-tone="warning" role="status">
          <div>
            <strong>{oneTime ? t("billing.v3.usage.freeOutTitle") : t("billing.v3.usage.outTitle")}</strong>
            <span>
              {oneTime
                ? t("billing.v3.usage.freeOutBody")
                : resumesAt
                  ? t("billing.v3.usage.outBody", { date: f.when(resumesAt, now) })
                  : t("billing.v3.usage.outBodyNoDate")}
            </span>
          </div>
          {next ? (
            <button
              type="button"
              className="billing-btn billing-btn--primary"
              disabled={busy !== null}
              onClick={() => (plan === "free" ? onCheckout(next) : onPortal())}
            >
              {t("billing.v3.usage.upgradeTo", { plan: PLAN_CATALOG[next].label })}
            </button>
          ) : null}
        </div>
      ) : resumesAt !== null && credit > 0 ? (
        <div className="billing-callout" role="status">
          <div>
            <strong>{t("billing.v3.usage.creditTitle")}</strong>
            <span>{t("billing.v3.usage.creditBody", { date: f.when(resumesAt, now) })}</span>
          </div>
        </div>
      ) : null}

      {oneTime ? null : (
        <div className="billing-rows">
          <Row
            label={t("billing.v3.usage.rolling", { hours: def.budget.rollingWindowHours })}
            hint={t("billing.v3.usage.rollingNote", { hours: def.budget.rollingWindowHours })}
          >
            <Meter
              label={t("billing.v3.usage.rolling", { hours: def.budget.rollingWindowHours })}
              used={usage.rollingUsedUsd}
              limit={usage.rollingLimitUsd}
              caption={windowCaption(usage.rollingUsedUsd, usage.rollingLimitUsd, usage.rollingResetsAt)}
            />
          </Row>
          <Row label={t("billing.v3.usage.weekly")} hint={t("billing.v3.usage.weeklyNote")}>
            <Meter
              label={t("billing.v3.usage.weekly")}
              used={usage.weeklyUsedUsd}
              limit={usage.weeklyLimitUsd}
              caption={windowCaption(usage.weeklyUsedUsd, usage.weeklyLimitUsd, usage.weeklyResetsAt)}
            />
          </Row>
        </div>
      )}
    </Section>
  );
}

type PlanAction = { label: string; primary: boolean; onClick: () => void };

function PlanSection({
  status,
  plan,
  f,
  t,
  busy,
  onCheckout,
  onPortal,
}: {
  status: BillingStatus;
  plan: BillingPlan;
  f: Formatters;
  t: Translate;
  busy: Busy;
  onCheckout: (plan: PaidBillingPlan) => void;
  onPortal: () => void;
}) {
  const isPaid = isPaidBillingPlan(plan);
  const periodEnd = status.currentPeriodEnd ? f.day(status.currentPeriodEnd) : null;
  const priceOf = (id: BillingPlan) => t("billing.v3.plan.perMonth", { price: f.amount(PLAN_CATALOG[id].monthlyPriceCents / 100) });
  const suggested =
    planRank(plan) < planRank(RECOMMENDED_PLAN) ? RECOMMENDED_PLAN : nextPlanUp(plan);

  const actionFor = (id: BillingPlan): PlanAction | null => {
    if (id === plan) return null;
    const label = PLAN_CATALOG[id].label;
    if (!isPaid && isPaidBillingPlan(id)) {
      return { label: t("billing.v3.plan.get", { plan: label }), primary: id === suggested, onClick: () => onCheckout(id) };
    }
    if (planRank(id) > planRank(plan)) {
      return { label: t("billing.v3.usage.upgradeTo", { plan: label }), primary: id === suggested, onClick: onPortal };
    }
    return { label: t("billing.v3.plan.switchTo", { plan: label }), primary: false, onClick: onPortal };
  };

  return (
    <Section id="billing-plans" title={t("billing.v3.plan.title")}>
      <div className="billing-plans-head">
        <h3 className="billing-plans-heading">{t("billing.v3.plan.heading")}</h3>
        <p className="billing-plans-lede">{t("billing.v3.plan.lede")}</p>
      </div>
      <div className="billing-plans" role="list">
        {PLAN_ORDER.map((id) => {
          const def = PLAN_CATALOG[id];
          const current = id === plan;
          const recommended = id === RECOMMENDED_PLAN;
          const action = actionFor(id);
          return (
            <div
              key={id}
              role="listitem"
              className="billing-plan"
              data-current={current || undefined}
              data-recommended={recommended || undefined}
            >
              <span className="billing-plan-flag">
                {current ? t("billing.v3.plan.currentPlan") : recommended ? t("billing.v3.plan.recommended") : ""}
              </span>
              <span className="billing-plan-name">{def.label}</span>
              <span className="billing-plan-tagline">{planTagline(id, t)}</span>
              <span className="billing-plan-price">
                <span className="billing-plan-amount">{f.amount(def.monthlyPriceCents / 100)}</span>
                <span className="billing-plan-per">{def.interval ? t("billing.v3.plan.month") : t("billing.v3.plan.noCard")}</span>
              </span>
              {action ? (
                <button
                  type="button"
                  className={`billing-btn billing-plan-btn${action.primary ? " billing-btn--primary" : ""}`}
                  disabled={busy !== null}
                  onClick={action.onClick}
                >
                  {action.label}
                </button>
              ) : (
                <span className="billing-btn billing-plan-btn billing-plan-btn--current" aria-disabled="true">
                  {t("billing.v3.plan.currentPlan")}
                </span>
              )}
              <ul className="billing-plan-features">
                {planIncludesLines(id, t).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="billing-plans-note">
        {busy === "checkout" || busy === "portal"
          ? t("billing.v3.opening")
          : isPaid
            ? t("billing.v3.plan.changeHint")
            : t("billing.v3.plan.checkoutHint")}
      </p>
      {isPaid ? (
        <div className="billing-rows">
          <Row
            label={status.cancelAtPeriodEnd ? t("billing.v3.plan.ends") : t("billing.v3.plan.renews")}
            hint={
              status.cancelAtPeriodEnd
                ? t("billing.v3.plan.endsHint", { plan: PLAN_CATALOG[plan].label })
                : t("billing.v3.plan.renewsHint", { price: priceOf(plan) })
            }
          >
            <span className="billing-value">{periodEnd ?? "—"}</span>
          </Row>
          <Row label={t("billing.v3.plan.manage")} hint={t("billing.v3.plan.manageHint")}>
            <button type="button" className="billing-btn" disabled={busy !== null} onClick={onPortal}>
              {busy === "portal" ? t("billing.v3.opening") : t("billing.v3.plan.manageButton")}
            </button>
          </Row>
        </div>
      ) : null}
    </Section>
  );
}

function CreditSection({
  status,
  f,
  t,
  busy,
  onBuy,
}: {
  status: BillingStatus;
  f: Formatters;
  t: Translate;
  busy: Busy;
  onBuy: (amountCents: number) => void;
}) {
  const options = status.creditPurchase;
  const [preset, setPreset] = useState<number | null>(options.presetAmountCents[1] ?? options.presetAmountCents[0] ?? null);
  const [custom, setCustom] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);

  const amountCents = (() => {
    if (!custom.trim()) return preset;
    const parsed = Number(custom.trim().replace(",", "."));
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : null;
  })();

  const submit = () => {
    if (amountCents === null) return setInputError(t("billing.v3.credit.invalid"));
    if (amountCents < options.minAmountCents)
      return setInputError(t("billing.v3.credit.min", { amount: f.usd(options.minAmountCents / 100) }));
    if (amountCents > options.maxAmountCents)
      return setInputError(t("billing.v3.credit.max", { amount: f.usd(options.maxAmountCents / 100) }));
    setInputError(null);
    onBuy(amountCents);
  };

  return (
    <Section title={t("billing.v3.credit.title")} lede={t("billing.v3.credit.lede")}>
      <div className="billing-rows">
        <Row label={t("billing.v3.credit.balance")}>
          <span className="billing-value billing-value--strong">{f.usd(status.credits.balanceUsd)}</span>
        </Row>
        <Row label={t("billing.v3.credit.add")} hint={t("billing.v3.credit.addHint")}>
          <div className="billing-credit">
            <div className="billing-segmented" role="radiogroup" aria-label={t("billing.v3.credit.add")}>
              {options.presetAmountCents.map((cents) => {
                const on = !custom.trim() && preset === cents;
                return (
                  <button
                    key={cents}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    data-on={on || undefined}
                    onClick={() => {
                      setPreset(cents);
                      setCustom("");
                      setInputError(null);
                    }}
                  >
                    {f.amount(cents / 100)}
                  </button>
                );
              })}
            </div>
            <label className="billing-input-wrap">
              <span aria-hidden="true">$</span>
              <input
                className="billing-input"
                inputMode="decimal"
                placeholder={t("billing.v3.credit.other")}
                aria-label={t("billing.v3.credit.other")}
                aria-invalid={inputError ? true : undefined}
                value={custom}
                onChange={(event) => {
                  setCustom(event.target.value);
                  setInputError(null);
                }}
              />
            </label>
            <button
              type="button"
              className="billing-btn billing-btn--primary"
              disabled={busy !== null || amountCents === null}
              onClick={submit}
            >
              {busy === "credit"
                ? t("billing.v3.opening")
                : amountCents
                  ? t("billing.v3.credit.addAmount", { amount: f.usd(amountCents / 100) })
                  : t("billing.v3.credit.add")}
            </button>
          </div>
          {inputError ? <span className="billing-field-error">{inputError}</span> : null}
        </Row>
      </div>
    </Section>
  );
}

export function BillingScreen() {
  return (
    <div className="workspace-area">
      <div className="workspace-content workspace-content--full">
        <div className="billing-screen-scroll">
          <BillingPanel />
        </div>
      </div>
    </div>
  );
}
