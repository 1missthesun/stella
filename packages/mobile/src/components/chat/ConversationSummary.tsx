/**
 * "Summary": the pill above the composer once a busy stretch has gone by
 * (`catchUpOffer`, shared with desktop), and the popover it opens. Opening it
 * asks the cloud for a summary of what is new (`catchUps.request`); every
 * summary so far stays in the popover as its own page, newest at the bottom,
 * paged through up and down. A line's links jump to the messages it came
 * from. Desktop's twin is `features/catch-up/CatchUpPill.tsx`.
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
  type LayoutChangeEvent,
} from "react-native";
import type { CatchUp, CatchUpItem, CatchUpLink } from "@stella/contracts/backend/catch-ups";
import { CATCH_UP_MIN_NEW_MESSAGES, catchUpOffer } from "@stella/contracts/catch-up";
import { useLocale, useT } from "../../i18n";
import { getBackendClient, useBackendView } from "../../lib/backend";
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

const formatTime = (locale: string, at: number): string =>
  new Date(at).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });

const SECTION_ICONS: Record<"done" | "ongoing" | "waiting", IconName> = {
  done: "check",
  ongoing: "circle-dot",
  waiting: "alert-circle",
};

function Section({
  kind,
  items,
  onJump,
  styles,
  colors,
}: {
  kind: "done" | "ongoing" | "waiting";
  items: CatchUpItem[];
  onJump: (link: CatchUpLink) => void;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  const t = useT();
  const locale = useLocale();
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
      {items.map((item, index) => (
        <View key={index} style={styles.item}>
          <Text style={styles.itemText} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
            {item.text}
          </Text>
          {item.links.length > 0 ? (
            <View style={styles.links}>
              {item.links.map((link) => (
                <Pressable
                  key={link.seq}
                  accessibilityRole="link"
                  testID="summary-link"
                  hitSlop={4}
                  onPress={() => onJump(link)}
                  style={({ pressed }) => [styles.link, pressed && styles.linkPressed]}
                >
                  <Text style={styles.linkText} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
                    {link.role === "user" ? t("app.chat.catchUp.you") : t("app.chat.catchUp.stella")}
                    {" · "}
                    {formatTime(locale, link.at)}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function SummaryPage({
  catchUp,
  index,
  total,
  minHeight,
  onJump,
  onRetry,
  onLayout,
  styles,
  colors,
}: {
  catchUp: CatchUp;
  index: number;
  total: number;
  minHeight: number;
  onJump: (link: CatchUpLink) => void;
  onRetry: () => void;
  onLayout: (event: LayoutChangeEvent) => void;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  const t = useT();
  const locale = useLocale();
  const empty =
    catchUp.done.length === 0 && catchUp.ongoing.length === 0 && catchUp.waiting.length === 0;
  return (
    <View
      style={[styles.page, { minHeight }, index > 0 && styles.pageDivider]}
      onLayout={onLayout}
      testID="summary-page"
    >
      <View style={styles.pageHead}>
        <Text style={styles.pageWhen} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
          {formatWhen(locale, catchUp.createdAt)}
        </Text>
        {total > 1 ? (
          <Text style={styles.pageCount} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
            {index + 1}/{total}
          </Text>
        ) : null}
      </View>
      {catchUp.state === "pending" ? (
        <Text style={styles.status} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
          {t("app.chat.catchUp.loading")}
        </Text>
      ) : catchUp.state === "failed" ? (
        <View style={styles.failed}>
          <Text style={styles.status} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
            {t("app.chat.catchUp.failed")}
          </Text>
          {index === total - 1 ? (
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
          <Section kind="waiting" items={catchUp.waiting} onJump={onJump} styles={styles} colors={colors} />
          <Section kind="ongoing" items={catchUp.ongoing} onJump={onJump} styles={styles} colors={colors} />
          <Section kind="done" items={catchUp.done} onJump={onJump} styles={styles} colors={colors} />
        </View>
      )}
    </View>
  );
}

/**
 * The saved summaries, one page per summary snapping into place, oldest at
 * the top. Opens on the newest and follows a new one as it lands.
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
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { height: screenHeight } = useWindowDimensions();
  const height = Math.min(MAX_HEIGHT, Math.round(screenHeight * MAX_HEIGHT_RATIO));
  const [viewport, setViewport] = useState(height);
  const [pageHeights, setPageHeights] = useState<Record<string, number>>({});
  const scrollRef = useRef<ScrollView | null>(null);
  const requestedRef = useRef(false);

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

  // Snap points: each page's top, and for a page taller than the viewport
  // its bottom too, so a long one can still be read to the end.
  const snapOffsets = useMemo(() => {
    const offsets: number[] = [];
    let top = 0;
    for (const catchUp of catchUps) {
      const pageHeight = pageHeights[catchUp.catchUpId] ?? viewport;
      offsets.push(top);
      if (pageHeight > viewport + 1) offsets.push(top + pageHeight - viewport);
      top += pageHeight;
    }
    return offsets;
  }, [catchUps, pageHeights, viewport]);

  // Open on the newest page's first line, and follow a new page as it lands
  // or fills in (once every page above it has been measured).
  const newest = catchUps.at(-1);
  const newestKey = newest ? `${newest.catchUpId}:${newest.state}` : "";
  const newestTop = useMemo(() => {
    let top = 0;
    for (const catchUp of catchUps.slice(0, -1)) {
      const pageHeight = pageHeights[catchUp.catchUpId];
      if (pageHeight === undefined) return null;
      top += pageHeight;
    }
    return top;
  }, [catchUps, pageHeights]);
  const shownKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (newestTop === null || shownKeyRef.current === newestKey) return;
    const animated = shownKeyRef.current !== null;
    shownKeyRef.current = newestKey;
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: newestTop, animated }));
  }, [newestKey, newestTop]);

  return (
    <FloatingPopover
      onClose={onClose}
      closeLabel={t("app.chat.catchUp.close")}
      height={height}
    >
      {(close) => (
        <ScrollView
          ref={scrollRef}
          testID="summary-pages"
          style={styles.pages}
          onLayout={(event) => setViewport(Math.round(event.nativeEvent.layout.height))}
          snapToOffsets={snapOffsets}
          snapToEnd={false}
          decelerationRate="fast"
          showsVerticalScrollIndicator={false}
        >
          {catchUps.map((catchUp, index) => (
            <SummaryPage
              key={catchUp.catchUpId}
              catchUp={catchUp}
              index={index}
              total={catchUps.length}
              minHeight={viewport}
              onJump={(link) => {
                // Hand the link over first: the popover may close at once.
                onJump(link);
                close();
              }}
              onRetry={() => void request()}
              onLayout={(event) => {
                const next = Math.round(event.nativeEvent.layout.height);
                setPageHeights((previous) =>
                  previous[catchUp.catchUpId] === next
                    ? previous
                    : { ...previous, [catchUp.catchUpId]: next },
                );
              }}
              styles={styles}
              colors={colors}
            />
          ))}
        </ScrollView>
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
    pages: { flex: 1 },
    page: { paddingBottom: 16, paddingHorizontal: 18, paddingTop: 16 },
    pageDivider: {
      borderTopColor: fadeHex(colors.border, 0.7),
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    pageHead: { alignItems: "baseline", flexDirection: "row", gap: 8, marginBottom: 12 },
    pageWhen: {
      color: colors.text,
      flex: 1,
      fontFamily: fonts.sans.semiBold,
      fontSize: 15,
    },
    pageCount: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 12,
      fontVariant: ["tabular-nums"],
    },
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
    sections: { gap: 16 },
    section: { gap: 8 },
    sectionHead: { alignItems: "center", flexDirection: "row", gap: 6 },
    sectionTitle: { fontFamily: fonts.sans.semiBold, fontSize: 11, letterSpacing: 0.4 },
    item: { gap: 4 },
    itemText: {
      color: colors.text,
      fontFamily: fonts.sans.regular,
      fontSize: 15,
      lineHeight: 21,
    },
    links: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    link: {
      backgroundColor: fadeHex(colors.text, 0.07),
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    linkPressed: { backgroundColor: fadeHex(colors.text, 0.14) },
    linkText: { color: colors.textMuted, fontFamily: fonts.sans.medium, fontSize: 12 },
  } as const);
