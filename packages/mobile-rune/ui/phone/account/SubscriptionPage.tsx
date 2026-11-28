import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { BillingStatus } from "@stella/contracts/backend/billing";
import {
  PLAN_CATALOG,
  PLAN_ORDER,
  isPaidBillingPlan,
  normalizeBillingPlan,
  planLabel,
  type BillingPlan,
  type PaidBillingPlan,
} from "@stella/contracts/billing-plans";
import { backendClient } from "@/platform/backend/backend-client";
import { useBackendValue } from "@/platform/backend/use-backend-view";
import { openExternalUrl } from "@/platform/electron/open-external";
import { useLocale, useT } from "@/shared/i18n";
import { Icon } from "../../../../desktop-rune/ui/kit";
import { alpha } from "../../../../desktop-rune/ui/theme";
import { storefrontCountry } from "../../../js/replace/ui/global/billing/store-checkout";
import { glyph } from "../icons";
import { Dot, Hairline, rt, SectionLabel, TextAction, useRn, type RnColors } from "../rn";
import { LinkAction, PrimaryButton, Spinner, TNUM, tapLight } from "./kit";

// packages/mobile's SubscriptionSection.jsx: the drawer's summary (the plan, a usage bar and when
// it resets) and the Subscription page (current plan and usage, then every plan with its price,
// subscribing through checkout on the web for a US App Store storefront).

type Translate = ReturnType<typeof useT>;

const S = {
  heroPlan: rt(28, 700, -1, 34),
  heroMeta: rt(14, 600, 0, 19),
  heroMetaDanger: rt(14, 600),
  overviewRenewal: rt(14, 600),
  usageLabel: rt(15, 600),
  usageValue: rt(16, 600),
  usageMuted: rt(13.5, 500),
  noticeTitle: rt(16, 600),
  noticeBody: rt(14, 500, 0, 20),
  plansLede: rt(14, 500, 0, 20),
  planName: rt(22, 700, -0.6),
  planTag: rt(13.5, 600),
  planAmount: rt(20, 700, -0.5),
  planPer: rt(13, 500),
  planDetails: rt(14, 500, 0, 20),
  manage: rt(19, 600, -0.4),
  error: rt(14, 500),
  footnote: rt(13.5, 500, 0, 19),
} as const;

const RECOMMENDED_PLAN: PaidBillingPlan = "pro";
const US_STOREFRONT = "USA";
const RETURN_URL = `${((import.meta.env.VITE_STELLA_WEB_URL as string | undefined)?.trim() || "https://stella.sh").replace(/\/+$/, "")}/billing`;

const formatAmount = (dollars: number) => {
  const value = Math.max(0, dollars);
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
};

const formatUsd = (dollars: number) => `$${Math.max(0, dollars || 0).toFixed(2)}`;

function usedPercent(used: number, limit: number): number {
  if (!(limit > 0) || !(used > 0)) return 0;
  if (used >= limit) return 100;
  return Math.min(99, Math.max(1, Math.floor((used / limit) * 100)));
}

function formatReset(ms: number | null | undefined, locale: string): string {
  if (typeof ms !== "number" || ms <= 0) return "";
  const delta = ms - Date.now();
  try {
    return new Date(ms).toLocaleString(
      locale,
      delta < 24 * 60 * 60 * 1000
        ? { hour: "numeric", minute: "2-digit" }
        : delta < 7 * 24 * 60 * 60 * 1000
          ? { weekday: "long", hour: "numeric", minute: "2-digit" }
          : { month: "short", day: "numeric" },
    );
  } catch {
    return "";
  }
}

function formatDate(ms: number | null | undefined): string {
  if (typeof ms !== "number" || ms <= 0) return "";
  try {
    return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

function planIncludes(plan: BillingPlan, t: Translate): string[] {
  const def = PLAN_CATALOG[plan];
  if (!def.interval) return [t("billing.v3.includes.voice"), t("billing.v3.includes.byok")];
  return def.mediaGeneration ? [t("billing.v3.includes.media")] : [];
}

type Metrics = {
  usage: NonNullable<BillingStatus["usage"]>;
  oneTime: boolean;
  limit: number;
  used: number;
  percent: number;
  heldPercent: number;
  credit: number;
  blocked: boolean;
  resumesAt: number | null;
};

function deriveUsageMetrics(status: BillingStatus | null | undefined, plan: BillingPlan): Metrics | null {
  const usage = status?.usage;
  if (!usage || !status || status.usagePolicy.kind !== "managed_cost") return null;
  const oneTime = plan === "free" && usage.lifetimeLimitUsd !== null;
  const limit = (oneTime ? usage.lifetimeLimitUsd : usage.monthlyLimitUsd) ?? 0;
  const used = Math.min(limit, (oneTime ? usage.lifetimeUsedUsd : usage.monthlyUsedUsd) ?? 0);
  const percent = limit > 0 ? Math.min(100, Math.max(0, (used / limit) * 100)) : 0;
  const reserved = Number.isFinite(usage.reservedUsd) ? usage.reservedUsd : 0;
  const heldPercent = limit > 0 ? Math.min(100 - percent, (reserved / limit) * 100) : 0;
  const credit = status.credits ? status.credits.balanceUsd : 0;
  const blocked = typeof usage.availableUsd === "number" && usage.availableUsd <= 0.0001;
  const windows: [number | null | undefined, number | null | undefined, number | null | undefined][] = oneTime
    ? []
    : [
        [usage.rollingUsedUsd, usage.rollingLimitUsd, usage.rollingResetsAt],
        [usage.weeklyUsedUsd, usage.weeklyLimitUsd, usage.weeklyResetsAt],
        [usage.monthlyUsedUsd, usage.monthlyLimitUsd, usage.monthlyResetsAt],
      ];
  const exceeded = windows.filter(([u, l, at]) => typeof l === "number" && l > 0 && typeof u === "number" && u >= l && typeof at === "number");
  const resumesAt = exceeded.length ? Math.max(...exceeded.map((w) => w[2] as number)) : null;
  return { usage, oneTime, limit, used, percent, heldPercent, credit, blocked, resumesAt };
}

const signedInStatus = (status: BillingStatus | undefined): status is BillingStatus => Boolean(status && status.authenticated && !status.isAnonymous);

const trackFill = (c: RnColors) => alpha(c.text, c.dark ? 0.14 : 0.09);

function UsageTrack({ metrics, height, danger }: { metrics: Metrics; height: number; danger: boolean }) {
  const c = useRn();
  return (
    <row role="progressbar" label={`${Math.round(metrics.percent)}%`} h={height} radius={height / 2} clip={height / 2} fill={trackFill(c)}>
      <box w={`${metrics.percent}%`} h="full" fill={danger ? c.danger : c.text} />
      {metrics.heldPercent > 0 ? <box w={`${metrics.heldPercent}%`} h="full" fill={c.textMuted} opacity={0.45} /> : null}
    </row>
  );
}

function StatusDot({ color }: { color: string }) {
  return <box w={6} h={6} radius={3} fill={color} shrink={false} />;
}

/** SubscriptionSummaryCard: the drawer's plan, usage bar and reset line, opening the Subscription page. */
export function SubscriptionSummaryCard({ onPress }: { onPress: () => void }) {
  const c = useRn();
  const t = useT();
  const locale = useLocale();
  const status = useBackendValue("billing.status", {});
  if (!signedInStatus(status)) return null;

  const plan = normalizeBillingPlan(status.plan);
  const metrics = deriveUsageMetrics(status, plan);
  const renewalDate = isPaidBillingPlan(plan) && status.currentPeriodEnd ? formatDate(status.currentPeriodEnd) : "";
  const resetText = metrics
    ? metrics.oneTime
      ? t("billing.v3.usage.oneTimeNote")
      : t("billing.v3.usage.resets", { date: formatReset(metrics.usage.monthlyResetsAt, locale) })
    : renewalDate
      ? status.cancelAtPeriodEnd
        ? t("billing.mobile.accessEnds", { date: renewalDate })
        : t("billing.mobile.renews", { date: renewalDate })
      : "";
  const planTitle = t("billing.mobile.planValue", { plan: planLabel(plan) });
  const percentText = metrics ? t("billing.v3.usage.percentUsed", { percent: `${usedPercent(metrics.used, metrics.limit)}%` }) : "";
  const metaLine = [percentText, resetText, metrics && metrics.credit > 0 ? `${t("billing.v3.usage.credit")}: ${formatUsd(metrics.credit)}` : ""].filter(Boolean).join(" · ");
  const title = t("billing.mobile.sectionTitle");

  return (
    <col>
      <SectionLabel>{title}</SectionLabel>
      <col
        id="phone-account-subscription-row"
        role="button"
        label={percentText ? `${title}, ${planTitle}, ${percentText}` : `${title}, ${planTitle}`}
        focusable
        gap={8}
        py={4}
        pressScale={0.985}
        onPress={() => {
          tapLight();
          onPress();
        }}
      >
        <row align="center" justify="between" gap={10}>
          <text {...S.heroPlan} color={c.text} maxLines={1} grow={1} shrink>
            {planTitle}
          </text>
          <Icon icon={glyph("chevron-right")} size={15} color={c.textMuted} />
        </row>
        {metrics ? <UsageTrack metrics={metrics} height={4} danger={metrics.percent >= 100 || metrics.blocked} /> : null}
        {metrics?.blocked ? (
          <row align="center" gap={7}>
            <StatusDot color={c.danger} />
            <text {...S.heroMetaDanger} color={c.danger} maxLines={1}>
              {metrics.oneTime ? t("billing.v3.usage.freeOutTitle") : t("billing.v3.usage.outTitle")}
            </text>
          </row>
        ) : metaLine ? (
          <text {...S.heroMeta} color={c.textMuted} features={TNUM} maxLines={2}>
            {metaLine}
          </text>
        ) : null}
      </col>
    </col>
  );
}

type CheckoutPhase = "idle" | "starting" | "pending" | "error";
type CheckoutError = { code: string | null; message: string };

const errorCode = (e: unknown): string | null => (e && typeof e === "object" && typeof (e as { code?: unknown }).code === "string" ? (e as { code: string }).code : null);
const errorMessage = (e: unknown, t: Translate): string => (e instanceof Error && e.message.trim() ? e.message.trim() : t("errors.generic"));

/** useMobileCheckout: checkout and the billing portal open on the web; the page waits for the plan to change. */
function useCheckout(t: Translate) {
  const [phase, setPhase] = useState<CheckoutPhase>("idle");
  const [error, setError] = useState<CheckoutError | null>(null);
  const inFlight = useRef(false);

  const reset = useCallback(() => {
    setPhase("idle");
    setError(null);
  }, []);

  const startCheckout = useCallback(
    async (plan: PaidBillingPlan, country: string | null) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setError(null);
      setPhase("starting");
      try {
        const result = await backendClient.call("billing.checkout", { plan, returnUrl: RETURN_URL, source: "ios", ...(country ? { appStoreCountry: country } : {}) });
        if (!result?.url) throw new Error("Checkout could not be started. Please try again.");
        setPhase("pending");
        openExternalUrl(result.url);
      } catch (e) {
        setError({ code: errorCode(e), message: errorMessage(e, t) });
        setPhase("error");
      } finally {
        inFlight.current = false;
      }
    },
    [t],
  );

  const openManage = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await backendClient.call("billing.portal", { returnUrl: RETURN_URL });
      if (result?.url) openExternalUrl(result.url);
    } catch (e) {
      setError({ code: null, message: errorMessage(e, t) });
      setPhase("error");
    } finally {
      inFlight.current = false;
    }
  }, [t]);

  return { phase, error, startCheckout, openManage, reset };
}

type Storefront = { status: "loading" | "eligible" | "ineligible"; country: string | null };

/** useStorefrontEligibility: subscribing here is offered only on a US App Store storefront. */
function useStorefront(): Storefront {
  const [state, setState] = useState<Storefront>({ status: "loading", country: null });
  useEffect(() => {
    let live = true;
    void storefrontCountry().then((country) => {
      if (live) setState({ status: country === US_STOREFRONT ? "eligible" : "ineligible", country });
    });
    return () => {
      live = false;
    };
  }, []);
  return state;
}

/** SubscriptionSection embedded: the Subscription page's body. */
export function SubscriptionPage() {
  const c = useRn();
  const t = useT();
  const locale = useLocale();
  const status = useBackendValue("billing.status", {});
  const storefront = useStorefront();
  const checkout = useCheckout(t);
  const [justSubscribed, setJustSubscribed] = useState<BillingPlan | null>(null);
  const startedPlan = useRef<BillingPlan | null>(null);

  const plan = normalizeBillingPlan(status ? status.plan : "free");
  const currentPlan = status ? normalizeBillingPlan(status.plan) : null;
  const { phase, reset } = checkout;
  useEffect(() => {
    if (phase === "pending" && currentPlan && isPaidBillingPlan(currentPlan) && currentPlan !== startedPlan.current) {
      setJustSubscribed(currentPlan);
      reset();
    }
  }, [phase, currentPlan, reset]);

  if (!signedInStatus(status)) return null;

  const isPaid = isPaidBillingPlan(plan);
  const eligible = storefront.status === "eligible";
  const metrics = deriveUsageMetrics(status, plan);
  const renewalDate = isPaid && status.currentPeriodEnd ? formatDate(status.currentPeriodEnd) : "";

  const subscribe = (key: PaidBillingPlan) => {
    tapLight();
    startedPlan.current = normalizeBillingPlan(status.plan);
    setJustSubscribed(null);
    void checkout.startCheckout(key, storefront.country);
  };

  const notice = (head: ReactNode, title: string, body: string, action?: ReactNode) => (
    <col gap={6} mt={4}>
      <row align="center" gap={8}>
        {head}
        <text {...S.noticeTitle} color={c.text} shrink>
          {title}
        </text>
      </row>
      <text {...S.noticeBody} color={c.textMuted}>
        {body}
      </text>
      {action}
    </col>
  );

  const planRow = (key: BillingPlan) => {
    const def = PLAN_CATALOG[key];
    const starting = checkout.phase === "starting";
    const isCurrent = key === plan;
    const rank = (id: BillingPlan) => PLAN_ORDER.indexOf(id);
    const suggested = rank(plan) < rank(RECOMMENDED_PLAN) ? RECOMMENDED_PLAN : (PLAN_ORDER[rank(plan) + 1] ?? null);
    const canSubscribe = eligible && !isPaid && !isCurrent && isPaidBillingPlan(key);
    const change = eligible && isPaid && !isCurrent;
    const primary = (canSubscribe || change) && key === suggested;
    const actionLabel = canSubscribe
      ? starting
        ? t("billing.mobile.startingCheckout")
        : t("billing.v3.plan.get", { plan: planLabel(key) })
      : rank(key) > rank(plan)
        ? t("billing.v3.usage.upgradeTo", { plan: planLabel(key) })
        : t("billing.v3.plan.switchTo", { plan: planLabel(key) });
    const onAction = () => {
      if (canSubscribe && isPaidBillingPlan(key)) return subscribe(key);
      tapLight();
      void checkout.openManage();
    };
    const details = [t(`billing.v3.tagline.${key}`), ...planIncludes(key, t)].join(" · ");
    return (
      <col key={key} id={`phone-account-plan-${key}`} gap={6}>
        <row align="end" justify="between" gap={10}>
          <row grow={1} minW={0} align="center" gap={8} wrap>
            <text {...S.planName} color={c.text}>
              {planLabel(key)}
            </text>
            {isCurrent ? (
              <row align="center" gap={6}>
                <Dot size={6} />
                <text {...S.planTag} color={c.accent}>
                  {t("billing.v3.plan.currentPlan")}
                </text>
              </row>
            ) : key === RECOMMENDED_PLAN ? (
              <text {...S.planTag} color={c.textMuted}>
                {t("billing.v3.plan.recommended")}
              </text>
            ) : null}
          </row>
          <row align="end" gap={4} shrink={false}>
            <text {...S.planAmount} color={c.text} features={TNUM}>
              {formatAmount(def.monthlyPriceCents / 100)}
            </text>
            <text {...S.planPer} color={c.textMuted} pb={2}>
              {def.interval ? t("billing.v3.plan.month") : t("billing.v3.plan.noCard")}
            </text>
          </row>
        </row>
        <text {...S.planDetails} color={c.textMuted}>
          {details}
        </text>
        {canSubscribe || change ? (
          <col mt={8}>{primary ? <PrimaryButton id={`phone-account-plan-${key}-action`} label={actionLabel} disabled={starting} onPress={onAction} /> : <LinkAction label={actionLabel} disabled={starting} onPress={onAction} />}</col>
        ) : null}
      </col>
    );
  };

  const purchase = () => {
    if (justSubscribed) return null;
    if (checkout.phase === "pending")
      return notice(
        <Spinner color={c.text} />,
        t("billing.mobile.pendingTitle"),
        t("billing.mobile.pendingBody"),
        <TextAction
          label={t("billing.mobile.pendingDismiss")}
          tone="muted"
          onPress={() => {
            tapLight();
            checkout.reset();
          }}
        />,
      );
    return (
      <col>
        <SectionLabel>{t("billing.v3.plan.heading")}</SectionLabel>
        <text {...S.plansLede} color={c.textMuted} mt={2}>
          {t("billing.v3.plan.lede")}
        </text>
        {checkout.phase === "error" && checkout.error
          ? notice(
              null,
              checkout.error.code === "CONFLICT" ? t("billing.mobile.alreadySubscribedTitle") : t("errors.generic"),
              checkout.error.message,
              <TextAction
                label={t("billing.mobile.errorRetry")}
                onPress={() => {
                  tapLight();
                  checkout.reset();
                }}
              />,
            )
          : null}
        <col gap={24} mt={20}>
          {PLAN_ORDER.map(planRow)}
        </col>
        {!isPaid && eligible ? (
          <text {...S.footnote} color={c.textWeaker} mt={22}>
            {t("billing.mobile.footnote")}
          </text>
        ) : null}
      </col>
    );
  };

  const manage = () => {
    if (storefront.status === "loading") return null;
    if (!eligible)
      return (
        <text {...S.footnote} color={c.textWeaker} mt={22}>
          {t("billing.mobile.manageWebNote")}
        </text>
      );
    return (
      <col>
        <Hairline space={20} />
        {checkout.error ? (
          <text {...S.error} color={c.danger} mb={8}>
            {checkout.error.message}
          </text>
        ) : null}
        <row
          role="button"
          label={t("billing.mobile.manage")}
          focusable
          minH={50}
          align="center"
          justify="between"
          pressScale={0.985}
          onPress={() => {
            tapLight();
            void checkout.openManage();
          }}
        >
          <text {...S.manage} color={c.text}>
            {t("billing.mobile.manage")}
          </text>
          <Icon icon={glyph("chevron-right")} size={15} color={c.textMuted} />
        </row>
      </col>
    );
  };

  return (
    <col pt={2}>
      <col gap={16}>
        <col>
          <SectionLabel>{t("billing.mobile.currentPlanLabel")}</SectionLabel>
          <text {...S.heroPlan} color={c.text} mt={2}>
            {t("billing.mobile.planValue", { plan: planLabel(plan) })}
          </text>
          {renewalDate ? (
            <text {...S.overviewRenewal} color={c.textMuted} mt={3}>
              {status.cancelAtPeriodEnd ? t("billing.mobile.accessEnds", { date: renewalDate }) : t("billing.mobile.renews", { date: renewalDate })}
            </text>
          ) : null}
        </col>

        {metrics ? (
          <col gap={8}>
            <row align="end" justify="between">
              <text {...S.usageLabel} color={c.textMuted}>
                {metrics.oneTime ? t("billing.v3.mobile.usageOneTime") : t("billing.v3.mobile.usageRow")}
              </text>
              <text {...S.usageValue} color={c.text} features={TNUM}>
                {t("billing.v3.usage.percentUsed", { percent: `${usedPercent(metrics.used, metrics.limit)}%` })}
              </text>
            </row>
            <UsageTrack metrics={metrics} height={5} danger={metrics.percent >= 100} />
            <row wrap gap={10} justify="between">
              <text {...S.usageMuted} color={c.textMuted}>
                {metrics.oneTime ? t("billing.v3.usage.oneTimeNote") : t("billing.v3.usage.resets", { date: formatReset(metrics.usage.monthlyResetsAt, locale) })}
              </text>
              {metrics.credit > 0 ? (
                <text {...S.usageMuted} color={c.textMuted}>
                  {`${t("billing.v3.usage.credit")}: ${formatUsd(metrics.credit)}`}
                </text>
              ) : null}
            </row>
          </col>
        ) : null}

        {metrics?.blocked
          ? notice(
              <StatusDot color={c.danger} />,
              metrics.oneTime ? t("billing.v3.usage.freeOutTitle") : t("billing.v3.usage.outTitle"),
              metrics.oneTime
                ? t("billing.v3.usage.freeOutBody")
                : metrics.resumesAt
                  ? t("billing.v3.usage.outBody", { date: formatReset(metrics.resumesAt, locale) })
                  : t("billing.v3.usage.outBodyNoDate"),
            )
          : metrics?.resumesAt && metrics.credit > 0
            ? notice(<Dot size={6} />, t("billing.v3.usage.creditTitle"), t("billing.v3.usage.creditBody", { date: formatReset(metrics.resumesAt, locale) }))
            : null}

        {justSubscribed
          ? notice(
              <StatusDot color={c.ok} />,
              t("billing.mobile.successTitle", { plan: planLabel(justSubscribed) }),
              t("billing.mobile.successBody"),
              <TextAction
                label={t("mobile.common.done")}
                onPress={() => {
                  tapLight();
                  setJustSubscribed(null);
                }}
              />,
            )
          : null}
      </col>

      <Hairline space={22} />
      {purchase()}
      {isPaid ? manage() : null}
    </col>
  );
}
