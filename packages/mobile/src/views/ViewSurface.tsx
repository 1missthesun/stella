import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ViewTheme } from "@stella/views/protocol";
import type { ViewSession, ViewSnapshot } from "@stella/views/session";
import { Text } from "../components/Text";
import { useT } from "../i18n";
import { selectionTick } from "../lib/haptics";
import { fonts } from "../theme/fonts";
import { useColors, useTheme } from "../theme/theme-context";
import type { Colors } from "../theme/colors";
import { viewsAvailable } from "./native-vm";
import { closeViewFullScreen, openViewFullScreen, useFullScreenView, useIsLiveView, useNewestView, useViewSession } from "./view-host";
import { ViewIcon } from "./ViewIcon";
import { ViewRoot } from "./ViewRenderer";
import { mix } from "./view-style";

/** How tall a view's chat card grows before it scrolls. */
const CARD_MAX_H = 460;
const CARD_PAD = 16;

function useViewTheme(): ViewTheme {
  const colors = useColors();
  const { isDark } = useTheme();
  return useMemo(() => ({ dark: isDark, accent: colors.accent, platform: Platform.OS === "android" ? "android" : "ios" }), [isDark, colors.accent]);
}

function ProblemStrip({ message, onRestart, colors }: { message: string; onRestart: () => void; colors: Colors }) {
  const t = useT();
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: mix(colors.danger, 8, colors.background), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: mix(colors.danger, 30, colors.background) }} accessibilityRole="alert">
      <Text style={{ flex: 1, fontFamily: fonts.mono.regular, fontSize: 12, lineHeight: 18, color: colors.text }} numberOfLines={6} selectable>
        {message}
      </Text>
      <Pressable onPress={onRestart} hitSlop={8} accessibilityRole="button" accessibilityLabel={t("common.tryAgain")} style={{ padding: 2 }}>
        <ViewIcon name="rotate-ccw" size={16} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}

function FirstProblem({ message, onRestart, colors }: { message: string; onRestart: () => void; colors: Colors }) {
  const t = useT();
  return (
    <View style={{ padding: 20, gap: 12, alignItems: "flex-start" }}>
      <Text style={{ fontFamily: fonts.mono.regular, fontSize: 12, lineHeight: 18, color: colors.text }} selectable numberOfLines={10}>
        {message}
      </Text>
      <Pressable onPress={onRestart} accessibilityRole="button" style={({ pressed }) => ({ paddingHorizontal: 14, height: 34, borderRadius: 17, justifyContent: "center", backgroundColor: mix(colors.text, pressed ? 12 : 7, colors.background) })}>
        <Text style={{ fontFamily: fonts.sans.semiBold, fontSize: 14, color: colors.text }}>{t("common.tryAgain")}</Text>
      </Pressable>
    </View>
  );
}

/** Draws a running view's latest tree, keeping it with an error strip when the program fails. */
function ViewBody({ session, snapshot, colors, dark, covered, scroll, onArea }: { session: ViewSession | null; snapshot: ViewSnapshot | null; colors: Colors; dark: boolean; covered: boolean; scroll: "card" | "fill"; onArea: (w: number, h: number) => void }) {
  const dispatch = useCallback((handler: number, value?: unknown) => session?.dispatch(handler, value), [session]);
  const restart = useCallback(() => void session?.restart(), [session]);
  const problem = snapshot?.problem ?? null;
  if (!snapshot?.tree) {
    if (problem) return <FirstProblem message={problem.message} onRestart={restart} colors={colors} />;
    return (
      <View style={{ height: scroll === "card" ? 120 : undefined, flex: scroll === "fill" ? 1 : undefined, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.textMuted} />
      </View>
    );
  }
  const layout = (e: LayoutChangeEvent) => onArea(e.nativeEvent.layout.width, e.nativeEvent.layout.height);
  return (
    <>
      <ScrollView
        style={scroll === "card" ? { maxHeight: CARD_MAX_H } : { flex: 1 }}
        contentContainerStyle={{ padding: CARD_PAD, ...(scroll === "fill" ? { flexGrow: 1 } : {}) }}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        onLayout={layout}
      >
        <ViewRoot tree={snapshot.tree} dispatch={dispatch} colors={colors} dark={dark} modals={!covered} />
      </ScrollView>
      {problem ? <ProblemStrip message={problem.message} onRestart={restart} colors={colors} /> : null}
    </>
  );
}

/** A view live in a chat reply: the newest reply that made or changed it. */
export function ViewChatCard({ slug, title }: { slug: string; title: string }) {
  const t = useT();
  const colors = useColors();
  const theme = useViewTheme();
  const open = useFullScreenView();
  const covered = open === slug;
  const { session, snapshot } = useViewSession(slug, theme);
  const area = useRef<{ w: number; h: number } | null>(null);
  const report = useCallback(
    (w: number, h: number) => {
      area.current = { w, h };
      if (!covered) session?.setViewport(Math.round(w - CARD_PAD * 2), CARD_MAX_H - CARD_PAD * 2);
    },
    [session, covered],
  );
  useEffect(() => {
    if (!covered && area.current) report(area.current.w, area.current.h);
  }, [covered, report]);
  if (!viewsAvailable()) return <ViewChip slug={slug} title={title} />;
  return (
    <View style={{ alignSelf: "stretch", borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.background, overflow: "hidden" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 16, paddingRight: 8, minHeight: 42, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
        <Text style={{ flex: 1, fontFamily: fonts.sans.semiBold, fontSize: 14, color: colors.text }} numberOfLines={1}>
          {title}
        </Text>
        <Pressable
          onPress={() => {
            selectionTick();
            openViewFullScreen(slug);
          }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t("shell.display.media.expand")}
          style={({ pressed }) => ({ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? mix(colors.text, 8, colors.background) : "transparent" })}
        >
          <ViewIcon name="maximize-2" size={16} color={colors.textMuted} />
        </Pressable>
      </View>
      <ViewBody session={session} snapshot={snapshot} colors={colors} dark={theme.dark} covered={covered} scroll="card" onArea={report} />
    </View>
  );
}

/** An older reply's view: a chip that opens the view's newest version full screen. */
export function ViewChip({ slug, title }: { slug: string; title: string }) {
  const colors = useColors();
  const available = viewsAvailable();
  return (
    <Pressable
      disabled={!available}
      onPress={() => openViewFullScreen(slug)}
      accessibilityRole="button"
      style={({ pressed }) => ({ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, height: 36, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: pressed ? mix(colors.text, 6, colors.background) : colors.background })}
    >
      <ViewIcon name="layout-panel-top" size={15} color={colors.textMuted} />
      <Text style={{ fontFamily: fonts.sans.medium, fontSize: 14, color: colors.text, maxWidth: 240 }} numberOfLines={1}>
        {title}
      </Text>
    </Pressable>
  );
}

function FullScreenFrame({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const t = useT();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: Platform.OS === "ios" ? 8 : insets.top }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 20, paddingRight: 12, minHeight: 48 }}>
        <Text style={{ flex: 1, fontFamily: fonts.sans.semiBold, fontSize: 17, color: colors.text }} numberOfLines={1}>
          {title}
        </Text>
        <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel={t("common.close")} style={({ pressed }) => ({ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: mix(colors.text, pressed ? 12 : 7, colors.background) })}>
          <ViewIcon name="x" size={16} color={colors.textMuted} />
        </Pressable>
      </View>
      <View style={{ flex: 1, paddingBottom: insets.bottom }}>{children}</View>
    </View>
  );
}

function FullScreenBody({ slug }: { slug: string }) {
  const colors = useColors();
  const theme = useViewTheme();
  const { session, snapshot } = useViewSession(slug, theme);
  const report = useCallback((w: number, h: number) => session?.setViewport(Math.round(w - CARD_PAD * 2), Math.round(h - CARD_PAD * 2)), [session]);
  return <ViewBody session={session} snapshot={snapshot} colors={colors} dark={theme.dark} covered={false} scroll="fill" onArea={report} />;
}

/** The open view, full screen over the chat; mounted once beside the chat list. */
export function ViewFullScreenHost() {
  const slug = useFullScreenView();
  const ref = useNewestView(slug);
  const visible = slug !== null && ref !== null;
  return (
    <Modal visible={visible} animationType="slide" presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"} onRequestClose={closeViewFullScreen}>
      {visible ? (
        <FullScreenFrame title={ref.title} onClose={closeViewFullScreen}>
          <FullScreenBody slug={slug} />
        </FullScreenFrame>
      ) : null}
    </Modal>
  );
}

/** A view a reply made or changed: live when this is the newest such reply, a chip otherwise. */
export function ChatMessageView({ slug, title, messageId }: { slug: string; title: string; messageId: string }) {
  const live = useIsLiveView(slug, messageId);
  return live ? <ViewChatCard slug={slug} title={title} /> : <ViewChip slug={slug} title={title} />;
}
