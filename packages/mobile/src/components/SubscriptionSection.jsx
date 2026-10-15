import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { Text } from "./Text";
import { useBackendView } from "../lib/backend";
import {
  setDebugStorefrontOverride,
  useStorefrontEligibility,
} from "../lib/use-storefront-eligibility";
import { useMobileCheckout } from "../lib/use-mobile-checkout";
import { useColors } from "../theme/theme-context";
import { fonts } from "../theme/fonts";
import { useLocale, useT } from "../i18n";
import {
  PAID_BILLING_PLANS,
  PLAN_CATALOG,
  isPaidBillingPlan,
  normalizeBillingPlan,
  planLabel as catalogPlanLabel,
} from "@stella/contracts/billing-plans";
import { PrimaryButton } from "./PrimaryButton";
import { tapLight } from "../lib/haptics";

function formatAmount(dollars) {
  if (typeof dollars !== "number" || !Number.isFinite(dollars)) return "";
  const value = Math.max(0, dollars);
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

function formatUsd(dollars) {
  return `$${Math.max(0, dollars || 0).toFixed(2)}`;
}

function formatReset(ms, locale) {
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

function planIncludes(plan, t) {
  const def = PLAN_CATALOG[plan];
  if (!def.interval) {
    return [
      t("billing.v3.includes.oneTime", { amount: formatAmount(def.budget.oneTimeUsd ?? def.budget.monthlyUsd) }),
      t("billing.v3.includes.local"),
    ];
  }
  return [
    t("billing.v3.includes.monthly", { amount: formatAmount(def.budget.monthlyUsd) }),
    t("billing.v3.includes.cloud", { count: def.limits.cloudAgentsAtOnce }),
    ...(def.mediaGeneration ? [t("billing.v3.includes.media")] : []),
  ];
}

function formatDate(ms) {
  if (typeof ms !== "number" || ms <= 0) return "";
  try {
    return new Date(ms).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

export function SubscriptionSection() {
  const colors = useColors();
  const t = useT();
  const locale = useLocale();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const status = useBackendView("billing.status", {}).value;
  const storefront = useStorefrontEligibility();
  const checkout = useMobileCheckout();

  const [justSubscribedPlan, setJustSubscribedPlan] = useState(null);
  const [plansOpen, setPlansOpen] = useState(false);
  const startedPlanRef = useRef(null);
  const debugTapRef = useRef(0);

  const plan = normalizeBillingPlan(status ? status.plan : "free");
  const signedIn = Boolean(status && status.authenticated && !status.isAnonymous);
  const isPaid = isPaidBillingPlan(plan);
  const eligible = storefront.status === "eligible";

  const checkoutPhase = checkout.phase;
  const currentPlan = status ? normalizeBillingPlan(status.plan) : null;
  useEffect(() => {
    if (
      checkoutPhase === "pending" &&
      isPaidBillingPlan(currentPlan) &&
      currentPlan !== startedPlanRef.current
    ) {
      setJustSubscribedPlan(currentPlan);
      checkout.reset();
    }
  }, [checkoutPhase, currentPlan, checkout]);

  const onDebugCycle = () => {
    if (!__DEV__) return;
    debugTapRef.current += 1;
    if (debugTapRef.current < 3) return;
    debugTapRef.current = 0;
    const next =
      storefront.countryCode === "USA"
        ? "GBR"
        : storefront.countryCode === "GBR"
          ? null
          : "USA";
    setDebugStorefrontOverride(next);
    storefront.refresh();
  };

  const handleSubscribe = (planKey) => {
    tapLight();
    startedPlanRef.current = status ? status.plan : "free";
    setJustSubscribedPlan(null);
    void checkout.startCheckout(planKey, storefront.countryCode);
  };

  const header = (
    <Pressable onPress={onDebugCycle} disabled={!__DEV__}>
      <Text style={styles.sectionLabel}>{t("billing.mobile.sectionTitle")}</Text>
    </Pressable>
  );

  if (status === undefined || storefront.status === "loading") {
    return null;
  }

  if (!signedIn) return null;

  const canExpand = !isPaid && eligible;
  const showPlans =
    canExpand &&
    (plansOpen ||
      checkoutPhase !== "idle" ||
      justSubscribedPlan !== null);
  return (
    <View style={styles.section}>
      {header}
      <View style={styles.card}>
        {/* Current plan */}
        <Pressable
          disabled={!canExpand}
          accessibilityRole={canExpand ? "button" : undefined}
          accessibilityState={canExpand ? { expanded: showPlans } : undefined}
          onPress={() => {
            tapLight();
            setPlansOpen((open) => !open);
          }}
          style={({ pressed }) => [
            styles.currentPlanRow,
            pressed && styles.rowPressed,
          ]}
        >
          <Text style={styles.currentPlanLabel}>
            {t("billing.mobile.currentPlanLabel")}
          </Text>
          <Text style={styles.currentPlanValue}>
            {t("billing.mobile.planValue", { plan: planLabel(plan) })}
          </Text>
          {canExpand ? (
            <Text style={[styles.chevron, showPlans && styles.chevronOpen]}>
              ›
            </Text>
          ) : null}
        </Pressable>
        {isPaid ? renderRenewal() : null}
        {renderUsage()}

        {justSubscribedPlan ? renderSuccess() : null}

        {isPaid
          ? renderManage()
          : showPlans
            ? renderPurchase()
            : null }
      </View>
    </View>
  );

  function planLabel(key) {
    return catalogPlanLabel(key);
  }

  function renderUsage() {
    const usage = status ? status.usage : null;
    if (!usage || !status || status.usagePolicy.kind !== "managed_cost") return null;
    const oneTime = plan === "free" && usage.lifetimeLimitUsd !== null;
    const used = oneTime ? usage.lifetimeUsedUsd : usage.monthlyUsedUsd;
    const limit = oneTime ? usage.lifetimeLimitUsd : usage.monthlyLimitUsd;
    const percent = limit > 0 ? Math.min(100, Math.max(0, (used / limit) * 100)) : 0;
    const reserved = Number.isFinite(usage.reservedUsd) ? usage.reservedUsd : 0;
    const heldPercent = limit > 0 ? Math.min(100 - percent, (reserved / limit) * 100) : 0;
    const credit = status.credits ? status.credits.balanceUsd : 0;
    const blocked = typeof usage.availableUsd === "number" && usage.availableUsd <= 0.0001;
    const exceeded = oneTime
      ? []
      : [
          [usage.rollingUsedUsd, usage.rollingLimitUsd, usage.rollingResetsAt],
          [usage.weeklyUsedUsd, usage.weeklyLimitUsd, usage.weeklyResetsAt],
          [usage.monthlyUsedUsd, usage.monthlyLimitUsd, usage.monthlyResetsAt],
        ].filter(([u, l, at]) => l > 0 && u >= l && typeof at === "number");
    const resumesAt = exceeded.length ? Math.max(...exceeded.map((w) => w[2])) : null;
    return (
      <View style={styles.usage}>
        <View style={styles.usageHead}>
          <Text style={styles.currentPlanLabel}>
            {oneTime ? t("billing.v3.mobile.usageOneTime") : t("billing.v3.mobile.usageRow")}
          </Text>
          <Text style={styles.usageValue}>
            {formatUsd(used)}{" "}
            <Text style={styles.usageMuted}>{t("billing.v3.usage.of", { amount: formatAmount(limit) })}</Text>
          </Text>
        </View>
        <View
          style={styles.track}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: Math.round(percent) }}
        >
          <View style={[styles.fill, percent >= 100 && styles.fillFull, { width: `${percent}%` }]} />
          {heldPercent > 0 ? <View style={[styles.held, { width: `${heldPercent}%` }]} /> : null}
        </View>
        <Text style={styles.usageMuted}>
          {oneTime
            ? t("billing.v3.usage.oneTimeNote")
            : t("billing.v3.usage.resets", { date: formatReset(usage.monthlyResetsAt, locale) })}
        </Text>
        {reserved > 0 ? (
          <Text style={styles.usageMuted}>
            {t("billing.v3.usage.held")}: {formatUsd(reserved)}
          </Text>
        ) : null}
        {credit > 0 ? (
          <Text style={styles.usageMuted}>
            {t("billing.v3.usage.credit")}: {formatUsd(credit)}
          </Text>
        ) : null}
        {blocked ? (
          <View style={[styles.banner, styles.bannerError]}>
            <Text style={styles.bannerTitle}>
              {oneTime ? t("billing.v3.usage.freeOutTitle") : t("billing.v3.usage.outTitle")}
            </Text>
            <Text style={styles.bannerBody}>
              {oneTime
                ? t("billing.v3.usage.freeOutBody")
                : resumesAt
                  ? t("billing.v3.usage.outBody", { date: formatReset(resumesAt, locale) })
                  : t("billing.v3.usage.outBodyNoDate")}
            </Text>
          </View>
        ) : resumesAt && credit > 0 ? (
          <View style={[styles.banner, styles.bannerPending]}>
            <Text style={styles.bannerTitle}>{t("billing.v3.usage.creditTitle")}</Text>
            <Text style={styles.bannerBody}>
              {t("billing.v3.usage.creditBody", { date: formatReset(resumesAt, locale) })}
            </Text>
          </View>
        ) : null}
      </View>
    );
  }

  function renderRenewal() {
    if (!status || !status.currentPeriodEnd) return null;
    const date = formatDate(status.currentPeriodEnd);
    if (!date) return null;
    const label = status.cancelAtPeriodEnd
      ? t("billing.mobile.accessEnds", { date })
      : t("billing.mobile.renews", { date });
    return <Text style={styles.renewal}>{label}</Text>;
  }

  function renderSuccess() {
    return (
      <View style={[styles.banner, styles.bannerSuccess]}>
        <Text style={styles.bannerTitle}>
          {t("billing.mobile.successTitle", { plan: planLabel(justSubscribedPlan) })}
        </Text>
        <Text style={styles.bannerBody}>{t("billing.mobile.successBody")}</Text>
        <Pressable
          onPress={() => {
            tapLight();
            setJustSubscribedPlan(null);
          }}
          style={styles.linkRow}
        >
          <Text style={styles.link}>{t("mobile.common.done")}</Text>
        </Pressable>
      </View>
    );
  }

  function renderManage() {
    if (eligible) {
      return (
        <>
          {checkout.error ? (
            <Text style={styles.errorText}>{checkout.error.message}</Text>
          ) : null}
          <Pressable
            onPress={() => {
              tapLight();
              void checkout.openManage();
            }}
            style={({ pressed }) => [styles.manageRow, pressed && styles.rowPressed]}
          >
            <Text style={styles.manageText}>{t("billing.mobile.manage")}</Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        </>
      );
    }
    return <Text style={styles.footnote}>{t("billing.mobile.manageWebNote")}</Text>;
  }

  function renderPurchase() {
    if (justSubscribedPlan) return null;
    if (checkoutPhase === "pending") {
      return (
        <View style={[styles.banner, styles.bannerPending]}>
          <View style={styles.pendingHeader}>
            <ActivityIndicator size="small" color={colors.text} />
            <Text style={styles.bannerTitle}>{t("billing.mobile.pendingTitle")}</Text>
          </View>
          <Text style={styles.bannerBody}>{t("billing.mobile.pendingBody")}</Text>
          <Pressable
            onPress={() => {
              tapLight();
              checkout.reset();
            }}
            style={styles.linkRow}
          >
            <Text style={styles.link}>{t("billing.mobile.pendingDismiss")}</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <>
        <Text style={styles.cardTitle}>{t("billing.mobile.chooseHeading")}</Text>
        <Text style={styles.cardSubtitle}>{t("billing.v3.usage.lede")}</Text>
        {checkoutPhase === "error" && checkout.error ? (
          <View style={[styles.banner, styles.bannerError]}>
            <Text style={styles.bannerTitle}>
              {checkout.error.code === "CONFLICT"
                ? t("billing.mobile.alreadySubscribedTitle")
                : t("errors.generic")}
            </Text>
            <Text style={styles.bannerBody}>{checkout.error.message}</Text>
            <Pressable
              onPress={() => {
                tapLight();
                checkout.reset();
              }}
              style={styles.linkRow}
            >
              <Text style={styles.link}>{t("billing.mobile.errorRetry")}</Text>
            </Pressable>
          </View>
        ) : null}
        {PAID_BILLING_PLANS.map((key) => renderPlanRow(key, { subscribe: true }))}
        <Text style={styles.footnote}>{t("billing.mobile.footnote")}</Text>
      </>
    );
  }

  function renderPlanRow(key, opts) {
    const priceText = formatAmount(PLAN_CATALOG[key].monthlyPriceCents / 100);
    const starting = checkoutPhase === "starting";
    return (
      <View key={key} style={styles.planRow}>
        <View style={styles.planInfo}>
          <Text style={styles.planName}>{planLabel(key)}</Text>
          <Text style={styles.planTagline}>{planIncludes(key, t).join(" · ")}</Text>
          <Text style={styles.planPrice}>{t("billing.mobile.perMonth", { price: priceText })}</Text>
        </View>
        {opts.subscribe ? (
          <PrimaryButton
            label={
              starting
                ? t("billing.mobile.startingCheckout")
                : t("billing.mobile.subscribe")
            }
            disabled={starting}
            onPress={() => handleSubscribe(key)}
            style={styles.planCta}
          />
        ) : null}
      </View>
    );
  }
}

const makeStyles = (colors) => ({
  section: {
    marginTop: 4,
  },
  sectionLabel: {
    color: colors.textMuted,
    fontFamily: fonts.sans.medium,
    fontSize: 13,
    letterSpacing: 0.3,
    marginBottom: 10,

  },
  card: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 12,
    paddingTop: 12,
  },
  cardTitle: {
    color: colors.text,
    fontFamily: fonts.sans.semiBold,
    fontSize: 16,
    letterSpacing: -0.2,
  },
  cardSubtitle: {
    color: colors.textMuted,
    fontFamily: fonts.sans.regular,
    fontSize: 13,
    lineHeight: 18,
    marginTop: -6,
  },
  currentPlanRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  currentPlanLabel: {
    color: colors.textMuted,
    fontFamily: fonts.sans.regular,
    fontSize: 14,
  },
  currentPlanValue: {
    marginLeft: "auto",
    color: colors.text,
    fontFamily: fonts.sans.semiBold,
    fontSize: 16,
    letterSpacing: -0.2,
  },
  renewal: {
    color: colors.textMuted,
    fontFamily: fonts.sans.regular,
    fontSize: 13,
    marginTop: -4,
  },
  usage: {
    gap: 6,
  },
  usageHead: {
    alignItems: "baseline",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  usageValue: {
    color: colors.text,
    fontFamily: fonts.sans.semiBold,
    fontSize: 16,
    fontVariant: ["tabular-nums"],
  },
  usageMuted: {
    color: colors.textMuted,
    fontFamily: fonts.sans.regular,
    fontSize: 13,
  },
  track: {
    backgroundColor: colors.border,
    borderRadius: 4,
    flexDirection: "row",
    height: 8,
    overflow: "hidden",
  },
  fill: {
    backgroundColor: colors.text,
    height: "100%",
  },
  fillFull: {
    backgroundColor: colors.danger ?? colors.text,
  },
  held: {
    backgroundColor: colors.textMuted,
    height: "100%",
    opacity: 0.5,
  },
  planRow: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    paddingTop: 12,
  },
  planInfo: {
    flex: 1,
    gap: 2,
  },
  planName: {
    color: colors.text,
    fontFamily: fonts.sans.semiBold,
    fontSize: 16,
    letterSpacing: -0.2,
  },
  planTagline: {
    color: colors.textMuted,
    fontFamily: fonts.sans.regular,
    fontSize: 13,
  },
  planPrice: {
    color: colors.text,
    fontFamily: fonts.sans.medium,
    fontSize: 14,
    marginTop: 2,
  },
  planCta: {
    minWidth: 108,
  },
  cta: {
    marginTop: 4,
  },
  manageRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  rowPressed: {
    opacity: 0.6,
  },
  manageText: {
    color: colors.text,
    fontFamily: fonts.sans.regular,
    fontSize: 15,
  },
  chevron: {
    color: colors.textMuted,
    fontSize: 20,
  },
  chevronOpen: {
    transform: [{ rotate: "90deg" }],
  },
  banner: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 4,
    paddingTop: 12,
  },
  bannerSuccess: {},
  bannerPending: {},
  bannerError: {},
  pendingHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  bannerTitle: {
    color: colors.text,
    fontFamily: fonts.sans.semiBold,
    fontSize: 15,
  },
  bannerBody: {
    color: colors.textMuted,
    fontFamily: fonts.sans.regular,
    fontSize: 13,
    lineHeight: 18,
  },
  errorText: {
    color: colors.danger ?? colors.text,
    fontFamily: fonts.sans.regular,
    fontSize: 13,
  },
  linkRow: {
    paddingVertical: 4,
  },
  link: {
    color: colors.accent ?? colors.text,
    fontFamily: fonts.sans.medium,
    fontSize: 14,
  },
  footnote: {
    color: colors.textMuted,
    fontFamily: fonts.sans.regular,
    fontSize: 12,
    lineHeight: 16,
  },
});
