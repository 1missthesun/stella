import { Input, Press, T, tx } from "../../kit/compat";
import { useBillingScreen } from "./BillingScreen.styles";
import { mixOklch, useTokens } from "../../theme";
import { useFullShellLayout } from "../shared/full-shell.layout.styles";
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
import { planUsageDialog } from "@/global/billing/plan-usage-dialog-store";
import { CONNECT_PLAN_COPY } from "@stella/contracts/connect-plan-offer";
import {
  connectPlanChatGptOnly,
  connectPlanCopy,
  connectPlanOfferEnabled,
  openConnectPlan,
} from "@/features/chat/connect-plan/connect-plan";

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
  } catch {}
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
  if (!def.interval) return [t("billing.v3.includes.voice"), t("billing.v3.includes.byok")];
  return [
    ...(def.mediaGeneration ? [t("billing.v3.includes.media")] : []),
    t("billing.v3.includes.drive", { size: `${Math.round(def.limits.driveBytes / 1024 ** 3)} GB` }),
  ];
};

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  const s = useBillingScreen();
  return (
    <box {...s.billingRow}>
      <box {...s.billingRowText}>
        <T {...s.billingRowLabel}>{label}</T>
        {hint ? <T {...s.billingRowHint}>{hint}</T> : null}
      </box>
      <box {...s.billingRowControl}>{children}</box>
    </box>
  );
}

function svgPaint(color: string): string {
  const m = color.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (!m) return `fill="${color}"`;
  return `fill="#${m[1]}" fill-opacity="${m[2] ? (parseInt(m[2], 16) / 255).toFixed(3) : "1"}"`;
}

/** desktop-ui's held-reservation fill: `repeating-linear-gradient(-45deg, fg 40% 0 band, fg 16% band 2·band)`. */
function HeldStripes({ band, size }: { band: number; size: number }) {
  const t = useTokens();
  const strong = mixOklch(t.c.foreground, 40, "transparent");
  const weak = mixOklch(t.c.foreground, 16, "transparent");
  const svg = `<defs><pattern id="held" width="${band * 2}" height="${band * 2}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="${band}" height="${band * 2}" ${svgPaint(strong)}/><rect x="${band}" width="${band}" height="${band * 2}" ${svgPaint(weak)}/></pattern></defs><rect width="${size}" height="${size}" fill="url(#held)"/>`;
  return <icon absolute={{ left: 0, top: 0 }} svg={svg} name={`billing/held-${band}-${size}-${strong}-${weak}`} view={size} size={size} inert />;
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
  const s = useBillingScreen();
  const usedPct = pct(used, limit);
  const heldPct = Math.min(100 - usedPct, pct(reserved, limit));
  return (
    <box {...s.billingMeter}>
      <row {...s.billingMeterTrack} role="progressbar" label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(usedPct)}>
        <row {...s.billingMeterUsed} w={`${usedPct}%`} {...(((limit > 0 && used >= limit) || undefined) ? s.billingMeterUsedFull : null)} />
        {heldPct > 0 ? (
          <row {...s.billingMeterHeld} w={`${heldPct}%`} clip={0}>
            <HeldStripes band={3} size={720} />
          </row>
        ) : null}
      </row>
      <row w="full" {...s.billingMeterCaption}>{caption}</row>
    </box>
  );
}

function Section({ id, title, lede, children }: { id?: string; title?: string; lede?: string; children: ReactNode }) {
  const s = useBillingScreen();
  return (
    <T {...s.billingSection} id={id}>
      {title ? (
        <box {...s.billingSectionHead}>
          <T {...tx(s.billingSectionHead)} role="heading" {...s.billingSectionTitle}>{title}</T>
          {lede ? <T {...tx(s.billingSectionHead)} w="full" {...s.billingSectionLede}>{lede}</T> : null}
        </box>
      ) : null}
      {children}
    </T>
  );
}

export function BillingPanel() {
  const s = useBillingScreen();
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
      <col {...s.billingPanel}>
        <box {...s.billingEmpty} role="status">
          <T {...tx(s.billingPanel)} weight={700}>{t("billing.v3.signIn.title")}</T>
          <T {...tx(s.billingPanel)}>{t("billing.v3.signIn.body")}</T>
          <Press text={tx(s.billingPanel)} {...s.billingBtn} {...s.billingBtnPrimary} onPress={openSignInDialog}>
            {t("common.signIn")}
          </Press>
        </box>
      </col>
    );
  }

  if (!status) {
    return <col {...s.billingPanel} {...s.billingPanelLoading} aria-busy="true" />;
  }

  const plan = normalizeBillingPlan(status.plan);

  return (
    <col {...s.billingPanel}>
      {error ? (
        <T {...tx(s.billingPanel)} w="full" {...s.billingBanner} {...s.billingBannerError} role="alert">
          {error}
        </T>
      ) : null}
      {notice ? (
        <T {...tx(s.billingPanel)} w="full" {...s.billingBanner} role="status">
          {notice}
        </T>
      ) : null}
      <UsageSection status={status} plan={plan} now={now} f={f} t={t} busy={busy} onCheckout={checkout} onPortal={portal} />
      <PlanSection status={status} plan={plan} f={f} t={t} busy={busy} onCheckout={checkout} onPortal={portal} />
      <CreditSection status={status} f={f} t={t} busy={busy} onBuy={buyCredit} />
    </col>
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
  const s = useBillingScreen();
  const usage = status.usage;
  if (!usage || status.usagePolicy.kind !== "managed_cost") return null;

  const def = PLAN_CATALOG[plan];
  const oneTime = plan === "free" && usage.lifetimeLimitUsd !== null;
  const mainLimit = oneTime ? (usage.lifetimeLimitUsd ?? 0) : usage.monthlyLimitUsd;
  const mainUsed = Math.min(mainLimit, oneTime ? usage.lifetimeUsedUsd : usage.monthlyUsedUsd);
  const credit = status.credits.balanceUsd;
  const reserved = Number.isFinite(usage.reservedUsd) ? usage.reservedUsd : 0;
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
      <T>{t("billing.v3.usage.percentUsed", { percent: f.percent(used, limit) })}</T>
      <T {...s.billingMuted}>{used > 0 ? resets(at) : t("billing.v3.usage.startsNext")}</T>
    </>
  );

  return (
    <Section title={t("billing.v3.usage.title")} lede={t("billing.v3.usage.lede")}>
      <box {...s.billingTotal}>
        <box {...s.billingTotalHead}>
          <T {...s.billingTotalAmount}>{f.percent(mainUsed, mainLimit)}</T>
          <T {...s.billingMuted}>
            {oneTime ? t("billing.v3.usage.usedOneTime") : t("billing.v3.usage.usedMonth")}
          </T>
        </box>
        <Meter large label={t("billing.v3.usage.title")} used={mainUsed} limit={mainLimit} reserved={reserved} caption={
            <>
              <row {...s.billingLegend}>
                <box {...s.billingLegend_i} {...s.billingLegendUsed} />
                <T {...tx(s.billingMeterCaption)} {...tx(s.billingLegend)}>{t("billing.v3.usage.used")}</T>
                {reserved > 0 ? (
                  <>
                    <box {...s.billingLegend_i} {...s.billingLegendHeld} clip={2}>
                      <HeldStripes band={2} size={9} />
                    </box>
                    <T {...tx(s.billingMeterCaption)} {...tx(s.billingLegend)}>{t("billing.v3.usage.held")}</T>
                  </>
                ) : null}
              </row>
              <T {...tx(s.billingMeterCaption)} {...s.billingMuted}>{oneTime ? t("billing.v3.usage.oneTimeNote") : resets(usage.monthlyResetsAt)}</T>
            </>
          } />
      </box>

      {blocked ? (
        <box {...s.billingCallout} role="status">
          <col>
            <T {...tx(s.billingCallout)} weight={700}>{oneTime ? t("billing.v3.usage.freeOutTitle") : t("billing.v3.usage.outTitle")}</T>
            <T {...tx(s.billingCallout)}>
              {oneTime
                ? connectPlanOfferEnabled()
                  ? connectPlanCopy("allowance").description
                  : t("billing.v3.usage.freeOutBody")
                : resumesAt
                  ? t("billing.v3.usage.outBody", { date: f.when(resumesAt, now) })
                  : t("billing.v3.usage.outBodyNoDate")}
            </T>
          </col>
          {oneTime && connectPlanOfferEnabled() ? (
            <Press text={tx(s.billingCallout)} {...s.billingBtn} {...s.billingBtnPrimary} onPress={() => {
                planUsageDialog.close();
                openConnectPlan({ conversationId: null, reason: "allowance", choose: true });
              }}>
              {connectPlanChatGptOnly() ? CONNECT_PLAN_COPY.connectChatGpt : CONNECT_PLAN_COPY.connect}
            </Press>
          ) : null}
          {next ? (
            <Press text={tx(s.billingBtn, oneTime && connectPlanOfferEnabled() ? {} : s.billingBtnPrimary)} {...s.billingBtn} {...(oneTime && connectPlanOfferEnabled() ? null : s.billingBtnPrimary)} disabled={busy !== null} onPress={() => (plan === "free" ? onCheckout(next) : onPortal())} {...((busy !== null) ? s.billingBtnDisabled : null)}>
              {t("billing.v3.usage.upgradeTo", { plan: PLAN_CATALOG[next].label })}
            </Press>
          ) : null}
        </box>
      ) : resumesAt !== null && credit > 0 ? (
        <box {...s.billingCallout} role="status">
          <col>
            <T {...tx(s.billingCallout)} weight={700}>{t("billing.v3.usage.creditTitle")}</T>
            <T {...tx(s.billingCallout)}>{t("billing.v3.usage.creditBody", { date: f.when(resumesAt, now) })}</T>
          </col>
        </box>
      ) : null}

      {oneTime ? null : (
        <col w="full" {...s.billingRows}>
          <Row label={t("billing.v3.usage.rolling", { hours: def.budget.rollingWindowHours })} hint={t("billing.v3.usage.rollingNote", { hours: def.budget.rollingWindowHours })}>
            <Meter label={t("billing.v3.usage.rolling", { hours: def.budget.rollingWindowHours })} used={usage.rollingUsedUsd} limit={usage.rollingLimitUsd} caption={windowCaption(usage.rollingUsedUsd, usage.rollingLimitUsd, usage.rollingResetsAt)} />
          </Row>
          <Row label={t("billing.v3.usage.weekly")} hint={t("billing.v3.usage.weeklyNote")}>
            <Meter label={t("billing.v3.usage.weekly")} used={usage.weeklyUsedUsd} limit={usage.weeklyLimitUsd} caption={windowCaption(usage.weeklyUsedUsd, usage.weeklyLimitUsd, usage.weeklyResetsAt)} />
          </Row>
        </col>
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
  const s = useBillingScreen();
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
    <Section id="billing-plans">
      <box {...s.billingPlansHead}>
        <T {...tx(s.billingPlansHead)} role="heading" {...s.billingPlansHeading}>{t("billing.v3.plan.heading")}</T>
        <T {...tx(s.billingPlansHead)} w="full" {...s.billingPlansLede}>{t("billing.v3.plan.lede")}</T>
      </box>
      <box {...s.billingPlans} role="list">
        {PLAN_ORDER.map((id) => {
          const def = PLAN_CATALOG[id];
          const current = id === plan;
          const recommended = id === RECOMMENDED_PLAN;
          const action = actionFor(id);
          return (
            <col {...s.billingPlan} key={id} role="listitem" {...((current || undefined) ? s.billingPlanCurrent : null)}>
              <T {...tx(s.billingPlan)} {...s.billingPlanFlag}>
                {current ? t("billing.v3.plan.currentPlan") : recommended ? t("billing.v3.plan.recommended") : ""}
              </T>
              <T {...tx(s.billingPlan)} {...s.billingPlanName}>{def.label}</T>
              <T {...tx(s.billingPlan)} {...s.billingPlanTagline}>{planTagline(id, t)}</T>
              <box {...s.billingPlanPrice}>
                <T {...tx(s.billingPlan)} {...s.billingPlanAmount}>{f.amount(def.monthlyPriceCents / 100)}</T>
                <T {...tx(s.billingPlan)} {...s.billingPlanPer}>{def.interval ? t("billing.v3.plan.month") : t("billing.v3.plan.noCard")}</T>
              </box>
              {action ? (
                <Press text={tx(s.billingBtn, s.billingPlanBtn, action.primary ? s.billingBtnPrimary : {})} {...s.billingBtn} {...s.billingPlanBtn} {...(action.primary ? s.billingBtnPrimary : null)} disabled={busy !== null} onPress={action.onClick} {...((busy !== null) ? s.billingBtnDisabled : null)}>
                  {action.label}
                </Press>
              ) : (
                <T {...tx(s.billingPlan)} {...s.billingBtn} {...s.billingPlanBtn} {...s.billingPlanBtnCurrent} aria-disabled="true">
                  {t("billing.v3.plan.currentPlan")}
                </T>
              )}
              <box {...s.billingPlanFeatures}>
                {planIncludesLines(id, t).map((line) => (
                  <T {...tx(s.billingPlan, s.billingPlanFeatures)} key={line}>{line}</T>
                ))}
              </box>
            </col>
          );
        })}
      </box>
      <T w="full" {...s.billingPlansNote}>
        {busy === "checkout" || busy === "portal"
          ? t("billing.v3.opening")
          : isPaid
            ? t("billing.v3.plan.changeHint")
            : t("billing.v3.plan.checkoutHint")}
      </T>
      {isPaid ? (
        <col w="full" {...s.billingRows}>
          <Row label={status.cancelAtPeriodEnd ? t("billing.v3.plan.ends") : t("billing.v3.plan.renews")} hint={
              status.cancelAtPeriodEnd
                ? t("billing.v3.plan.endsHint", { plan: PLAN_CATALOG[plan].label })
                : t("billing.v3.plan.renewsHint", { price: priceOf(plan) })
            }>
            <T {...s.billingValue}>{periodEnd ?? "—"}</T>
          </Row>
          <Row label={t("billing.v3.plan.manage")} hint={t("billing.v3.plan.manageHint")}>
            <Press {...s.billingBtn} disabled={busy !== null} onPress={onPortal} {...((busy !== null) ? s.billingBtnDisabled : null)}>
              {busy === "portal" ? t("billing.v3.opening") : t("billing.v3.plan.manageButton")}
            </Press>
          </Row>
        </col>
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
  const s = useBillingScreen();
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
      <box {...s.billingBalance}>
        <T {...s.billingBalanceAmount}>{f.usd(status.credits.balanceUsd)}</T>
        <T {...s.billingMuted}>{t("billing.v3.credit.balance")}</T>
      </box>
      <box {...s.billingTopup}>
        <row {...s.billingCredit} {...s.billingTopup_billingCredit}>
          <row {...s.billingSegmented} role="radiogroup" label={t("billing.v3.credit.add")}>
            {options.presetAmountCents.map((cents) => {
              const on = !custom.trim() && preset === cents;
              return (
                <Press key={cents} role="radio" checked={on} onPress={() => {
                    setPreset(cents);
                    setCustom("");
                    setInputError(null);
                  }}>
                  {f.amount(cents / 100)}
                </Press>
              );
            })}
          </row>
          <row {...s.billingInputWrap}>
            <T {...tx(s.billingInputWrap)}>$</T>
            <Input {...s.billingInput} inputMode="decimal" placeholder={t("billing.v3.credit.other")} label={t("billing.v3.credit.other")} aria-invalid={inputError ? true : undefined} value={custom} onChange={(event) => {
                setCustom(event.target.value);
                setInputError(null);
              }} />
          </row>
          <Press {...s.billingBtn} {...s.billingBtnPrimary} disabled={busy !== null || amountCents === null} onPress={submit} {...((busy !== null || amountCents === null) ? s.billingBtnDisabled : null)}>
            {busy === "credit"
              ? t("billing.v3.opening")
              : amountCents
                ? t("billing.v3.credit.addAmount", { amount: f.usd(amountCents / 100) })
                : t("billing.v3.credit.add")}
          </Press>
        </row>
        {inputError ? <T {...s.billingFieldError}>{inputError}</T> : null}
        <T w="full" {...s.billingCenteredHint}>{t("billing.v3.credit.addHint")}</T>
      </box>
    </Section>
  );
}

export function BillingScreen() {
  const s = useBillingScreen();
  return (
    <col>
      <col>
        <col w="full" {...s.billingScreenScroll}>
          <BillingPanel />
        </col>
      </col>
    </col>
  );
}
