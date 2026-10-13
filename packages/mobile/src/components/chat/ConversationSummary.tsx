/**
 * "Summary": the pill above the composer once a busy stretch has gone by
 * (`catchUpOffer`, shared with desktop), and the popover it opens. Opening it
 * asks the cloud for a summary of what is new (`catchUps.request`); every
 * summary so far stays in the popover as its own page, oldest on the left and
 * newest on the right, paged sideways. Tapping a line jumps to the message it
 * came from. Desktop's twin is `features/catch-up/CatchUpPill.tsx`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import type { CatchUp, CatchUpItem, CatchUpLink } from "@stella/contracts/backend/catch-ups";
import { CATCH_UP_MIN_NEW_MESSAGES, catchUpOffer, catchUpRows } from "@stella/contracts/catch-up";
import { useLocale, useT } from "../../i18n";
import { getBackendClient, useBackendView } from "../../lib/backend";
import { useHoldDrawer } from "../../lib/drawer";
import { tapLight } from "../../lib/haptics";
import { CONTENT_MAX_FONT_SCALE } from "../../lib/setup-text-defaults";
import type { Colors } from "../../theme/colors";
import { fonts } from "../../theme/fonts";
import { fadeHex } from "../../theme/oklch";
import type { ChatMessage } from "../../types";
import { FloatingPopover } from "../FloatingPopover";
import { GlassSurface } from "../glass";
import { Icon, type IconName } from "../Icon";

const MAX_HEIGHT_RATIO = 0.66;
const MAX_HEIGHT = 560;

/** The catch-ups of a conversation and whether one is worth offering now. */
export function useConversationSummaries(
  conversationId: string | null,
  messages: readonly ChatMessage[],
  enabled: boolean,
) {
  const view = useBackendView(
    "catchUps.list",
    enabled && conversationId ? { conversationId } : "skip",
  );
  const catchUps = useMemo(() => view.value?.catchUps ?? [], [view.value]);
  const offerInput = useMemo(
    () =>
      messages.flatMap((message) =>
        message.text.trim()
          ? [{ role: message.role, at: message.canonicalCreatedAt ?? message.createdAt ?? 0 }]
          : [],
      ),
    [messages],
  );
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => setNow(Date.now()), [catchUps]);
  const offer = useMemo(
    () => catchUpOffer(offerInput, catchUps, now),
    [catchUps, now, offerInput],
  );
  // The pill lingers after a summary lands; take it down when that ends.
  useEffect(() => {
    if (!offer.lingerUntil) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, offer.lingerUntil - Date.now()) + 50,
    );
    return () => clearTimeout(timer);
  }, [offer.lingerUntil]);
  const pending = catchUps.some((catchUp) => catchUp.state === "pending");
  /** Whether the pill shows: a busy stretch, one being written, or a fresh one to reread. */
  const visible = offer.offer || pending || offer.lingerUntil > 0;
  return { catchUps, offer, pending, visible };
}

/** The pill that leads the composer. */
export function SummaryPill({
  count,
  onPress,
  colors,
}: {
  count: number;
  onPress: () => void;
  colors: Colors;
}) {
  const t = useT();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        count >= CATCH_UP_MIN_NEW_MESSAGES
          ? t("app.chat.catchUp.pillLabel", { count })
          : t("app.chat.catchUp.title")
      }
      testID="summary-pill"
      hitSlop={6}
      onPress={() => {
        tapLight();
        onPress();
      }}
      style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
    >
      <GlassSurface
        glass="regular"
        legible
        radius={15}
        fallbackColor={colors.surface}
        style={styles.pillGlass}
      >
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.pillRing]} />
        <View style={styles.pillRow}>
          <Icon name="checklist" size={14} color={colors.textMuted} />
          <Text style={styles.pillText} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
            {t("app.chat.catchUp.pill")}
          </Text>
          {count >= CATCH_UP_MIN_NEW_MESSAGES ? (
            <View style={styles.pillCount}>
              <Text style={styles.pillCountText} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
                {count}
              </Text>
            </View>
          ) : null}
        </View>
      </GlassSurface>
    </Pressable>
  );
}

const formatWhen = (locale: string, at: number): string =>
  new Date(at).toLocaleString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** A separator's time: the day too when it is not the summary's own day. */
const formatGap = (locale: string, at: number, pageAt: number): string =>
  new Date(at).toLocaleTimeString(
    locale,
    new Date(at).toDateString() === new Date(pageAt).toDateString()
      ? { hour: "numeric", minute: "2-digit" }
      : { weekday: "short", hour: "numeric", minute: "2-digit" },
  );

const SECTION_ICONS: Record<"done" | "ongoing" | "waiting", IconName> = {
  done: "check",
  ongoing: "circle-dot",
  waiting: "alert-circle",
};

/** The date row and pager above the pages. */
const HEAD_HEIGHT = 46;

function Section({
  kind,
  items,
  pageAt,
  onJump,
  styles,
  colors,
}: {
  kind: "done" | "ongoing" | "waiting";
  items: CatchUpItem[];
  pageAt: number;
  onJump: (link: CatchUpLink) => void;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  const t = useT();
  const locale = useLocale();
  const rows = useMemo(() => catchUpRows(items), [items]);
  if (items.length === 0) return null;
  const tint = kind === "waiting" ? colors.accent : colors.textMuted;
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Icon name={SECTION_ICONS[kind]} size={12} color={tint} />
        <Text style={[styles.sectionTitle, { color: tint }]} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
          {t(`app.chat.catchUp.${kind}`).toUpperCase()}
        </Text>
      </View>
      {rows.map((row, index) => {
        if (row.kind === "time") {
          return (
            <Text
              key={`time-${index}`}
              style={styles.time}
              importantForAccessibility="no"
              accessibilityElementsHidden
              maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
            >
              {formatGap(locale, row.at, pageAt)}
            </Text>
          );
        }
        const link = row.item.links[0];
        const text = (
          <Text style={styles.itemText} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
            {row.item.text}
          </Text>
        );
        return link ? (
          <Pressable
            key={index}
            accessibilityRole="link"
            testID="summary-link"
            onPress={() => onJump(link)}
            style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
          >
            {text}
          </Pressable>
        ) : (
          <View key={index} style={styles.item}>
            {text}
          </View>
        );
      })}
    </View>
  );
}

function SummaryPage({
  catchUp,
  newest,
  width,
  maxHeight,
  onJump,
  onRetry,
  styles,
  colors,
}: {
  catchUp: CatchUp;
  newest: boolean;
  width: number;
  maxHeight: number;
  onJump: (link: CatchUpLink) => void;
  onRetry: () => void;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  const t = useT();
  const empty =
    catchUp.done.length === 0 && catchUp.ongoing.length === 0 && catchUp.waiting.length === 0;
  return (
    <ScrollView
      // A ScrollView shrinks by default; in the pager's row each page must
      // stay exactly one pager wide or paging lands between pages.
      style={{ width, maxHeight, flexGrow: 0, flexShrink: 0 }}
      contentContainerStyle={styles.page}
      showsVerticalScrollIndicator={false}
      nestedScrollEnabled
      testID="summary-page"
    >
      {catchUp.state === "pending" ? (
        <Text style={styles.status} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
          {t("app.chat.catchUp.loading")}
        </Text>
      ) : catchUp.state === "failed" ? (
        <View style={styles.failed}>
          <Text style={styles.status} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
            {t("app.chat.catchUp.failed")}
          </Text>
          {newest ? (
            <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retry}>
              <Text style={styles.retryText}>{t("app.chat.catchUp.retry")}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : empty ? (
        <Text style={styles.status} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
          {t("app.chat.catchUp.empty")}
        </Text>
      ) : (
        <View style={styles.sections}>
          <Section kind="waiting" items={catchUp.waiting} pageAt={catchUp.createdAt} onJump={onJump} styles={styles} colors={colors} />
          <Section kind="ongoing" items={catchUp.ongoing} pageAt={catchUp.createdAt} onJump={onJump} styles={styles} colors={colors} />
          <Section kind="done" items={catchUp.done} pageAt={catchUp.createdAt} onJump={onJump} styles={styles} colors={colors} />
        </View>
      )}
    </ScrollView>
  );
}

/**
 * The saved summaries side by side, one page each, oldest on the left: swipe
 * or tap the arrows to page. Opens on the newest and follows a new one as it
 * lands. No close button: a tap outside closes it.
 */
export function SummaryPopover({
  conversationId,
  catchUps,
  requestNew,
  onJump,
  onClose,
  colors,
}: {
  conversationId: string;
  catchUps: readonly CatchUp[];
  /** Ask for a summary of what is new as the popover opens. */
  requestNew: boolean;
  onJump: (link: CatchUpLink) => void;
  onClose: () => void;
  colors: Colors;
}) {
  const t = useT();
  const locale = useLocale();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { height: screenHeight } = useWindowDimensions();
  const maxHeight = Math.min(MAX_HEIGHT, Math.round(screenHeight * MAX_HEIGHT_RATIO));
  const [pageWidth, setPageWidth] = useState(0);
  const [index, setIndex] = useState(Math.max(0, catchUps.length - 1));
  const scrollRef = useRef<ScrollView | null>(null);
  const requestedRef = useRef(false);
  const total = catchUps.length;
  const shown = Math.min(index, Math.max(0, total - 1));
  // A sideways swipe here pages the summaries, never the sidebar.
  useHoldDrawer(true);

  const request = useCallback(async () => {
    try {
      await getBackendClient().call("catchUps.request", { conversationId });
    } catch (error) {
      Alert.alert(
        t("app.chat.catchUp.failed"),
        error instanceof Error ? error.message : undefined,
      );
    }
  }, [conversationId, t]);

  useEffect(() => {
    if (!requestNew || requestedRef.current) return;
    requestedRef.current = true;
    void request();
  }, [request, requestNew]);

  const goTo = useCallback(
    (next: number, animated = true) => {
      const target = Math.max(0, Math.min(next, total - 1));
      setIndex(target);
      if (pageWidth > 0) scrollRef.current?.scrollTo({ x: target * pageWidth, animated });
    },
    [pageWidth, total],
  );

  // Open on the newest page, and follow a new one as it lands or fills in.
  const newest = catchUps.at(-1);
  const newestKey = newest ? `${newest.catchUpId}:${newest.state}` : "";
  const shownKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (pageWidth === 0 || !newestKey || shownKeyRef.current === newestKey) return;
    const animated = shownKeyRef.current !== null;
    shownKeyRef.current = newestKey;
    requestAnimationFrame(() => goTo(total - 1, animated));
  }, [goTo, newestKey, pageWidth, total]);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (pageWidth === 0) return;
      offsetRef.current = event.nativeEvent.contentOffset.x;
      const next = Math.round(event.nativeEvent.contentOffset.x / pageWidth);
      setIndex((current) => (current === next ? current : next));
    },
    [pageWidth],
  );

  // Land on a whole page however the swipe ended: the popover's host has
  // been seen to leave a paged scroller resting between two pages.
  const offsetRef = useRef(0);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleAt = useCallback(
    (x: number) => {
      if (pageWidth === 0) return;
      const target = Math.max(0, Math.min(Math.round(x / pageWidth), total - 1));
      setIndex(target);
      if (Math.abs(x - target * pageWidth) > 1) {
        scrollRef.current?.scrollTo({ x: target * pageWidth, animated: true });
      }
    },
    [pageWidth, total],
  );
  const onDragEnd = useCallback(() => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => settleAt(offsetRef.current), 450);
  }, [settleAt]);
  const onMomentumEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      settleAt(event.nativeEvent.contentOffset.x);
    },
    [settleAt],
  );
  useEffect(
    () => () => {
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    },
    [],
  );

  const current = catchUps[shown];
  return (
    <FloatingPopover
      onClose={onClose}
      closeLabel={t("app.chat.catchUp.close")}
      maxHeight={maxHeight}
      footer={false}
    >
      {(close) => (
        <View
          style={styles.root}
          onLayout={(event) => setPageWidth(Math.round(event.nativeEvent.layout.width))}
        >
          <View style={styles.head}>
            <Text style={styles.when} numberOfLines={1} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
              {current ? formatWhen(locale, current.createdAt) : t("app.chat.catchUp.title")}
            </Text>
            {total > 1 ? (
              <View style={styles.pager}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("common.previous")}
                  accessibilityState={{ disabled: shown === 0 }}
                  disabled={shown === 0}
                  hitSlop={6}
                  onPress={() => goTo(shown - 1)}
                  style={({ pressed }) => [styles.nav, pressed && styles.navPressed]}
                  testID="summary-previous"
                >
                  <Icon
                    name="chevron-left"
                    size={18}
                    color={shown === 0 ? fadeHex(colors.textMuted, 0.4) : colors.text}
                  />
                </Pressable>
                <Text style={styles.progress} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
                  {t("userAsk.question.progress", { current: shown + 1, total })}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("common.next")}
                  accessibilityState={{ disabled: shown === total - 1 }}
                  disabled={shown === total - 1}
                  hitSlop={6}
                  onPress={() => goTo(shown + 1)}
                  style={({ pressed }) => [styles.nav, pressed && styles.navPressed]}
                  testID="summary-next"
                >
                  <Icon
                    name="chevron-right"
                    size={18}
                    color={shown === total - 1 ? fadeHex(colors.textMuted, 0.4) : colors.text}
                  />
                </Pressable>
              </View>
            ) : null}
          </View>
          {pageWidth > 0 ? (
            <ScrollView
              ref={scrollRef}
              horizontal
              pagingEnabled
              snapToInterval={pageWidth}
              snapToAlignment="start"
              decelerationRate="fast"
              disableIntervalMomentum
              directionalLockEnabled
              showsHorizontalScrollIndicator={false}
              onScroll={onScroll}
              onScrollEndDrag={onDragEnd}
              onMomentumScrollEnd={onMomentumEnd}
              scrollEventThrottle={32}
              contentOffset={{ x: shown * pageWidth, y: 0 }}
              style={[styles.pages, { width: pageWidth }]}
              contentContainerStyle={[styles.pagesRow, { width: pageWidth * total }]}
              testID="summary-pages"
            >
              {catchUps.map((catchUp, pageIndex) => (
                <SummaryPage
                  key={catchUp.catchUpId}
                  catchUp={catchUp}
                  newest={pageIndex === total - 1}
                  width={pageWidth}
                  maxHeight={maxHeight - HEAD_HEIGHT}
                  onJump={(link) => {
                    // Hand the link over first: the popover may close at once.
                    onJump(link);
                    close();
                  }}
                  onRetry={() => void request()}
                  styles={styles}
                  colors={colors}
                />
              ))}
            </ScrollView>
          ) : null}
        </View>
      )}
    </FloatingPopover>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    pill: {
      alignSelf: "flex-start",
      marginBottom: 6,
      marginLeft: 16,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 5,
      elevation: 2,
    },
    pressed: { opacity: 0.85 },
    pillGlass: {
      alignItems: "center",
      borderRadius: 15,
      height: 30,
      justifyContent: "center",
      overflow: "hidden",
      paddingLeft: 10,
      paddingRight: 8,
    },
    pillRing: {
      borderColor: fadeHex(colors.border, 0.6),
      borderRadius: 15,
      borderWidth: StyleSheet.hairlineWidth,
    },
    pillRow: { alignItems: "center", flexDirection: "row", gap: 6 },
    pillText: {
      color: colors.text,
      fontFamily: fonts.sans.medium,
      fontSize: 13,
    },
    pillCount: {
      alignItems: "center",
      backgroundColor: fadeHex(colors.accent, 0.18),
      borderRadius: 9,
      height: 18,
      justifyContent: "center",
      minWidth: 18,
      paddingHorizontal: 5,
    },
    pillCountText: {
      color: colors.text,
      fontFamily: fonts.sans.semiBold,
      fontSize: 11,
      fontVariant: ["tabular-nums"],
    },
    root: { alignSelf: "stretch", flexShrink: 1 },
    head: {
      alignItems: "center",
      flexDirection: "row",
      gap: 8,
      height: HEAD_HEIGHT,
      paddingLeft: 18,
      paddingRight: 10,
      paddingTop: 6,
    },
    when: {
      color: colors.text,
      flex: 1,
      fontFamily: fonts.sans.semiBold,
      fontSize: 15,
    },
    pager: { alignItems: "center", flexDirection: "row", gap: 2 },
    nav: {
      alignItems: "center",
      borderRadius: 16,
      height: 32,
      justifyContent: "center",
      width: 32,
    },
    navPressed: { backgroundColor: fadeHex(colors.text, 0.08) },
    progress: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 13,
      fontVariant: ["tabular-nums"],
      minWidth: 44,
      textAlign: "center",
    },
    pages: { flexGrow: 0, flexShrink: 1 },
    pagesRow: { alignItems: "flex-start", flexDirection: "row" },
    page: { paddingBottom: 14, paddingHorizontal: 18, paddingTop: 6 },
    status: { color: colors.textMuted, fontFamily: fonts.sans.regular, fontSize: 15 },
    failed: { alignItems: "flex-start", gap: 10 },
    retry: {
      borderColor: colors.border,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    retryText: { color: colors.text, fontFamily: fonts.sans.medium, fontSize: 14 },
    sections: { gap: 14 },
    section: { gap: 2 },
    sectionHead: { alignItems: "center", flexDirection: "row", gap: 6, marginBottom: 2 },
    sectionTitle: { fontFamily: fonts.sans.semiBold, fontSize: 11, letterSpacing: 0.4 },
    item: {
      borderRadius: 8,
      marginHorizontal: -6,
      paddingHorizontal: 6,
      paddingVertical: 3,
    },
    itemPressed: { backgroundColor: fadeHex(colors.text, 0.08) },
    itemText: {
      color: colors.text,
      fontFamily: fonts.sans.regular,
      fontSize: 15,
      lineHeight: 21,
    },
    time: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 11,
      fontVariant: ["tabular-nums"],
      paddingBottom: 1,
      paddingTop: 4,
      textAlign: "center",
    },
  } as const);
