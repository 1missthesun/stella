/**
 * What a reply card opens: the message or task it points at and the replies
 * that follow from it, in the same centred popover files open in. The chain
 * is measured before the popover shows, so it opens at its final size.
 */
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ReplyRef } from "@stella/contracts/reply-refs";
import type { ChatMessage } from "../types";
import type { Colors } from "../theme/colors";
import { fonts } from "../theme/fonts";
import {
  mobileReplyContexts,
  mobileReplyLineage,
  type MobileReplyContexts,
} from "../lib/mobile-reply-context";
import { FileViewerFooter, FileViewerPanel } from "./FileViewerPanel";
import { replyTitle } from "./ReplyPreview";

export type AgentReplyRef = Extract<ReplyRef, { kind: "agent" }>;

const FOOTER_FALLBACK_HEIGHT = 49;

export function ReplyViewer({
  root,
  bottomReserve,
  messages,
  colors,
  onClose,
  renderMessage,
  onLoadOlder,
  hasOlder,
}: {
  root: ReplyRef;
  bottomReserve: number;
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
  const scrollRef = useRef<ScrollView>(null);
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const [footerHeight, setFooterHeight] = useState(FOOTER_FALLBACK_HEIGHT);
  const measuredRef = useRef(false);
  const onContentSizeChange = useCallback((_width: number, height: number) => {
    if (height <= 0) return;
    if (!measuredRef.current) {
      measuredRef.current = true;
      scrollRef.current?.scrollToEnd({ animated: false });
    }
    setContentHeight((current) =>
      current !== null && Math.abs(current - height) < 1 ? current : height,
    );
  }, []);
  return (
    <FileViewerPanel
      onClose={onClose}
      closeLabel="Close"
      bottomReserve={bottomReserve}
      preferredHeight={contentHeight === null ? null : contentHeight + footerHeight}
      ready={contentHeight !== null}
    >
      <View style={styles.root}>
        <ScrollView
          ref={scrollRef}
          style={styles.body}
          contentContainerStyle={styles.content}
          onContentSizeChange={onContentSizeChange}
        >
          {hasOlder ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => onLoadOlder?.()}
              style={styles.loadOlder}
            >
              <Text style={styles.loadOlderText}>Load earlier messages</Text>
            </Pressable>
          ) : null}
          {lineage.map((message) => (
            <View key={message.id} style={styles.row}>
              {renderMessage(message, contexts)}
            </View>
          ))}
        </ScrollView>
        <View
          onLayout={(event) => {
            const next = Math.ceil(event.nativeEvent.layout.height);
            if (next > 0) setFooterHeight(next);
          }}
        >
          <FileViewerFooter
            name={replyTitle(root)}
            actions={[]}
            onClose={onClose}
            closeLabel="Close"
          />
        </View>
      </View>
    </FileViewerPanel>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    root: { flex: 1 },
    body: { flex: 1 },
    content: { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 0 },
    row: { marginBottom: 14 },
    loadOlder: { padding: 12, alignSelf: "center" },
    loadOlderText: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 12.5,
    },
  });
