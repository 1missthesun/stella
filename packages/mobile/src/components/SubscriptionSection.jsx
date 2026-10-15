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
  PLAN_CATALOG,
  PLAN_ORDER,
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

// Whole percent for display: never 0% once anything is used, never 100% until it's all used.
function usedPercent(used, limit) {
  if (!(limit > 0) || !(used > 0)) return 0;
  if (used >= limit) return 100;
  return Math.min(99, Math.max(1, Math.floor((used / limit) * 100)));
}

const RECOMMENDED_PLAN = "pro";

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
  if (!def.interval) return [t("billing.v3.includes.voice"), t("billing.v3.includes.byok")];
  return def.mediaGeneration ? [t("billing.v3.includes.media")] : [];
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

  // Only the billing status gates the section. Until the storefront is
  // known the plans show without purchase buttons, never a missing section.
  if (status === undefined) {
    return null;
  }

  if (!signedIn) return null;

  return (
    <View style={styles.section}>
      {header}
      <View style={styles.card}>
        {/* Current plan */}
        <View style={styles.currentPlanRow}>
          <Text style={styles.currentPlanLabel}>
            {t("billing.mobile.currentPlanLabel")}
          </Text>
          <Text style={styles.currentPlanValue}>
            {t("billing.mobile.planValue", { plan: planLabel(plan) })}
          </Text>
        </View>
        {isPaid ? renderRenewal() : null}
        {renderUsage()}

        {justSubscribedPlan ? renderSuccess() : null}

        {renderPurchase()}
        {isPaid ? renderManage() : null}
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
    const limit = oneTime ? usage.lifetimeLimitUsd : usage.monthlyLimitUsd;
    const used = Math.min(limit, oneTime ? usage.lifetimeUsedUsd : usage.monthlyUsedUsd);
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
            {t("billing.v3.usage.percentUsed", { percent: `${usedPercent(used, limit)}%` })}
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
    if (storefront.status === "loading") return null;
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
        <View style={styles.plansHead}>
          <Text style={styles.plansHeading}>{t("billing.v3.plan.heading")}</Text>
          <Text style={styles.plansLede}>{t("billing.v3.plan.lede")}</Text>
        </View>
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
        {PLAN_ORDER.map((key) => renderPlanRow(key))}
        {!isPaid && eligible ? <Text style={styles.footnote}>{t("billing.mobile.footnote")}</Text> : null}
      </>
    );
  }

  function renderPlanRow(key) {
    const def = PLAN_CATALOG[key];
    const starting = checkoutPhase === "starting";
    const isCurrent = key === plan;
    const recommended = key === RECOMMENDED_PLAN;
    const rank = (id) => PLAN_ORDER.indexOf(id);
    const suggested =
      rank(plan) < rank(RECOMMENDED_PLAN) ? RECOMMENDED_PLAN : PLAN_ORDER[rank(plan) + 1] ?? null;
    const subscribe = eligible && !isPaid && !isCurrent && isPaidBillingPlan(key);
    const change = eligible && isPaid && !isCurrent;
    const primary = (subscribe || change) && key === suggested;
    const actionLabel = subscribe
      ? starting
        ? t("billing.mobile.startingCheckout")
        : t("billing.v3.plan.get", { plan: planLabel(key) })
      : rank(key) > rank(plan)
        ? t("billing.v3.usage.upgradeTo", { plan: planLabel(key) })
        : t("billing.v3.plan.switchTo", { plan: planLabel(key) });
    const onAction = () => {
      if (subscribe) {
        handleSubscribe(key);
        return;
      }
      tapLight();
      void checkout.openManage();
    };
    return (
      <View key={key} style={[styles.planRow, isCurrent && styles.planRowCurrent]}>
        <View style={styles.planTop}>
          <View style={styles.planInfo}>
            {isCurrent || recommended ? (
              <Text style={styles.planFlag}>
                {isCurrent ? t("billing.v3.plan.currentPlan") : t("billing.v3.plan.recommended")}
              </Text>
            ) : null}
            <Text style={styles.planName}>{planLabel(key)}</Text>
            <Text style={styles.planTagline}>{t(`billing.v3.tagline.${key}`)}</Text>
          </View>
          <View style={styles.planPriceBox}>
            <Text style={[styles.planAmount, recommended && styles.planAmountAccent]}>
              {formatAmount(def.monthlyPriceCents / 100)}
            </Text>
            <Text style={styles.planPer}>
              {def.interval ? t("billing.v3.plan.month") : t("billing.v3.plan.noCard")}
            </Text>
          </View>
        </View>
        <Text style={styles.planFeatures}>{planIncludes(key, t).join(" · ")}</Text>
        {subscribe || change ? (
          primary ? (
            <PrimaryButton label={actionLabel} disabled={starting} onPress={onAction} style={styles.planCta} />
          ) : (
            <Pressable
              accessibilityRole="button"
              disabled={starting}
              onPress={onAction}
              style={({ pressed }) => [styles.planGhost, pressed && styles.rowPressed]}
            >
              <Text style={styles.planGhostText}>{actionLabel}</Text>
            </Pressable>
          )
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
    color: colors.text,
    fontFamily: fonts.sans.semiBold,
    fontSize: 20,
    letterSpacing: -0.4,
    marginBottom: 8,
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
    fontSize: 18,
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
  plansHead: {
    alignItems: "center",
    gap: 4,
    paddingTop: 12,
  },
  plansHeading: {
    color: colors.text,
    fontFamily: fonts.sans.semiBold,
    fontSize: 24,
    letterSpacing: -0.5,
    textAlign: "center",
  },
  plansLede: {
    color: colors.textMuted,
    fontFamily: fonts.sans.regular,
    fontSize: 14,
    lineHeight: 19,
    textAlign: "center",
  },
  planRow: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 10,
    paddingHorizontal: 4,
    paddingVertical: 14,
  },
  planRowCurrent: {
    borderTopColor: colors.accent,
    borderTopWidth: 2,
  },
  planTop: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
  },
  planInfo: {
    flex: 1,
    gap: 2,
  },
  planFlag: {
    color: colors.accent,
    fontFamily: fonts.sans.semiBold,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  planName: {
    color: colors.text,
    fontFamily: fonts.sans.semiBold,
    fontSize: 20,
    letterSpacing: -0.4,
  },
  planTagline: {
    color: colors.textMuted,
    fontFamily: fonts.sans.regular,
    fontSize: 14,
  },
  planPriceBox: {
    alignItems: "flex-end",
  },
  planAmount: {
    color: colors.text,
    fontFamily: fonts.sans.semiBold,
    fontSize: 30,
    fontVariant: ["tabular-nums"],
    letterSpacing: -1,
  },
  planAmountAccent: {
    color: colors.accent,
  },
  planPer: {
    color: colors.textMuted,
    fontFamily: fonts.sans.regular,
    fontSize: 12,
  },
  planFeatures: {
    color: colors.textMuted,
    fontFamily: fonts.sans.regular,
    fontSize: 13,
    lineHeight: 18,
  },
  planCta: {
    alignSelf: "stretch",
  },
  planGhost: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: 22,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
  },
  planGhostText: {
    color: colors.text,
    fontFamily: fonts.sans.semiBold,
    fontSize: 15,
    letterSpacing: -0.3,
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
