/**
 * Focus (lineage) overlay — iMessage's thread view for the single chat,
 * matching desktop's `ConversationFocusOverlay`.
 *
 * The selected chain sits above the dimmed, blurred timeline in the same
 * chat column; the composer stays available below it. Three ways out: the
 * close button, a tap on the backdrop outside the chain, or the hardware
 * back gesture. Task descriptions open their full report in a separate popover.
 */
import { LegendList } from "@legendapp/list/react-native";
import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { ReplyRef } from "@stella/contracts/reply-refs";
import type { ChatMessage } from "../types";
import type { Colors } from "../theme/colors";
import { fonts } from "../theme/fonts";
import {
  mobileReplyContexts,
  mobileReplyLineage,
  type MobileReplyContexts,
} from "../lib/mobile-reply-context";
import { GlassSurface } from "./glass";
import { fadeHex } from "../theme/oklch";
import { Icon } from "./Icon";


export type AgentReplyRef = Extract<ReplyRef, { kind: "agent" }>;

export function ReplyFocus({
  root,
  topInset = 0,
  bottomInset,
  messages,
  colors,
  onClose,
  renderMessage,
  onLoadOlder,
  hasOlder,
}: {
  root: ReplyRef;
  /** Room the chrome above takes; the focused chain starts below it. */
  topInset?: number;
  bottomInset: number;
  messages: readonly ChatMessage[];
  colors: Colors;
  onClose: () => void;
  renderMessage: (
    message: ChatMessage,
    contexts: MobileReplyContexts,
  ) => ReactNode;
  onLoadOlder?: () => unknown;
  hasOlder?: boolean;
}) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const lineage = useMemo(
    () => mobileReplyLineage(messages, root),
    [messages, root],
  );
  const contexts = useMemo(() => mobileReplyContexts(lineage), [lineage]);
  useEffect(() => {
    const handler = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => handler.remove();
  }, [onClose]);
  const [listSize, setListSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [listReady, setListReady] = useState(false);
  return (
    <View
      style={[styles.root, { top: topInset, bottom: bottomInset }]}
      accessibilityViewIsModal
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close focused conversation"
        onPress={onClose}
        style={StyleSheet.absoluteFill}
      >
        <GlassSurface
          glass="regular"
          radius={0}
          tintColor={fadeHex(colors.background, 0.18)}
          fallbackColor={fadeHex(colors.background, 0.44)}
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
        />
      </Pressable>
      <View
        style={styles.panel}
        pointerEvents="box-none"
        onLayout={({ nativeEvent: { layout } }) => {
          if (layout.height > 0 && layout.width > 0) {
            setListSize((previous) =>
              previous?.width === layout.width &&
              previous?.height === layout.height
                ? previous
                : { width: layout.width, height: layout.height },
            );
          }
        }}
      >
        {/* Initialize against measured bounds; reveal only after initial end alignment. */}
        {listSize && (
          <LegendList
            style={[styles.list, !listReady && { opacity: 0 }]}
            estimatedListSize={listSize}
            estimatedItemSize={140}
            onLoad={() => setListReady(true)}
            maintainScrollAtEnd
            data={lineage}
            keyExtractor={(message) => message.id}
            renderItem={({ item }) => (
              <View style={styles.row}>{renderMessage(item, contexts)}</View>
            )}
            contentContainerStyle={styles.listContent}
            alignItemsAtEnd
            initialScrollAtEnd
            ListHeaderComponent={
              hasOlder ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onLoadOlder?.()}
                  style={styles.loadOlder}
                >
                  <Text style={styles.loadOlderText}>
                    Load earlier messages
                  </Text>
                </Pressable>
              ) : null
            }
          />
        )}
      </View>
      <View style={styles.footer} pointerEvents="box-none">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close focused conversation"
          accessibilityHint="Back to the whole conversation"
          onPress={onClose}
          style={styles.focusClose}
        >
          <Icon name="x" size={18} color={colors.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    root: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      zIndex: 30,
    },
    footer: { alignItems: "center", paddingTop: 8, paddingBottom: 12 },
    focusClose: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.background,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    panel: { flex: 1 },
    list: { flex: 1 },
    listContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12 },
    row: { marginBottom: 14 },
    loadOlder: { padding: 12 },
    loadOlderText: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 12.5,
    },
  });
