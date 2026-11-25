import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { Text } from "./Text";
import { Icon } from "./Icon";
import {
  Dot,
  Hairline,
  PrimaryButton as KitPrimaryButton,
  SectionLabel,
  TextAction,
} from "./chat-settings/kit";
import { useBackendView } from "../lib/backend";
import {
  setDebugStorefrontOverride,
  useStorefrontEligibility,
} from "../lib/use-storefront-eligibility";
import { useMobileCheckout } from "../lib/use-mobile-checkout";
import { useColors, useTheme } from "../theme/theme-context";
import { fonts } from "../theme/fonts";
import { fadeHex } from "../theme/oklch";
import { CONTENT_MAX_FONT_SCALE } from "../lib/font-scale";
import { useLocale, useT } from "../i18n";
import {
  PLAN_CATALOG,
  PLAN_ORDER,
  isPaidBillingPlan,
  normalizeBillingPlan,
  planLabel as catalogPlanLabel,
} from "@stella/contracts/billing-plans";
import { tapLight } from "../lib/haptics";

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
  const metaLine = [
    percentText,
    resetText,
    metrics && metrics.credit > 0
      ? `${t("billing.v3.usage.credit")}: ${formatUsd(metrics.credit)}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <View>
      <SectionLabel>{t("billing.mobile.sectionTitle")}</SectionLabel>
      <Pressable
        testID="account-subscription-row"
        onPress={() => {
          tapLight();
          onPress();
        }}
        accessibilityRole="button"
        accessibilityLabel={
          percentText
            ? `${t("billing.mobile.sectionTitle")}, ${planTitle}, ${percentText}`
            : `${t("billing.mobile.sectionTitle")}, ${planTitle}`
        }
        style={({ pressed }) => [styles.heroRow, pressed && styles.rowPressed]}
      >
        <View style={styles.heroHead}>
          <Text
            style={styles.heroPlan}
            numberOfLines={1}
            maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
          >
            {planTitle}
          </Text>
          <Icon
            name="chevron-right"
            size={15}
            color={colors.textMuted}
            weight="semibold"
          />
        </View>

        {metrics ? (
          <View
            style={styles.heroTrack}
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

        {metrics && metrics.blocked ? (
          <View style={styles.statusInline}>
            <View style={[styles.statusDot, { backgroundColor: colors.danger }]} />
            <Text style={styles.heroMetaDanger} numberOfLines={1}>
              {metrics.oneTime
                ? t("billing.v3.usage.freeOutTitle")
                : t("billing.v3.usage.outTitle")}
            </Text>
          </View>
        ) : metaLine ? (
          <Text style={styles.heroMeta} numberOfLines={2}>
            {metaLine}
          </Text>
        ) : null}
      </Pressable>
    </View>
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
          <SectionLabel>{t("billing.mobile.sectionTitle")}</SectionLabel>
        </Pressable>
      ) : null}

      <View style={styles.overview}>
        <Pressable onPress={onDebugCycle} disabled={!__DEV__}>
          <SectionLabel>{t("billing.mobile.currentPlanLabel")}</SectionLabel>
          <Text style={styles.overviewPlanValue}>
            {t("billing.mobile.planValue", { plan: catalogPlanLabel(plan) })}
          </Text>
          {renewalDate ? (
            <Text style={styles.overviewRenewal}>
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
              <Dot size={6} />
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

      <Hairline space={22} />
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
        <TextAction
          label={t("mobile.common.done")}
          onPress={() => {
            tapLight();
            setJustSubscribedPlan(null);
          }}
        />
      </View>
    );
  }

  function renderManage() {
    if (storefront.status === "loading") return null;
    if (eligible) {
      return (
        <View>
          <Hairline space={20} />
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
            <Icon name="chevron-right" size={15} color={colors.textMuted} weight="semibold" />
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
        <View style={styles.notice}>
          <View style={styles.pendingHeader}>
            <ActivityIndicator size="small" color={colors.text} />
            <Text style={styles.noticeTitle}>{t("billing.mobile.pendingTitle")}</Text>
          </View>
          <Text style={styles.noticeBody}>{t("billing.mobile.pendingBody")}</Text>
          <TextAction
            label={t("billing.mobile.pendingDismiss")}
            tone="muted"
            onPress={() => {
              tapLight();
              checkout.reset();
            }}
          />
        </View>
      );
    }
    return (
      <View>
        <SectionLabel>{t("billing.v3.plan.heading")}</SectionLabel>
        <Text style={styles.plansLede}>{t("billing.v3.plan.lede")}</Text>

        {checkoutPhase === "error" && checkout.error ? (
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>
              {checkout.error.code === "CONFLICT"
                ? t("billing.mobile.alreadySubscribedTitle")
                : t("errors.generic")}
            </Text>
            <Text style={styles.noticeBody}>{checkout.error.message}</Text>
            <TextAction
              label={t("billing.mobile.errorRetry")}
              onPress={() => {
                tapLight();
                checkout.reset();
              }}
            />
          </View>
        ) : null}

        <View style={styles.plansList}>
          {PLAN_ORDER.map((key) => renderPlanRow(key))}
        </View>

        {!isPaid && eligible ? (
          <Text style={styles.footnote}>{t("billing.mobile.footnote")}</Text>
        ) : null}
      </View>
    );
  }

  function renderPlanRow(key) {
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
      <View key={key} style={styles.planRow}>
        <View style={styles.planTop}>
          <View style={styles.planNameWrap}>
            <Text style={styles.planName}>{catalogPlanLabel(key)}</Text>
            {isCurrent ? (
              <View style={styles.planTagInline}>
                <Dot size={6} />
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
          primary ? (
            <View style={styles.planActionWrap}>
              <KitPrimaryButton
                label={actionLabel}
                disabled={starting}
                onPress={onAction}
              />
            </View>
          ) : (
            <View style={styles.planActionWrap}>
              <TextAction
                label={actionLabel}
                disabled={starting}
                onPress={onAction}
              />
            </View>
          )
        ) : null}
      </View>
    );
  }
}

const makeStyles = (colors, isDark) => {
  const trackBg = fadeHex(colors.text, isDark ? 0.14 : 0.09);
  return StyleSheet.create({
    heroRow: {
      gap: 8,
      paddingVertical: 4,
    },
    heroHead: {
      alignItems: "center",
      flexDirection: "row",
      gap: 10,
      justifyContent: "space-between",
    },
    heroPlan: {
      color: colors.text,
      flex: 1,
      fontFamily: fonts.sans.bold,
      fontSize: 28,
      letterSpacing: -1,
      lineHeight: 34,
    },
    heroTrack: {
      backgroundColor: trackBg,
      borderRadius: 2,
      flexDirection: "row",
      height: 4,
      overflow: "hidden",
    },
    heroMeta: {
      color: colors.textMuted,
      fontFamily: fonts.sans.semiBold,
      fontSize: 14,
      fontVariant: ["tabular-nums"],
      lineHeight: 19,
    },
    heroMetaDanger: {
      color: colors.danger,
      fontFamily: fonts.sans.semiBold,
      fontSize: 14,
    },
    statusInline: {
      alignItems: "center",
      flexDirection: "row",
      gap: 7,
    },
    statusDot: {
      borderRadius: 3,
      height: 6,
      width: 6,
    },
    section: {
      marginTop: 22,
    },
    embeddedRoot: {
      paddingTop: 2,
    },
    overview: {
      gap: 16,
    },
    overviewPlanValue: {
      color: colors.text,
      fontFamily: fonts.sans.bold,
      fontSize: 28,
      letterSpacing: -1,
      lineHeight: 34,
      marginTop: 2,
    },
    overviewRenewal: {
      color: colors.textMuted,
      fontFamily: fonts.sans.semiBold,
      fontSize: 14,
      marginTop: 3,
    },
    usage: {
      gap: 8,
    },
    usageHead: {
      alignItems: "baseline",
      flexDirection: "row",
      justifyContent: "space-between",
    },
    usageLabel: {
      color: colors.textMuted,
      fontFamily: fonts.sans.semiBold,
      fontSize: 15,
    },
    usageValue: {
      color: colors.text,
      fontFamily: fonts.sans.semiBold,
      fontSize: 16,
      fontVariant: ["tabular-nums"],
    },
    usageFoot: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
      justifyContent: "space-between",
    },
    usageMuted: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 13.5,
    },
    track: {
      backgroundColor: trackBg,
      borderRadius: 2.5,
      flexDirection: "row",
      height: 5,
      overflow: "hidden",
    },
    fill: {
      backgroundColor: colors.text,
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
      gap: 6,
      marginTop: 4,
    },
    noticeHead: {
      alignItems: "center",
      flexDirection: "row",
      gap: 8,
    },
    noticeTitle: {
      color: colors.text,
      fontFamily: fonts.sans.semiBold,
      fontSize: 16,
    },
    noticeBody: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 14,
      lineHeight: 20,
    },
    pendingHeader: {
      alignItems: "center",
      flexDirection: "row",
      gap: 8,
    },
    plansLede: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 14,
      lineHeight: 20,
      marginTop: 2,
    },
    plansList: {
      gap: 24,
      marginTop: 20,
    },
    planRow: {
      gap: 6,
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
      color: colors.text,
      fontFamily: fonts.sans.bold,
      fontSize: 22,
      letterSpacing: -0.6,
    },
    planTagInline: {
      alignItems: "center",
      flexDirection: "row",
      gap: 6,
    },
    planCurrentText: {
      color: colors.accent,
      fontFamily: fonts.sans.semiBold,
      fontSize: 13.5,
    },
    planRecommendedText: {
      color: colors.textMuted,
      fontFamily: fonts.sans.semiBold,
      fontSize: 13.5,
    },
    planPriceBox: {
      alignItems: "baseline",
      flexDirection: "row",
      gap: 4,
    },
    planAmount: {
      color: colors.text,
      fontFamily: fonts.sans.bold,
      fontSize: 20,
      fontVariant: ["tabular-nums"],
      letterSpacing: -0.5,
    },
    planPer: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 13,
    },
    planDetails: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 14,
      lineHeight: 20,
    },
    planActionWrap: {
      marginTop: 8,
    },
    manageRow: {
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "space-between",
      minHeight: 50,
    },
    manageText: {
      color: colors.text,
      fontFamily: fonts.sans.semiBold,
      fontSize: 19,
      letterSpacing: -0.4,
    },
    rowPressed: {
      opacity: 0.55,
      transform: [{ scale: 0.985 }],
    },
    errorText: {
      color: colors.danger,
      fontFamily: fonts.sans.medium,
      fontSize: 14,
      marginBottom: 8,
    },
    footnote: {
      color: colors.textWeaker,
      fontFamily: fonts.sans.medium,
      fontSize: 13.5,
      lineHeight: 19,
      marginTop: 22,
    },
  });
};
