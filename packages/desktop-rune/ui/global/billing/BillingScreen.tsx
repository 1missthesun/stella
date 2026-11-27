import { Ink, Input, Press, T, TextScope, tx, useInk, useTextBase } from "../../kit/compat";
import { useBillingScreen } from "./BillingScreen.styles";
import { mixOklch, useTokens, type Style } from "../../theme";
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
import { storeCheckoutFields } from "./store-checkout";
import { CONNECT_PLAN_COPY } from "@stella/contracts/connect-plan-offer";
import { useTopInset } from "../../shell/top-inset";
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
    const day = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
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

type Layout = { narrow: boolean };

function Inherit({ size, color, children }: { size?: number; color?: string; children: ReactNode }) {
  const base = useTextBase();
  const ink = useInk();
  return (
    <TextScope base={size === undefined ? base : { ...base, size }}>
      <Ink.Provider value={color ?? ink}>{children}</Ink.Provider>
    </TextScope>
  );
}

function BillingButton({ primary = false, disabled = false, onPress, children, ...style }: { primary?: boolean; disabled?: boolean; onPress: () => void; children: ReactNode } & Style) {
  const s = useBillingScreen();
  return (
    <Press {...s.billingBtn} {...(primary ? s.billingBtnPrimary : null)} {...style} {...(disabled ? s.billingBtnDisabled : null)} disabled={disabled} onPress={onPress}>
      {children}
    </Press>
  );
}

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  const s = useBillingScreen();
  return (
    <row {...s.billingRow}>
      <col {...s.billingRowText}>
        <T {...s.billingRowLabel}>{label}</T>
        {hint ? <T {...s.billingRowHint}>{hint}</T> : null}
      </col>
      <row {...s.billingRowControl}>{children}</row>
    </row>
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

function MeterTrack({
  used,
  limit,
  reserved = 0,
  label,
  compact = false,
}: {
  used: number;
  limit: number;
  reserved?: number;
  label: string;
  compact?: boolean;
}) {
  const s = useBillingScreen();
  const usedPct = pct(used, limit);
  const heldPct = Math.min(100 - usedPct, pct(reserved, limit));
  return (
    <row {...s.billingMeterTrack} {...(compact ? s.billingMeterTrackCompact : null)} role="progressbar" label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(usedPct)}>
      <row {...s.billingMeterUsed} w={`${usedPct}%`} {...(limit > 0 && used >= limit ? s.billingMeterUsedFull : null)} />
      {heldPct > 0 ? (
        <row {...s.billingMeterHeld} w={`${heldPct}%`}>
          <HeldStripes band={3} size={720} />
        </row>
      ) : null}
    </row>
  );
}

function Section({ id, title, lede, first = false, children, ...style }: { id?: string; title?: string; lede?: string; first?: boolean; children: ReactNode } & Style) {
  const s = useBillingScreen();
  return (
    <col {...s.billingSection} {...style} {...(first ? s.billingSectionFirst : null)} id={id}>
      {title ? (
        <col {...s.billingSectionHead}>
          <T role="heading" {...s.billingSectionTitle}>{title}</T>
          {lede ? <T {...s.billingSectionLede}>{lede}</T> : null}
        </col>
      ) : null}
      {children}
    </col>
  );
}

function BillingSkeleton() {
  const s = useBillingScreen();
  return (
    <col {...s.billingPanel} {...s.billingPanelLoading} aria-busy="true">
      <box {...s.billingSkeletonHead} />
      <box {...s.billingSkeletonBar} />
      <row {...s.billingSkeletonGrid} columns={4}>
        <box {...s.billingSkeletonCol} />
        <box {...s.billingSkeletonCol} />
        <box {...s.billingSkeletonCol} />
        <box {...s.billingSkeletonCol} />
      </row>
    </col>
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
  const [width, setWidth] = useState(0);
  const layout: Layout = { narrow: width > 0 && width <= 640 };

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
    (plan: PaidBillingPlan) => void run("checkout", async (returnUrl) => backendClient.call("billing.checkout", { plan, returnUrl, ...(await storeCheckoutFields()) })),
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

  const measure = (r: { w: number }) => setWidth((prev) => (Math.abs(prev - r.w) < 0.5 ? prev : r.w));

  if (!hasConnectedAccount) {
    return (
      <col {...s.billingPanel} onLayout={measure}>
        <Inherit size={s.billingPanelText.size} color={s.billingPanelText.color}>
          <col {...s.billingEmpty} role="status">
            <T {...s.billingEmptyTitle}>{t("billing.v3.signIn.title")}</T>
            <T {...s.billingEmptyBody}>{t("billing.v3.signIn.body")}</T>
            <BillingButton primary onPress={openSignInDialog}>
              {t("common.signIn")}
            </BillingButton>
          </col>
        </Inherit>
      </col>
    );
  }

  if (!status) return <BillingSkeleton />;

  const plan = normalizeBillingPlan(status.plan);
  const usageShown = Boolean(status.usage) && status.usagePolicy.kind === "managed_cost";

  return (
    <col {...s.billingPanel} onLayout={measure}>
      <Inherit size={s.billingPanelText.size} color={s.billingPanelText.color}>
        {error ? (
          <T {...s.billingBanner} {...s.billingBannerError} role="alert">
            {error}
          </T>
        ) : null}
        {notice ? (
          <T {...s.billingBanner} role="status">
            {notice}
          </T>
        ) : null}
        <UsageSection status={status} plan={plan} now={now} f={f} t={t} busy={busy} layout={layout} onCheckout={checkout} onPortal={portal} />
        <PlanSection status={status} plan={plan} f={f} t={t} busy={busy} layout={layout} first={!usageShown} onCheckout={checkout} onPortal={portal} />
        <CreditSection status={status} f={f} t={t} busy={busy} layout={layout} onBuy={buyCredit} />
      </Inherit>
    </col>
  );
}

function UsageWindow({ label, used, limit, resetsAt, f, t, resets }: { label: string; used: number; limit: number; resetsAt: number; f: Formatters; t: Translate; resets: (at: number | undefined) => string }) {
  const s = useBillingScreen();
  return (
    <col {...s.billingWindow}>
      <row {...s.billingWindowHead}>
        <T {...s.billingWindowLabel}>{label}</T>
        <row {...s.billingWindowMeta}>
          <T {...s.billingWindowMetaText}>{t("billing.v3.usage.percentUsed", { percent: f.percent(used, limit) })}</T>
          <T {...s.billingWindowMetaText} {...s.billingMuted}>{used > 0 ? resets(resetsAt) : t("billing.v3.usage.startsNext")}</T>
        </row>
      </row>
      <MeterTrack compact label={label} used={used} limit={limit} />
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
  layout,
  onCheckout,
  onPortal,
}: {
  status: BillingStatus;
  plan: BillingPlan;
  now: number;
  f: Formatters;
  t: Translate;
  busy: Busy;
  layout: Layout;
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
  const resetText = oneTime ? t("billing.v3.usage.oneTimeNote") : resets(usage.monthlyResetsAt);
  const offerConnect = oneTime && connectPlanOfferEnabled();
  const rollingLabel = t("billing.v3.usage.rolling", { hours: def.budget.rollingWindowHours });

  return (
    <col {...s.billingSection} {...s.billingSectionFirst} {...s.billingSectionUsage}>
      <row {...s.billingUsageHeader}>
        <row {...s.billingUsageIdentity}>
          <T role="heading" {...s.billingUsageTitle}>Stella {def.label}</T>
          <row {...s.billingUsageSummary}>
            <T {...s.billingUsagePct}>{f.percent(mainUsed, mainLimit)}</T>
            <T {...s.billingUsageSummaryText} {...s.billingMuted}>
              {oneTime ? t("billing.v3.usage.usedOneTime") : t("billing.v3.usage.usedMonth")}
            </T>
          </row>
        </row>
        {resetText ? <T {...s.billingUsageReset}>{resetText}</T> : null}
      </row>

      <MeterTrack label={t("billing.v3.usage.title")} used={mainUsed} limit={mainLimit} reserved={reserved} />

      {reserved > 0 ? (
        <row {...s.billingMeterCaption}>
          <row {...s.billingLegend}>
            <row {...s.billingLegendSwatch} {...s.billingLegendUsed} />
            <T {...s.billingLegendText}>{t("billing.v3.usage.used")}</T>
            <row {...s.billingLegendSwatch} {...s.billingLegendHeld}>
              <HeldStripes band={2} size={8} />
            </row>
            <T {...s.billingLegendText}>{t("billing.v3.usage.held")}</T>
          </row>
        </row>
      ) : null}

      {blocked ? (
        <row {...s.billingCallout} role="status">
          <col {...s.billingCalloutText}>
            <T {...s.billingCalloutTitle} {...s.billingCalloutTitleWarning}>{oneTime ? t("billing.v3.usage.freeOutTitle") : t("billing.v3.usage.outTitle")}</T>
            <T {...s.billingCalloutBody}>
              {oneTime
                ? connectPlanOfferEnabled()
                  ? connectPlanCopy("allowance").description
                  : t("billing.v3.usage.freeOutBody")
                : resumesAt
                  ? t("billing.v3.usage.outBody", { date: f.when(resumesAt, now) })
                  : t("billing.v3.usage.outBodyNoDate")}
            </T>
          </col>
          <row {...s.billingCalloutActions}>
            {offerConnect ? (
              <BillingButton
                primary
                onPress={() => {
                  planUsageDialog.close();
                  openConnectPlan({ conversationId: null, reason: "allowance", choose: true });
                }}
              >
                {connectPlanChatGptOnly() ? CONNECT_PLAN_COPY.connectChatGpt : CONNECT_PLAN_COPY.connect}
              </BillingButton>
            ) : null}
            {next ? (
              <BillingButton primary={!offerConnect} disabled={busy !== null} onPress={() => (plan === "free" ? onCheckout(next) : onPortal())}>
                {t("billing.v3.usage.upgradeTo", { plan: PLAN_CATALOG[next].label })}
              </BillingButton>
            ) : null}
          </row>
        </row>
      ) : resumesAt !== null && credit > 0 ? (
        <row {...s.billingCallout} role="status">
          <col {...s.billingCalloutText}>
            <T {...s.billingCalloutTitle}>{t("billing.v3.usage.creditTitle")}</T>
            <T {...s.billingCalloutBody}>{t("billing.v3.usage.creditBody", { date: f.when(resumesAt, now) })}</T>
          </col>
        </row>
      ) : null}

      {oneTime ? null : (
        <row {...s.billingWindows} {...(layout.narrow ? s.billingWindowsNarrow : null)} columns={layout.narrow ? 1 : 2}>
          <UsageWindow label={rollingLabel} used={usage.rollingUsedUsd} limit={usage.rollingLimitUsd} resetsAt={usage.rollingResetsAt} f={f} t={t} resets={resets} />
          <UsageWindow label={t("billing.v3.usage.weekly")} used={usage.weeklyUsedUsd} limit={usage.weeklyLimitUsd} resetsAt={usage.weeklyResetsAt} f={f} t={t} resets={resets} />
        </row>
      )}
    </col>
  );
}

type PlanAction = { label: string; primary: boolean; onClick: () => void };

function PlanSection({
  status,
  plan,
  f,
  t,
  busy,
  layout,
  first,
  onCheckout,
  onPortal,
}: {
  status: BillingStatus;
  plan: BillingPlan;
  f: Formatters;
  t: Translate;
  busy: Busy;
  layout: Layout;
  first: boolean;
  onCheckout: (plan: PaidBillingPlan) => void;
  onPortal: () => void;
}) {
  const s = useBillingScreen();
  const isPaid = isPaidBillingPlan(plan);
  const periodEnd = status.currentPeriodEnd ? f.day(status.currentPeriodEnd) : null;
  const priceOf = (id: BillingPlan) => t("billing.v3.plan.perMonth", { price: f.amount(PLAN_CATALOG[id].monthlyPriceCents / 100) });
  const suggested =
    planRank(plan) < planRank(RECOMMENDED_PLAN) ? RECOMMENDED_PLAN : nextPlanUp(plan);
  const cols = layout.narrow ? 2 : 4;

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
    <Section id="billing-plans" first={first} title={t("billing.v3.plan.heading")} lede={t("billing.v3.plan.lede")}>
      <row {...s.billingPlans} columns={cols} role="list">
        {PLAN_ORDER.map((id, index) => {
          const def = PLAN_CATALOG[id];
          const current = id === plan;
          const recommended = id === RECOMMENDED_PLAN && !current;
          const action = actionFor(id);
          const column = index % cols;
          const sides: [number, number, number, number] = [index >= cols ? 1 : 0, 0, 0, column === 0 ? 0 : 1];
          return (
            <col
              {...s.billingPlan}
              key={id}
              column={column}
              role="listitem"
              border={sides.some(Boolean) ? s.billingLine.fill : undefined}
              borderSides={sides}
              pt={(s.billingPlan.pt as number) + sides[0]}
              pl={column === 0 ? 0 : (s.billingPlan.px as number) + sides[3]}
              pr={column === cols - 1 ? 0 : s.billingPlan.px}
            >
              <row {...s.billingPlanTop}>
                <T {...s.billingPlanName}>{def.label}</T>
                {recommended ? <T {...s.billingPlanTag}>{t("billing.v3.plan.recommended")}</T> : null}
              </row>
              <T {...s.billingPlanTagline}>{planTagline(id, t)}</T>
              <row {...s.billingPlanPrice}>
                <T {...s.billingPlanAmount}>{f.amount(def.monthlyPriceCents / 100)}</T>
                <T {...s.billingPlanPer}>{def.interval ? t("billing.v3.plan.month") : t("billing.v3.plan.noCard")}</T>
              </row>
              <row {...s.billingPlanCta}>
                {action ? (
                  <BillingButton {...s.billingPlanBtn} primary={action.primary} disabled={busy !== null} onPress={action.onClick}>
                    {action.label}
                  </BillingButton>
                ) : (
                  <row {...s.billingPlanCurrent} aria-current="true">
                    <box {...s.billingPlanCurrentDot} />
                    <T {...tx(s.billingPlanCurrent)}>{t("billing.v3.plan.currentPlan")}</T>
                  </row>
                )}
              </row>
              <col {...s.billingPlanFeatures}>
                {planIncludesLines(id, t).map((line) => (
                  <T key={line} {...s.billingPlanFeature}>{line}</T>
                ))}
              </col>
            </col>
          );
        })}
      </row>
      <T {...s.billingPlansNote}>
        {busy === "checkout" || busy === "portal"
          ? t("billing.v3.opening")
          : isPaid
            ? t("billing.v3.plan.changeHint")
            : t("billing.v3.plan.checkoutHint")}
      </T>
      {isPaid ? (
        <col {...s.billingRows}>
          <Row
            label={status.cancelAtPeriodEnd ? t("billing.v3.plan.ends") : t("billing.v3.plan.renews")}
            hint={
              status.cancelAtPeriodEnd
                ? t("billing.v3.plan.endsHint", { plan: PLAN_CATALOG[plan].label })
                : t("billing.v3.plan.renewsHint", { price: priceOf(plan) })
            }
          >
            <T {...s.billingValue}>{periodEnd ?? "—"}</T>
          </Row>
          <Row label={t("billing.v3.plan.manage")} hint={t("billing.v3.plan.manageHint")}>
            <Press {...s.billingTextAction} {...(busy !== null ? s.billingTextActionDisabled : null)} disabled={busy !== null} onPress={onPortal}>
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
  layout,
  onBuy,
}: {
  status: BillingStatus;
  f: Formatters;
  t: Translate;
  busy: Busy;
  layout: Layout;
  onBuy: (amountCents: number) => void;
}) {
  const s = useBillingScreen();
  const options = status.creditPurchase;
  const [preset, setPreset] = useState<number | null>(options.presetAmountCents[1] ?? options.presetAmountCents[0] ?? null);
  const [custom, setCustom] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

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
    <Section {...s.billingSectionCredit}>
      <row {...s.billingCreditLayout}>
        <col {...s.billingCreditCopy}>
          <row {...s.billingCreditHead}>
            <T role="heading" {...s.billingSectionTitle}>{t("billing.v3.credit.title")}</T>
            <T {...s.billingBalanceInline}>{f.usd(status.credits.balanceUsd)}</T>
          </row>
          <T {...s.billingSectionLede}>{t("billing.v3.credit.lede")}</T>
        </col>
        <col {...s.billingTopup} {...(layout.narrow ? s.billingTopupNarrow : null)}>
          <row {...s.billingCredit} {...(layout.narrow ? s.billingCreditNarrow : null)}>
            <row {...s.billingWordPicker} role="radiogroup" label={t("billing.v3.credit.add")}>
              {options.presetAmountCents.map((cents) => {
                const on = !custom.trim() && preset === cents;
                return (
                  <Press
                    key={cents}
                    {...s.billingWordPickerOption}
                    {...(on ? s.billingWordPickerOptionOn : null)}
                    vertical
                    role="radio"
                    checked={on}
                    onPress={() => {
                      setPreset(cents);
                      setCustom("");
                      setInputError(null);
                    }}
                  >
                    <T {...tx(s.billingWordPickerOption, on ? s.billingWordPickerOptionOn : null)}>{f.amount(cents / 100)}</T>
                    <box {...s.billingWordPickerDot} opacity={on ? 1 : 0} scale={on ? 1 : 0} />
                  </Press>
                );
              })}
            </row>
            <row {...s.billingInputWrap} {...(focused ? s.billingInputWrapFocused : null)}>
              <T {...s.billingInputDollar}>$</T>
              <Input
                {...s.billingInput}
                inputMode="decimal"
                placeholder={t("billing.v3.credit.other")}
                aria-label={t("billing.v3.credit.other")}
                aria-invalid={inputError ? true : undefined}
                value={custom}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onChange={(event) => {
                  setCustom(event.target.value);
                  setInputError(null);
                }}
              />
            </row>
            <BillingButton primary disabled={busy !== null || amountCents === null} onPress={submit}>
              {busy === "credit"
                ? t("billing.v3.opening")
                : amountCents
                  ? t("billing.v3.credit.addAmount", { amount: f.usd(amountCents / 100) })
                  : t("billing.v3.credit.add")}
            </BillingButton>
          </row>
          {inputError ? <T {...s.billingFieldError}>{inputError}</T> : null}
          <T {...s.billingCreditHint}>{t("billing.v3.credit.addHint")}</T>
        </col>
      </row>
    </Section>
  );
}

export function BillingScreen() {
  const s = useBillingScreen();
  const inset = useTopInset();
  return (
    <col w="full" h="full">
      <col w="full" grow={1} shrink minH={0}>
        <col w="full" {...s.billingScreenScroll} pt={(s.billingScreenScroll.py ?? 0) + inset}>
          <BillingPanel />
        </col>
      </col>
    </col>
  );
}
