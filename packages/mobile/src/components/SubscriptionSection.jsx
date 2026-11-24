import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { Text } from "./Text";
import { Icon } from "./Icon";
import { useBackendView } from "../lib/backend";
import {
  setDebugStorefrontOverride,
  useStorefrontEligibility,
} from "../lib/use-storefront-eligibility";
import { useMobileCheckout } from "../lib/use-mobile-checkout";
import { useColors, useTheme } from "../theme/theme-context";
import { fonts } from "../theme/fonts";
import { useLocale, useT } from "../i18n";
import {
  PLAN_CATALOG,
  PLAN_ORDER,
  isPaidBillingPlan,
  normalizeBillingPlan,
  planLabel as catalogPlanLabel,
} from "@stella/contracts/billing-plans";
import { tapLight } from "../lib/haptics";
import { settingsSurfaceFills } from "./settings/settings-styles";

function formatAmount(dollars) {
  if (typeof dollars !== "number" || !Number.isFinite(dollars)) return "";
  const value = Math.max(0, dollars);
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

function formatUsd(dollars) {
  return `$${Math.max(0, dollars || 0).toFixed(2)}`;
}

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

function deriveUsageMetrics(status, plan) {
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
  return {
    usage,
    oneTime,
    limit,
    used,
    percent,
    heldPercent,
    credit,
    blocked,
    resumesAt,
  };
}

export function SubscriptionSummaryCard({ onPress }) {
  const colors = useColors();
  const { isDark } = useTheme();
  const t = useT();
  const locale = useLocale();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const status = useBackendView("billing.status", {}).value;

  if (status === undefined) return null;
  const signedIn = Boolean(status && status.authenticated && !status.isAnonymous);
  if (!signedIn) return null;

  const plan = normalizeBillingPlan(status.plan);
  const isPaid = isPaidBillingPlan(plan);
  const metrics = deriveUsageMetrics(status, plan);
  const renewalDate = isPaid && status.currentPeriodEnd ? formatDate(status.currentPeriodEnd) : "";
  const resetText = metrics
    ? metrics.oneTime
      ? t("billing.v3.usage.oneTimeNote")
      : t("billing.v3.usage.resets", {
          date: formatReset(metrics.usage.monthlyResetsAt, locale),
        })
    : renewalDate
      ? status.cancelAtPeriodEnd
        ? t("billing.mobile.accessEnds", { date: renewalDate })
        : t("billing.mobile.renews", { date: renewalDate })
      : "";

  const planTitle = t("billing.mobile.planValue", { plan: catalogPlanLabel(plan) });
  const percentText = metrics
    ? t("billing.v3.usage.percentUsed", {
        percent: `${usedPercent(metrics.used, metrics.limit)}%`,
      })
    : "";

  return (
    <Pressable
      testID="account-subscription-row"
      onPress={() => {
        tapLight();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={
        percentText ? `${t("billing.mobile.sectionTitle")}, ${planTitle}, ${percentText}` : `${t("billing.mobile.sectionTitle")}, ${planTitle}`
      }
      style={({ pressed }) => [styles.summaryCard, pressed && styles.rowPressed]}
    >
      <View style={styles.summaryTop}>
        <Text style={styles.summaryPlan} numberOfLines={1}>
          {planTitle}
        </Text>
        <View style={styles.summaryRight}>
          {percentText ? (
            <Text style={styles.summaryPercent} numberOfLines={1}>
              {percentText}
            </Text>
          ) : null}
          <Icon name="chevron-right" size={14} color={colors.textWeaker} />
        </View>
      </View>

      {metrics ? (
        <View
          style={styles.summaryTrack}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: Math.round(metrics.percent) }}
        >
          <View
            style={[
              styles.fill,
              (metrics.percent >= 100 || metrics.blocked) && styles.fillFull,
              { width: `${metrics.percent}%` },
            ]}
          />
          {metrics.heldPercent > 0 ? (
            <View style={[styles.held, { width: `${metrics.heldPercent}%` }]} />
          ) : null}
        </View>
      ) : null}

      <View style={styles.summaryFoot}>
        {metrics && metrics.blocked ? (
          <View style={styles.statusInline}>
            <View style={[styles.statusDot, { backgroundColor: colors.danger }]} />
            <Text style={styles.summaryMetaDanger} numberOfLines={1}>
              {metrics.oneTime
                ? t("billing.v3.usage.freeOutTitle")
                : t("billing.v3.usage.outTitle")}
            </Text>
          </View>
        ) : resetText ? (
          <Text style={styles.summaryMeta} numberOfLines={1}>
            {resetText}
          </Text>
        ) : null}
        {metrics && metrics.credit > 0 ? (
          <Text style={styles.summaryMeta} numberOfLines={1}>
            {t("billing.v3.usage.credit")}: {formatUsd(metrics.credit)}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export function SubscriptionSection({ embedded = false } = {}) {
  const colors = useColors();
  const { isDark } = useTheme();
  const t = useT();
  const locale = useLocale();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

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

  if (status === undefined || !signedIn) {
    return null;
  }

  const metrics = deriveUsageMetrics(status, plan);
  const renewalDate = isPaid && status.currentPeriodEnd ? formatDate(status.currentPeriodEnd) : "";

  return (
    <View style={embedded ? styles.embeddedRoot : styles.section}>
      {!embedded ? (
        <Pressable onPress={onDebugCycle} disabled={!__DEV__}>
          <Text style={styles.sectionLabel}>{t("billing.mobile.sectionTitle")}</Text>
        </Pressable>
      ) : null}

      <View style={styles.overviewBox}>
        <Pressable
          onPress={onDebugCycle}
          disabled={!__DEV__}
          style={styles.overviewTop}
        >
          <View style={styles.overviewPlanCol}>
            <Text style={styles.overviewLabel}>
              {t("billing.mobile.currentPlanLabel")}
            </Text>
            <Text style={styles.overviewPlanValue}>
              {t("billing.mobile.planValue", { plan: catalogPlanLabel(plan) })}
            </Text>
          </View>
          {renewalDate ? (
            <Text style={styles.overviewRenewal} numberOfLines={2}>
              {status.cancelAtPeriodEnd
                ? t("billing.mobile.accessEnds", { date: renewalDate })
                : t("billing.mobile.renews", { date: renewalDate })}
            </Text>
          ) : null}
        </Pressable>

        {metrics ? (
          <View style={styles.usage}>
            <View style={styles.usageHead}>
              <Text style={styles.usageLabel}>
                {metrics.oneTime
                  ? t("billing.v3.mobile.usageOneTime")
                  : t("billing.v3.mobile.usageRow")}
              </Text>
              <Text style={styles.usageValue}>
                {t("billing.v3.usage.percentUsed", {
                  percent: `${usedPercent(metrics.used, metrics.limit)}%`,
                })}
              </Text>
            </View>
            <View
              style={styles.track}
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: 100, now: Math.round(metrics.percent) }}
            >
              <View
                style={[
                  styles.fill,
                  metrics.percent >= 100 && styles.fillFull,
                  { width: `${metrics.percent}%` },
                ]}
              />
              {metrics.heldPercent > 0 ? (
                <View style={[styles.held, { width: `${metrics.heldPercent}%` }]} />
              ) : null}
            </View>
            <View style={styles.usageFoot}>
              <Text style={styles.usageMuted}>
                {metrics.oneTime
                  ? t("billing.v3.usage.oneTimeNote")
                  : t("billing.v3.usage.resets", {
                      date: formatReset(metrics.usage.monthlyResetsAt, locale),
                    })}
              </Text>
              {metrics.credit > 0 ? (
                <Text style={styles.usageMuted}>
                  {t("billing.v3.usage.credit")}: {formatUsd(metrics.credit)}
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}

        {metrics && metrics.blocked ? (
          <View style={styles.notice}>
            <View style={styles.noticeHead}>
              <View style={[styles.statusDot, { backgroundColor: colors.danger }]} />
              <Text style={styles.noticeTitle}>
                {metrics.oneTime
                  ? t("billing.v3.usage.freeOutTitle")
                  : t("billing.v3.usage.outTitle")}
              </Text>
            </View>
            <Text style={styles.noticeBody}>
              {metrics.oneTime
                ? t("billing.v3.usage.freeOutBody")
                : metrics.resumesAt
                  ? t("billing.v3.usage.outBody", {
                      date: formatReset(metrics.resumesAt, locale),
                    })
                  : t("billing.v3.usage.outBodyNoDate")}
            </Text>
          </View>
        ) : metrics && metrics.resumesAt && metrics.credit > 0 ? (
          <View style={styles.notice}>
            <View style={styles.noticeHead}>
              <View style={[styles.statusDot, { backgroundColor: colors.accent }]} />
              <Text style={styles.noticeTitle}>{t("billing.v3.usage.creditTitle")}</Text>
            </View>
            <Text style={styles.noticeBody}>
              {t("billing.v3.usage.creditBody", {
                date: formatReset(metrics.resumesAt, locale),
              })}
            </Text>
          </View>
        ) : null}

        {justSubscribedPlan ? renderSuccess() : null}
      </View>

      {renderPurchase()}
      {isPaid ? renderManage() : null}
    </View>
  );

  function renderSuccess() {
    return (
      <View style={styles.notice}>
        <View style={styles.noticeHead}>
          <View style={[styles.statusDot, { backgroundColor: colors.ok }]} />
          <Text style={styles.noticeTitle}>
            {t("billing.mobile.successTitle", {
              plan: catalogPlanLabel(justSubscribedPlan),
            })}
          </Text>
        </View>
        <Text style={styles.noticeBody}>{t("billing.mobile.successBody")}</Text>
        <Pressable
          onPress={() => {
            tapLight();
            setJustSubscribedPlan(null);
          }}
          accessibilityRole="button"
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
        <View style={styles.manageBlock}>
          {checkout.error ? (
            <Text style={styles.errorText}>{checkout.error.message}</Text>
          ) : null}
          <Pressable
            onPress={() => {
              tapLight();
              void checkout.openManage();
            }}
            accessibilityRole="button"
            accessibilityLabel={t("billing.mobile.manage")}
            style={({ pressed }) => [styles.manageRow, pressed && styles.rowPressed]}
          >
            <Text style={styles.manageText}>{t("billing.mobile.manage")}</Text>
            <Icon name="chevron-right" size={14} color={colors.textWeaker} />
          </Pressable>
        </View>
      );
    }
    return <Text style={styles.footnote}>{t("billing.mobile.manageWebNote")}</Text>;
  }

  function renderPurchase() {
    if (justSubscribedPlan) return null;
    if (checkoutPhase === "pending") {
      return (
        <View style={styles.pendingBox}>
          <View style={styles.pendingHeader}>
            <ActivityIndicator size="small" color={colors.text} />
            <Text style={styles.noticeTitle}>{t("billing.mobile.pendingTitle")}</Text>
          </View>
          <Text style={styles.noticeBody}>{t("billing.mobile.pendingBody")}</Text>
          <Pressable
            onPress={() => {
              tapLight();
              checkout.reset();
            }}
            accessibilityRole="button"
            style={styles.linkRow}
          >
            <Text style={styles.link}>{t("billing.mobile.pendingDismiss")}</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={styles.plansSection}>
        <View style={styles.plansHead}>
          <Text style={styles.plansHeading}>{t("billing.v3.plan.heading")}</Text>
          <Text style={styles.plansLede}>{t("billing.v3.plan.lede")}</Text>
        </View>
        {checkoutPhase === "error" && checkout.error ? (
          <View style={styles.errorBox}>
            <Text style={styles.noticeTitle}>
              {checkout.error.code === "CONFLICT"
                ? t("billing.mobile.alreadySubscribedTitle")
                : t("errors.generic")}
            </Text>
            <Text style={styles.noticeBody}>{checkout.error.message}</Text>
            <Pressable
              onPress={() => {
                tapLight();
                checkout.reset();
              }}
              accessibilityRole="button"
              style={styles.linkRow}
            >
              <Text style={styles.link}>{t("billing.mobile.errorRetry")}</Text>
            </Pressable>
          </View>
        ) : null}
        <View style={styles.plansList}>
          {PLAN_ORDER.map((key, index) => renderPlanRow(key, index === 0))}
        </View>
        {!isPaid && eligible ? (
          <Text style={styles.footnote}>{t("billing.mobile.footnote")}</Text>
        ) : null}
      </View>
    );
  }

  function renderPlanRow(key, isFirst) {
    const def = PLAN_CATALOG[key];
    const starting = checkoutPhase === "starting";
    const isCurrent = key === plan;
    const recommended = key === RECOMMENDED_PLAN;
    const rank = (id) => PLAN_ORDER.indexOf(id);
    const suggested =
      rank(plan) < rank(RECOMMENDED_PLAN)
        ? RECOMMENDED_PLAN
        : (PLAN_ORDER[rank(plan) + 1] ?? null);
    const subscribe = eligible && !isPaid && !isCurrent && isPaidBillingPlan(key);
    const change = eligible && isPaid && !isCurrent;
    const primary = (subscribe || change) && key === suggested;
    const actionLabel = subscribe
      ? starting
        ? t("billing.mobile.startingCheckout")
        : t("billing.v3.plan.get", { plan: catalogPlanLabel(key) })
      : rank(key) > rank(plan)
        ? t("billing.v3.usage.upgradeTo", { plan: catalogPlanLabel(key) })
        : t("billing.v3.plan.switchTo", { plan: catalogPlanLabel(key) });
    const onAction = () => {
      if (subscribe) {
        handleSubscribe(key);
        return;
      }
      tapLight();
      void checkout.openManage();
    };
    const includes = planIncludes(key, t);
    const details = [t(`billing.v3.tagline.${key}`), ...includes].join(" · ");

    return (
      <View
        key={key}
        style={[
          styles.planRow,
          !isFirst && styles.planRowDivider,
        ]}
      >
        <View style={styles.planTop}>
          <View style={styles.planNameWrap}>
            <Text style={styles.planName}>{catalogPlanLabel(key)}</Text>
            {isCurrent ? (
              <View style={styles.planTagInline}>
                <View style={[styles.statusDot, { backgroundColor: colors.accent }]} />
                <Text style={styles.planCurrentText}>
                  {t("billing.v3.plan.currentPlan")}
                </Text>
              </View>
            ) : recommended ? (
              <Text style={styles.planRecommendedText}>
                {t("billing.v3.plan.recommended")}
              </Text>
            ) : null}
          </View>
          <View style={styles.planPriceBox}>
            <Text style={styles.planAmount}>
              {formatAmount(def.monthlyPriceCents / 100)}
            </Text>
            <Text style={styles.planPer}>
              {def.interval ? t("billing.v3.plan.month") : t("billing.v3.plan.noCard")}
            </Text>
          </View>
        </View>

        <Text style={styles.planDetails}>{details}</Text>

        {subscribe || change ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={actionLabel}
            disabled={starting}
            onPress={onAction}
            style={({ pressed }) => [
              primary ? styles.planPrimaryBtn : styles.planSecondaryBtn,
              (pressed || starting) && styles.rowPressed,
            ]}
          >
            <Text
              style={
                primary ? styles.planPrimaryBtnText : styles.planSecondaryBtnText
              }
            >
              {actionLabel}
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  }
}

const makeStyles = (colors, isDark) => {
  const { subtleFill, tonalFill } = settingsSurfaceFills(isDark);
  return StyleSheet.create({
    summaryCard: {
      backgroundColor: subtleFill,
      borderColor: colors.borderWeak,
      borderRadius: 13,
      borderWidth: StyleSheet.hairlineWidth,
      gap: 9,
      marginTop: 12,
      paddingHorizontal: 14,
      paddingVertical: 13,
    },
    summaryTop: {
      alignItems: "center",
      flexDirection: "row",
      gap: 10,
      justifyContent: "space-between",
    },
    summaryPlan: {
      color: colors.textStrong,
      flex: 1,
      fontFamily: fonts.sans.semiBold,
      fontSize: 15,
      letterSpacing: -0.25,
    },
    summaryRight: {
      alignItems: "center",
      flexDirection: "row",
      gap: 5,
    },
    summaryPercent: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 13,
      fontVariant: ["tabular-nums"],
    },
    summaryTrack: {
      backgroundColor: tonalFill,
      borderRadius: 2,
      flexDirection: "row",
      height: 4,
      overflow: "hidden",
    },
    summaryFoot: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
      justifyContent: "space-between",
    },
    summaryMeta: {
      color: colors.textWeaker,
      fontFamily: fonts.sans.regular,
      fontSize: 12,
    },
    summaryMetaDanger: {
      color: colors.danger,
      fontFamily: fonts.sans.medium,
      fontSize: 12,
    },
    statusInline: {
      alignItems: "center",
      flexDirection: "row",
      gap: 6,
    },
    statusDot: {
      borderRadius: 3,
      height: 6,
      width: 6,
    },
    section: {
      marginTop: 20,
    },
    embeddedRoot: {
      paddingTop: 10,
    },
    sectionLabel: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 12.5,
      marginBottom: 8,
    },
    overviewBox: {
      backgroundColor: subtleFill,
      borderColor: colors.borderWeak,
      borderRadius: 13,
      borderWidth: StyleSheet.hairlineWidth,
      gap: 14,
      padding: 15,
    },
    overviewTop: {
      alignItems: "flex-start",
      flexDirection: "row",
      gap: 12,
      justifyContent: "space-between",
    },
    overviewPlanCol: {
      flex: 1,
      gap: 2,
      minWidth: 0,
    },
    overviewLabel: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 12.5,
    },
    overviewPlanValue: {
      color: colors.textStrong,
      fontFamily: fonts.sans.semiBold,
      fontSize: 17,
      letterSpacing: -0.3,
    },
    overviewRenewal: {
      color: colors.textMuted,
      flexShrink: 1,
      fontFamily: fonts.sans.regular,
      fontSize: 12.5,
      marginTop: 2,
      textAlign: "right",
    },
    usage: {
      gap: 7,
    },
    usageHead: {
      alignItems: "baseline",
      flexDirection: "row",
      justifyContent: "space-between",
    },
    usageLabel: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 13,
    },
    usageValue: {
      color: colors.textStrong,
      fontFamily: fonts.sans.semiBold,
      fontSize: 14.5,
      fontVariant: ["tabular-nums"],
    },
    usageFoot: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      justifyContent: "space-between",
    },
    usageMuted: {
      color: colors.textWeaker,
      fontFamily: fonts.sans.regular,
      fontSize: 12.5,
    },
    track: {
      backgroundColor: tonalFill,
      borderRadius: 3,
      flexDirection: "row",
      height: 6,
      overflow: "hidden",
    },
    fill: {
      backgroundColor: colors.textStrong,
      height: "100%",
    },
    fillFull: {
      backgroundColor: colors.danger,
    },
    held: {
      backgroundColor: colors.textMuted,
      height: "100%",
      opacity: 0.45,
    },
    notice: {
      borderTopColor: colors.borderWeak,
      borderTopWidth: StyleSheet.hairlineWidth,
      gap: 4,
      paddingTop: 12,
    },
    noticeHead: {
      alignItems: "center",
      flexDirection: "row",
      gap: 7,
    },
    noticeTitle: {
      color: colors.textStrong,
      fontFamily: fonts.sans.semiBold,
      fontSize: 14,
    },
    noticeBody: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 13,
      lineHeight: 18.5,
    },
    pendingBox: {
      backgroundColor: subtleFill,
      borderColor: colors.borderWeak,
      borderRadius: 13,
      borderWidth: StyleSheet.hairlineWidth,
      gap: 6,
      marginTop: 16,
      padding: 15,
    },
    pendingHeader: {
      alignItems: "center",
      flexDirection: "row",
      gap: 8,
    },
    errorBox: {
      backgroundColor: subtleFill,
      borderColor: colors.borderWeak,
      borderRadius: 11,
      borderWidth: StyleSheet.hairlineWidth,
      gap: 4,
      marginBottom: 10,
      padding: 13,
    },
    plansSection: {
      marginTop: 24,
    },
    plansHead: {
      gap: 3,
      marginBottom: 12,
    },
    plansHeading: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 12.5,
    },
    plansLede: {
      color: colors.textWeaker,
      fontFamily: fonts.sans.regular,
      fontSize: 13,
      lineHeight: 18.5,
    },
    plansList: {
      borderBottomColor: colors.borderWeak,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.borderWeak,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    planRow: {
      gap: 6,
      paddingVertical: 14,
    },
    planRowDivider: {
      borderTopColor: colors.borderWeak,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    planTop: {
      alignItems: "baseline",
      flexDirection: "row",
      gap: 10,
      justifyContent: "space-between",
    },
    planNameWrap: {
      alignItems: "center",
      flex: 1,
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      minWidth: 0,
    },
    planName: {
      color: colors.textStrong,
      fontFamily: fonts.sans.semiBold,
      fontSize: 16,
      letterSpacing: -0.25,
    },
    planTagInline: {
      alignItems: "center",
      flexDirection: "row",
      gap: 5,
    },
    planCurrentText: {
      color: colors.accent,
      fontFamily: fonts.sans.medium,
      fontSize: 12,
    },
    planRecommendedText: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 12,
    },
    planPriceBox: {
      alignItems: "baseline",
      flexDirection: "row",
      gap: 3,
    },
    planAmount: {
      color: colors.textStrong,
      fontFamily: fonts.sans.semiBold,
      fontSize: 16.5,
      fontVariant: ["tabular-nums"],
      letterSpacing: -0.3,
    },
    planPer: {
      color: colors.textWeaker,
      fontFamily: fonts.sans.regular,
      fontSize: 12,
    },
    planDetails: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 13,
      lineHeight: 18.5,
    },
    planPrimaryBtn: {
      alignItems: "center",
      backgroundColor: colors.accent,
      borderRadius: 9,
      justifyContent: "center",
      marginTop: 6,
      minHeight: 38,
      paddingHorizontal: 14,
    },
    planPrimaryBtnText: {
      color: colors.accentForeground,
      fontFamily: fonts.sans.semiBold,
      fontSize: 13.5,
      letterSpacing: -0.1,
    },
    planSecondaryBtn: {
      alignItems: "center",
      backgroundColor: tonalFill,
      borderRadius: 9,
      justifyContent: "center",
      marginTop: 6,
      minHeight: 38,
      paddingHorizontal: 14,
    },
    planSecondaryBtnText: {
      color: colors.textStrong,
      fontFamily: fonts.sans.medium,
      fontSize: 13.5,
      letterSpacing: -0.1,
    },
    manageBlock: {
      marginTop: 22,
    },
    manageRow: {
      alignItems: "center",
      borderBottomColor: colors.borderWeak,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.borderWeak,
      borderTopWidth: StyleSheet.hairlineWidth,
      flexDirection: "row",
      justifyContent: "space-between",
      minHeight: 48,
      paddingVertical: 11,
    },
    manageText: {
      color: colors.textStrong,
      fontFamily: fonts.sans.medium,
      fontSize: 15,
      letterSpacing: -0.2,
    },
    rowPressed: {
      opacity: 0.6,
    },
    errorText: {
      color: colors.danger,
      fontFamily: fonts.sans.regular,
      fontSize: 13,
      marginBottom: 8,
    },
    linkRow: {
      alignSelf: "flex-start",
      paddingVertical: 4,
    },
    link: {
      color: colors.accent,
      fontFamily: fonts.sans.medium,
      fontSize: 13.5,
    },
    footnote: {
      color: colors.textWeaker,
      fontFamily: fonts.sans.regular,
      fontSize: 12.5,
      lineHeight: 18,
      marginTop: 14,
    },
  });
};
