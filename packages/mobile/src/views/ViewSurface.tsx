import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import type { IndexedViewSource } from "@stella/contracts/backend/view-index";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ViewTheme } from "@stella/views/protocol";
import type { ViewSession, ViewSnapshot } from "@stella/views/session";
import { Text } from "../components/Text";
import { useT } from "../i18n";
import { getBackendClient } from "../lib/backend";
import { notifyError, notifySuccess, selectionTick, tapLight } from "../lib/haptics";
import { useViewShare } from "../lib/use-view-share";
import { fonts } from "../theme/fonts";
import { useColors, useTheme } from "../theme/theme-context";
import type { Colors } from "../theme/colors";
import { NativeKeyCapture, viewsAvailable } from "./native-vm";
import { chordTable } from "./view-keys";
import { closeAppView, closeViewFullScreen, conversationViewId, openViewFullScreen, useAppView, useAppViewSession, useFullScreenView, useIsLiveView, useNewestView, useViewHistory, useViewSession, type AppViewRef } from "./view-host";
import { HeaderButton, ViewPreviewBar, ViewUndoButton, ViewVersionList } from "./ViewHistory";
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
    <KeyChords session={session} keys={snapshot.keys} autoFocus={scroll === "fill"} fill={scroll === "fill"}>
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
    </KeyChords>
  );
}

/** The view's `useKey` chords from a hardware keyboard while the view has focus (a press gives it focus; full screen takes it at once). */
function KeyChords({ session, keys, autoFocus, fill, children }: { session: ViewSession | null; keys: readonly string[]; autoFocus: boolean; fill: boolean; children: ReactNode }) {
  const table = useMemo(() => chordTable(keys), [keys]);
  const chords = useMemo(() => [...table.keys()], [table]);
  const onChord = useCallback((event: { nativeEvent: { chord: string } }) => {
    const chord = table.get(event.nativeEvent.chord);
    if (chord) session?.key(chord);
  }, [session, table]);
  if (!NativeKeyCapture) return <View style={fill ? { flex: 1 } : undefined}>{children}</View>;
  return (
    <NativeKeyCapture chords={chords} autoFocus={autoFocus && chords.length > 0} onChord={onChord} style={fill ? { flex: 1 } : undefined}>
      {children}
    </NativeKeyCapture>
  );
}

/** The full screen opens on the version list when the card's history button opened it. */
let historyOnOpen: string | null = null;
const openViewHistory = (file: string) => {
  historyOnOpen = file;
  openViewFullScreen(file);
};

/** A view live in a chat reply: the newest reply that made or changed it. */
export function ViewChatCard({ file, title }: { file: string; title: string }) {
  const t = useT();
  const colors = useColors();
  const theme = useViewTheme();
  const open = useFullScreenView();
  const covered = open === file;
  const { session, snapshot } = useViewSession(file, theme);
  const { versions, preview } = useViewHistory(file);
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
  if (!viewsAvailable()) return <ViewChip file={file} title={title} />;
  return (
    <View style={{ alignSelf: "stretch", borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.background, overflow: "hidden" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 16, paddingRight: 8, minHeight: 42, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
        <Text style={{ flex: 1, fontFamily: fonts.sans.semiBold, fontSize: 14, color: colors.text }} numberOfLines={1}>
          {title}
        </Text>
        <ViewUndoButton file={file} versions={versions} preview={preview} colors={colors} />
        {versions.length > 1 ? <HeaderButton icon="clock" label={t("shell.display.viewHistory.title")} colors={colors} active={preview !== null} onPress={() => openViewHistory(file)} /> : null}
        <Pressable
          onPress={() => {
            selectionTick();
            openViewFullScreen(file);
          }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t("shell.display.media.expand")}
          style={({ pressed }) => ({ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? mix(colors.text, 8, colors.background) : "transparent" })}
        >
          <ViewIcon name="maximize-2" size={16} color={colors.textMuted} />
        </Pressable>
      </View>
      {preview ? <ViewPreviewBar file={file} title={title} version={preview} snapshot={snapshot} colors={colors} /> : null}
      <ViewBody session={session} snapshot={snapshot} colors={colors} dark={theme.dark} covered={covered} scroll="card" onArea={report} />
    </View>
  );
}

/** An older reply's view: a chip that opens the view's newest version full screen. */
export function ViewChip({ file, title }: { file: string; title: string }) {
  const colors = useColors();
  const available = viewsAvailable();
  return (
    <Pressable
      disabled={!available}
      onPress={() => openViewFullScreen(file)}
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

/** Share in a full-screen view's header: a public stella.sh link that runs the view in any browser. */
function ViewShareAction({ viewId, title }: { viewId: string | null; title: string }) {
  const t = useT();
  const colors = useColors();
  const share = useViewShare(viewId);
  if (!share) return null;
  const send = (url: string) => void Share.share(Platform.OS === "ios" ? { url, title } : { message: url, title }).catch(() => undefined);
  const publish = async () => {
    try {
      const url = await share.publish();
      notifySuccess();
      send(url);
    } catch (error) {
      notifyError();
      Alert.alert(t("mobile.views.shareFailed"), error instanceof Error ? error.message : undefined);
    }
  };
  const onPress = () => {
    tapLight();
    if (!share.isPublic || !share.link) {
      void publish();
      return;
    }
    const url = share.link.url;
    Alert.alert(t("mobile.views.publicLinkTitle"), url, [
      { text: t("mobile.views.shareLink"), onPress: () => send(url) },
      {
        text: t("mobile.views.makePrivate"),
        style: "destructive",
        onPress: () =>
          void share.makePrivate().catch((error: unknown) => {
            notifyError();
            Alert.alert(t("mobile.views.shareFailed"), error instanceof Error ? error.message : undefined);
          }),
      },
      { text: t("common.cancel"), style: "cancel" },
    ]);
  };
  return (
    <Pressable
      onPress={onPress}
      disabled={share.busy}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={t(share.isPublic ? "mobile.views.publicLinkTitle" : "mobile.views.share")}
      accessibilityState={{ busy: share.busy }}
      testID="view-share"
      style={({ pressed }) => ({ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? mix(colors.text, 8, colors.background) : "transparent" })}
    >
      {share.busy ? <ActivityIndicator size="small" color={colors.textMuted} /> : <ViewIcon name={share.isPublic ? "globe" : "share"} size={16} color={share.isPublic ? colors.accent : colors.textMuted} />}
    </Pressable>
  );
}

function FullScreenFrame({ title, onClose, actions, children }: { title: string; onClose: () => void; actions?: ReactNode; children: ReactNode }) {
  const t = useT();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: Platform.OS === "ios" ? 8 : insets.top }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 20, paddingRight: 12, minHeight: 48 }}>
        <Text style={{ flex: 1, fontFamily: fonts.sans.semiBold, fontSize: 17, color: colors.text }} numberOfLines={1}>
          {title}
        </Text>
        {actions}
        <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel={t("common.close")} style={({ pressed }) => ({ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: mix(colors.text, pressed ? 12 : 7, colors.background) })}>
          <ViewIcon name="x" size={16} color={colors.textMuted} />
        </Pressable>
      </View>
      <View style={{ flex: 1, paddingBottom: insets.bottom }}>{children}</View>
    </View>
  );
}

function FullScreenBody({ file, title, viewId }: { file: string; title: string; viewId: string | null }) {
  const t = useT();
  const colors = useColors();
  const theme = useViewTheme();
  const { session, snapshot } = useViewSession(file, theme);
  const { versions, preview } = useViewHistory(file);
  const [listing, setListing] = useState(() => {
    const open = historyOnOpen === file;
    historyOnOpen = null;
    return open;
  });
  const report = useCallback((w: number, h: number) => session?.setViewport(Math.round(w - CARD_PAD * 2), Math.round(h - CARD_PAD * 2)), [session]);
  const actions = (
    <>
      {listing ? null : <ViewUndoButton file={file} versions={versions} preview={preview} colors={colors} />}
      {versions.length > 1 ? <HeaderButton icon="clock" label={t("shell.display.viewHistory.title")} colors={colors} active={listing || preview !== null} onPress={() => setListing((on) => !on)} /> : null}
      <ViewShareAction viewId={viewId} title={title} />
    </>
  );
  return (
    <FullScreenFrame title={title} actions={actions} onClose={closeViewFullScreen}>
      {listing ? (
        <ViewVersionList file={file} versions={versions} preview={preview} colors={colors} onChosen={() => setListing(false)} />
      ) : (
        <>
          {preview ? <ViewPreviewBar file={file} title={title} version={preview} snapshot={snapshot} colors={colors} /> : null}
          <ViewBody session={session} snapshot={snapshot} colors={colors} dark={theme.dark} covered={false} scroll="fill" onArea={report} />
        </>
      )}
    </FullScreenFrame>
  );
}

/** The open view, full screen over the chat; mounted once beside the chat list. */
export function ViewFullScreenHost() {
  const file = useFullScreenView();
  const ref = useNewestView(file);
  const visible = file !== null && ref !== null;
  return (
    <Modal visible={visible} animationType="slide" presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"} onRequestClose={closeViewFullScreen}>
      {visible ? <FullScreenBody key={file} file={file} title={ref.title} viewId={conversationViewId(ref)} /> : null}
    </Modal>
  );
}

/** A view a reply made or changed: live when this is the newest such reply, a chip otherwise. */
export function ChatMessageView({ file, title, messageId }: { file: string; title: string; messageId: string }) {
  const live = useIsLiveView(file, messageId);
  return live ? <ViewChatCard file={file} title={title} /> : <ViewChip file={file} title={title} />;
}

// ------------------------------------------------------------------ apps

const appViewRef = (view: IndexedViewSource): AppViewRef => ({
  id: view.id,
  conversationId: view.conversationId,
  filePath: view.filePath,
  slug: view.slug,
  title: view.title,
  source: view.source,
  ...(view.data !== undefined ? { data: view.data } : {}),
  createdAt: view.updatedAt,
  toolCallId: `app:${view.id}:${view.version}`,
});

/** The newest version of a view in the account's index, live: a newer one swaps in while it's open. */
function useIndexedView(id: string | null): { view: AppViewRef | null; missing: boolean } {
  const [state, setState] = useState<{ id: string | null; view: AppViewRef | null; missing: boolean }>({ id: null, view: null, missing: false });
  useEffect(() => {
    if (!id) return;
    try {
      return getBackendClient().watch(
        "viewIndex.get",
        { id },
        (value) => setState((prior) => ({ id, view: value ? (prior.id === id && prior.view?.source === value.source && prior.view?.createdAt === value.updatedAt ? prior.view : appViewRef(value)) : null, missing: !value })),
        () => setState((prior) => ({ ...prior, id, missing: prior.view === null })),
      );
    } catch {
      setState({ id, view: null, missing: true });
      return undefined;
    }
  }, [id]);
  return state.id === id ? { view: state.view, missing: state.missing } : { view: null, missing: false };
}

function AppViewBody({ view }: { view: AppViewRef }) {
  const colors = useColors();
  const theme = useViewTheme();
  const { session, snapshot } = useAppViewSession(view, theme);
  const report = useCallback((w: number, h: number) => session?.setViewport(Math.round(w - CARD_PAD * 2), Math.round(h - CARD_PAD * 2)), [session]);
  return <ViewBody session={session} snapshot={snapshot} colors={colors} dark={theme.dark} covered={false} scroll="fill" onArea={report} />;
}

/** A view opened from Apps, full screen and live outside its chat; mounted once on the Apps page. */
export function AppViewHost() {
  const t = useT();
  const colors = useColors();
  const open = useAppView();
  const { view, missing } = useIndexedView(open?.id ?? null);
  const title = view?.title ?? open?.title ?? "";
  return (
    <Modal visible={open !== null} animationType="slide" presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"} onRequestClose={closeAppView}>
      {open ? (
        <FullScreenFrame title={title} onClose={closeAppView} actions={<ViewShareAction viewId={open.id} title={title} />}>
          {view && viewsAvailable() ? (
            <AppViewBody view={view} />
          ) : missing || view ? (
            <Text style={{ padding: 20, fontFamily: fonts.sans.regular, fontSize: 15, color: colors.textMuted }}>{t("mobile.views.missing")}</Text>
          ) : (
            <ActivityIndicator color={colors.textMuted} style={{ marginTop: 32 }} />
          )}
        </FullScreenFrame>
      ) : null}
    </Modal>
  );
}
