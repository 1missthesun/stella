import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type PanResponderGestureState,
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
  useEffect(() => {
    if (!offer.lingerUntil) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, offer.lingerUntil - Date.now()) + 50,
    );
    return () => clearTimeout(timer);
  }, [offer.lingerUntil]);
  const pending = catchUps.some((catchUp) => catchUp.state === "pending");
  const visible = enabled && (offer.offer || pending || offer.lingerUntil > 0);
  return { catchUps, offer, pending, visible };
}

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
      <View
        style={styles.sectionHead}
        accessible
        accessibilityRole="header"
        accessibilityLabel={t(`app.chat.catchUp.${kind}`)}
      >
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
            accessibilityLabel={row.item.text}
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
  hidden,
  styles,
  colors,
}: {
  catchUp: CatchUp;
  newest: boolean;
  width: number;
  maxHeight: number;
  onJump: (link: CatchUpLink) => void;
  onRetry: () => void;
  hidden: boolean;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  const t = useT();
  const [tall, setTall] = useState(false);
  const empty =
    catchUp.done.length === 0 && catchUp.ongoing.length === 0 && catchUp.waiting.length === 0;
  const body = (
    <View
      style={styles.page}
      onLayout={(event) => {
        if (!tall && event.nativeEvent.layout.height > maxHeight + 1) setTall(true);
      }}
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
    </View>
  );
  // Each page stays exactly one pager wide (no shrinking) or paging lands
  // between pages. Only a page taller than the popover scrolls: inside the
  // iOS popover's host, a scroll view hides its lines from VoiceOver.
  const frame = { width, flexGrow: 0, flexShrink: 0 } as const;
  const a11y = {
    accessibilityElementsHidden: hidden,
    importantForAccessibility: hidden ? ("no-hide-descendants" as const) : ("auto" as const),
    testID: "summary-page",
  };
  return tall ? (
    <ScrollView
      style={[frame, { maxHeight }]}
      showsVerticalScrollIndicator={false}
      nestedScrollEnabled
      {...a11y}
    >
      {body}
    </ScrollView>
  ) : (
    <View style={frame} {...a11y}>
      {body}
    </View>
  );
}

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
  const requestedRef = useRef(false);
  const total = catchUps.length;
  const shown = Math.min(index, Math.max(0, total - 1));
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

  // The pages sit in one row that slides under a clip. Swipes are read in
  // JS (a pan responder) rather than by a native horizontal scroller: inside
  // the iOS popover's host, a native sideways scroll left the popover
  // ignoring every touch after it.
  const slide = useRef(new Animated.Value(0)).current;
  const [positioned, setPositioned] = useState(false);
  const indexRef = useRef(shown);
  indexRef.current = shown;
  const widthRef = useRef(pageWidth);
  widthRef.current = pageWidth;
  const totalRef = useRef(total);
  totalRef.current = total;

  const goTo = useCallback(
    (next: number, animated = true) => {
      const width = widthRef.current;
      if (width === 0) return;
      const target = Math.max(0, Math.min(next, totalRef.current - 1));
      indexRef.current = target;
      setIndex(target);
      slide.stopAnimation();
      if (animated) {
        Animated.spring(slide, {
          toValue: -target * width,
          useNativeDriver: true,
          speed: 22,
          bounciness: 0,
        }).start();
      } else {
        slide.setValue(-target * width);
      }
    },
    [slide],
  );

  const newest = catchUps.at(-1);
  const newestKey = newest ? `${newest.catchUpId}:${newest.state}` : "";
  const shownKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (pageWidth === 0 || !newestKey || shownKeyRef.current === newestKey) return;
    const animated = shownKeyRef.current !== null;
    shownKeyRef.current = newestKey;
    goTo(total - 1, animated);
    setPositioned(true);
  }, [goTo, newestKey, pageWidth, total]);

  const pan = useMemo(() => {
    let start = 0;
    const horizontal = (gesture: PanResponderGestureState) =>
      Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2;
    return PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_event, gesture) => horizontal(gesture),
      onMoveShouldSetPanResponder: (_event, gesture) => horizontal(gesture),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        slide.stopAnimation();
        start = -indexRef.current * widthRef.current;
      },
      onPanResponderMove: (_event, gesture) => {
        const min = -(totalRef.current - 1) * widthRef.current;
        let x = start + gesture.dx;
        if (x > 0) x = x / 3;
        else if (x < min) x = min + (x - min) / 3;
        slide.setValue(x);
      },
      onPanResponderRelease: (_event, gesture) => {
        const width = widthRef.current;
        let next = indexRef.current;
        if (gesture.dx < -width * 0.22 || gesture.vx < -0.35) next += 1;
        else if (gesture.dx > width * 0.22 || gesture.vx > 0.35) next -= 1;
        goTo(next);
      },
      onPanResponderTerminate: () => goTo(indexRef.current),
    });
  }, [goTo, slide]);

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
                  onPress={() => goTo(indexRef.current - 1)}
                  style={({ pressed }) => [styles.nav, pressed && styles.navPressed]}
                  testID="summary-previous"
                >
                  <Icon
                    name="chevron-left"
                    size={18}
                    color={shown === 0 ? fadeHex(colors.textMuted, 0.4) : colors.text}
                  />
                </Pressable>
                <View
                  // VoiceOver: swipe up or down here to change summary. On a
                  // View, not the Text: iOS hands Text's own accessibility to
                  // a copy that drops the value and the adjust gestures.
                  accessible
                  accessibilityRole="adjustable"
                  accessibilityLabel={current ? formatWhen(locale, current.createdAt) : undefined}
                  accessibilityValue={{ text: t("userAsk.question.progress", { current: shown + 1, total }) }}
                  accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
                  onAccessibilityAction={(event) => {
                    if (event.nativeEvent.actionName === "increment") goTo(indexRef.current + 1);
                    if (event.nativeEvent.actionName === "decrement") goTo(indexRef.current - 1);
                  }}
                  testID="summary-progress"
                >
                  <Text
                    style={styles.progress}
                    maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
                    importantForAccessibility="no"
                    accessibilityElementsHidden
                  >
                    {t("userAsk.question.progress", { current: shown + 1, total })}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("common.next")}
                  accessibilityState={{ disabled: shown === total - 1 }}
                  disabled={shown === total - 1}
                  hitSlop={6}
                  onPress={() => goTo(indexRef.current + 1)}
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
            <View
              style={[styles.pages, { width: pageWidth, opacity: positioned ? 1 : 0 }]}
              testID="summary-pages"
              {...pan.panHandlers}
            >
              <Animated.View
                style={[
                  styles.pagesRow,
                  { width: pageWidth * total, transform: [{ translateX: slide }] },
                ]}
              >
              {catchUps.map((catchUp, pageIndex) => (
                <SummaryPage
                  key={catchUp.catchUpId}
                  catchUp={catchUp}
                  newest={pageIndex === total - 1}
                  width={pageWidth}
                  maxHeight={maxHeight - HEAD_HEIGHT}
                  onJump={(link) => {
                    onJump(link);
                    close();
                  }}
                  onRetry={() => void request()}
                  hidden={pageIndex !== shown}
                  styles={styles}
                  colors={colors}
                />
              ))}
              </Animated.View>
            </View>
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
    pages: { flexGrow: 0, flexShrink: 1, overflow: "hidden" },
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
