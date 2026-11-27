// A paired computer's own chat, straight over the device link: its history, sends (queued while
// it's away), live streamed replies and attachments. A quiet banner names whose Stella this is.

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "../../src/components/Text";
import { ChatPane } from "../../src/components/ChatPane";
import { AppBackdrop, TOP_BAR_BAR_HEIGHT } from "../../src/components/AppBackdrop";
import { GlassIconButton } from "../../src/components/GlassIconButton";
import { mainContentStyles } from "../../src/components/MainScreenSurface";
import { createChatDraftStore } from "../../src/lib/chat-draft-store";
import {
  appendAttachments,
  CHAT_ATTACHMENT_MAX_COUNT,
  type ComposerAttachment,
  type PickedAttachment,
} from "../../src/lib/chat-attachments";
import { tapLight } from "../../src/lib/haptics";
import { bootDeviceLink, retryComputer, stellaP2pAvailable, useComputer } from "../../src/lib/p2p/link";
import { computerChat } from "../../src/lib/p2p/computer-chat";
import { computerChatMessages } from "../../src/lib/p2p/projection";
import { fonts } from "../../src/theme/fonts";
import { fadeHex } from "../../src/theme/oklch";
import { useColors, useTheme } from "../../src/theme/theme-context";
import { useT } from "../../src/i18n";

const TOP_BAR_INSET = 10;
const TOP_BAR_BUTTON = 40;

export default function ComputerChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!stellaP2pAvailable || typeof id !== "string" || !id) return <Redirect href="/p2p" />;
  return <ComputerChatView computerId={id} />;
}

function ComputerChatView({ computerId }: { computerId: string }) {
  const colors = useColors();
  const { isDark } = useTheme();
  const t = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const computer = useComputer(computerId);
  const chat = useMemo(() => computerChat(computerId), [computerId]);
  const state = useSyncExternalStore(chat.subscribe, chat.get, chat.get);
  const draftStore = useMemo(() => createChatDraftStore(), []);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);

  useEffect(() => {
    void bootDeviceLink().catch(() => undefined);
    return chat.open();
  }, [chat]);

  const name = computer?.name ?? "";
  const link = computer?.link.state ?? "connecting";
  const online = link === "online";
  const messages = useMemo(() => computerChatMessages(state, online), [state, online]);

  const notice = !computer
    ? null
    : link === "offline"
      ? t("devices.chat.offline", { name })
      : link === "revoked" || link === "not_paired"
        ? t("devices.chat.unpaired", { name })
        : link !== "online"
          ? t("devices.chat.connecting", { name })
          : state.cloudChats
            ? t("mobile.p2p.cloudChats", { name })
            : null;

  const onSubmit = useCallback(() => {
    const text = draftStore.get().trim();
    if (!text && attachments.length === 0) return null;
    const requestId = chat.send(
      text,
      attachments.map(({ drivePath: _drivePath, failed: _failed, ...picked }) => picked),
    );
    draftStore.set("");
    setAttachments([]);
    if (!online) retryComputer(computerId);
    return { userMessageId: `p2p:${requestId}` };
  }, [attachments, chat, computerId, draftStore, online]);

  const onAddAttachments = useCallback((picked: readonly PickedAttachment[]) => {
    let rejected = 0;
    setAttachments((current) => {
      const next = appendAttachments(
        current,
        picked.map((entry) => ({ ...entry, drivePath: "" })),
        CHAT_ATTACHMENT_MAX_COUNT,
      );
      rejected = next.rejected;
      return next.attachments;
    });
    return { rejected };
  }, []);

  const goBack = () => {
    tapLight();
    if (router.canGoBack()) router.back();
    else router.replace("/p2p");
  };

  const barHeight = insets.top + TOP_BAR_BAR_HEIGHT;
  const noticeHeight = notice ? 64 : 0;

  return (
    <View style={styles.shell}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <AppBackdrop />
      <View style={[mainContentStyles.content, { paddingTop: 0 }]}>
        <ChatPane
          conversationId={state.conversationId}
          messages={messages}
          streaming={online && state.pi.running}
          emptyContent={
            state.loaded || !online ? (
              <Text style={styles.emptyText}>{t("mobile.chat.emptyPrompt")}</Text>
            ) : null
          }
          history={{
            loading: online && !state.loaded,
            hasOlder: state.pi.hasOlder,
            pageLoading: state.loadingOlder,
            onLoadOlder: () => chat.loadOlder(),
          }}
          composer={{
            draftStore,
            enabled: !state.cloudChats && link !== "revoked" && link !== "not_paired",
            sendReady: true,
            onSubmit,
            onStop: () => void chat.stop(),
            placeholder: t("mobile.chat.composerPlaceholder"),
          }}
          attachments={{
            items: attachments,
            onAdd: onAddAttachments,
            onRemove: (attachmentId) =>
              setAttachments((current) => current.filter((entry) => entry.id !== attachmentId)),
            max: CHAT_ATTACHMENT_MAX_COUNT,
          }}
          topInset={barHeight + noticeHeight}
        />
      </View>
      <View pointerEvents="box-none" style={[styles.topBar, { height: barHeight }]}>
        <View pointerEvents="none" style={styles.titleLane}>
          <Text
            accessibilityRole="header"
            style={styles.title}
            numberOfLines={1}
            maxFontSizeMultiplier={1.3}
            testID="p2p-chat-title"
          >
            {name ? t("devices.computerChat", { name }) : ""}
          </Text>
        </View>
        <View style={styles.topBarSide}>
          <GlassIconButton
            icon="chevron-left"
            size={TOP_BAR_BUTTON}
            iconSize={20}
            accessibilityLabel={t("mobile.common.back")}
            onPress={goBack}
          />
        </View>
      </View>
      {notice ? (
        <View
          pointerEvents="none"
          style={[styles.notice, { top: barHeight + 8 }]}
          accessibilityLiveRegion="polite"
          testID="p2p-chat-notice"
        >
          <View
            style={[
              styles.noticeDot,
              { backgroundColor: link === "online" ? colors.ok : fadeHex(colors.textMuted, 0.5) },
            ]}
          />
          <Text style={styles.noticeText} numberOfLines={2}>
            {notice}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    shell: { flex: 1, backgroundColor: colors.background },
    topBar: {
      alignItems: "flex-end",
      flexDirection: "row",
      left: 0,
      paddingHorizontal: TOP_BAR_INSET,
      position: "absolute",
      right: 0,
      top: 0,
      zIndex: 1,
    },
    topBarSide: { alignItems: "center", height: 44, justifyContent: "center", width: 44 },
    titleLane: {
      alignItems: "center",
      bottom: 0,
      height: 44,
      justifyContent: "center",
      left: TOP_BAR_INSET + TOP_BAR_BUTTON + 8,
      position: "absolute",
      right: TOP_BAR_INSET + TOP_BAR_BUTTON + 8,
    },
    title: {
      color: colors.textMuted,
      fontFamily: fonts.sans.semiBold,
      fontSize: 16,
      letterSpacing: -0.3,
    },
    notice: {
      position: "absolute",
      left: 20,
      right: 20,
      zIndex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 11,
      backgroundColor: fadeHex(colors.textMuted, 0.1),
    },
    noticeDot: { width: 7, height: 7, borderRadius: 4 },
    noticeText: {
      flex: 1,
      color: colors.text,
      fontFamily: fonts.sans.regular,
      fontSize: 14,
      lineHeight: 19,
    },
    emptyText: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 16,
      textAlign: "center",
    },
  });
