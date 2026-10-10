import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { mixSrgb, parseColorOr, toHex, type Rgba } from "@stella/theme";
import type { Colors } from "../theme/colors";
import { fonts } from "../theme/fonts";
import { getBackendClient } from "../lib/backend";
import { AssistantMarkdown } from "./AssistantMarkdown";
import { GlassIconButton } from "./GlassIconButton";
import { replyTitle } from "./ReplyPreview";
import type { AgentReplyRef } from "./ReplyFocus";

export type ReportAnchor = { x: number; y: number };

export type AgentReportPopoverProps = {
  reference: AgentReplyRef;
  conversationId: string;
  colors: Colors;
  /** The report as the conversation recorded it, when the backend has none. */
  journalReport?: string;
  /** Window point of the tap that opened the report; the popover points at it. */
  anchor: ReportAnchor | null;
  onClose: () => void;
  /** Room the chrome above takes; a panel without an anchor opens below it. */
  topInset?: number;
};

export const REPORT_SIDE_MARGIN = 18;
export const REPORT_MAX_WIDTH = 560;
export const REPORT_MAX_HEIGHT_RATIO = 0.62;

type ReportThread = {
  resultJson?: string;
  errorMessage?: string;
  status: string;
} | null;

type ReportLookup =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "loaded"; text: string; running: boolean };

const threadReportText = (thread: ReportThread): string => {
  if (thread?.resultJson) {
    try {
      const parsed: unknown = JSON.parse(thread.resultJson);
      if (
        parsed &&
        typeof parsed === "object" &&
        "finalText" in parsed &&
        typeof parsed.finalText === "string" &&
        parsed.finalText.trim()
      ) {
        return parsed.finalText;
      }
    } catch {
      return thread.resultJson;
    }
  }
  return thread?.errorMessage?.trim() || "";
};

/**
 * A task's report: the backend's record of the thread when it has one, else
 * the text the conversation itself carried back (`journalReport`). Agents a
 * cloud chat runs on Stella's own models report only into the conversation,
 * so for them the journal is the report.
 */
function useAgentReport(
  conversationId: string,
  threadId: string,
  journalReport: string | undefined,
): string {
  const [lookup, setLookup] = useState<ReportLookup>({ kind: "loading" });
  useEffect(() => {
    setLookup({ kind: "loading" });
    try {
      return getBackendClient().watch(
        "agentThreads.get",
        { conversationId, threadId },
        (thread: ReportThread) =>
          setLookup({
            kind: "loaded",
            text: threadReportText(thread),
            running: thread?.status === "running",
          }),
        () => setLookup({ kind: "failed" }),
      );
    } catch {
      setLookup({ kind: "failed" });
      return undefined;
    }
  }, [conversationId, threadId]);
  if (lookup.kind === "loaded" && lookup.text) return lookup.text;
  if (journalReport?.trim()) return journalReport;
  if (lookup.kind === "loading") return "Loading report…";
  if (lookup.kind === "failed") {
    return "Couldn’t load the report. Close and reopen it to retry.";
  }
  return lookup.running ? "Working…" : "No report is available yet.";
}

function over(color: string, base: Rgba): Rgba {
  const top = parseColorOr(color);
  const a = top.a;
  return {
    r: top.r * a + base.r * (1 - a),
    g: top.g * a + base.g * (1 - a),
    b: top.b * a + base.b * (1 - a),
    a: 1,
  };
}

/**
 * The assistant bubble's translucent fill, flattened onto the chat
 * background it sits on, so a presented surface can wear the same colour
 * without letting the timeline show through.
 */
export function reportSurfaceFill(colors: Colors): {
  top: string;
  bottom: string;
  solid: string;
} {
  const base = parseColorOr(colors.background);
  const top = over(colors.assistantBubbleFillTop, base);
  const bottom = over(colors.assistantBubbleFillBottom, base);
  return {
    top: toHex(top),
    bottom: toHex(bottom),
    solid: toHex(mixSrgb(top, bottom, 0.5)),
  };
}

/**
 * A specular rim: brightest along the top edge and its corners, fading down
 * the sides, with a faint catch-light returning at the bottom. Light themes
 * pair a white top highlight with a soft dark edge so the rim still reads on
 * a pale fill.
 */
export function reportRimColors(isDark: boolean): string[] {
  return isDark
    ? [
        "rgba(255,255,255,0.36)",
        "rgba(255,255,255,0.16)",
        "rgba(255,255,255,0.07)",
        "rgba(255,255,255,0.05)",
        "rgba(255,255,255,0.05)",
        "rgba(255,255,255,0.07)",
        "rgba(255,255,255,0.14)",
      ]
    : [
        "rgba(255,255,255,1)",
        "rgba(0,0,0,0.05)",
        "rgba(0,0,0,0.07)",
        "rgba(0,0,0,0.07)",
        "rgba(0,0,0,0.08)",
        "rgba(0,0,0,0.10)",
        "rgba(0,0,0,0.13)",
      ];
}

/** The report's title row, close control and scrolling body. */
export function AgentReportContent({
  reference,
  conversationId,
  colors,
  journalReport,
  onClose,
  width,
  maxHeight,
}: {
  reference: AgentReplyRef;
  conversationId: string;
  colors: Colors;
  journalReport?: string;
  onClose: () => void;
  width: number;
  maxHeight: number;
}) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const report = useAgentReport(
    conversationId,
    reference.threadId,
    journalReport,
  );
  return (
    <View style={[styles.content, { width, maxHeight }]}>
      <View style={styles.head}>
        <Text numberOfLines={1} style={styles.title}>
          {replyTitle(reference)}
        </Text>
        <GlassIconButton
          icon="x"
          size={30}
          iconSize={14}
          muted
          accessibilityLabel="Close report"
          onPress={onClose}
        />
      </View>
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
      >
        <AssistantMarkdown
          text={report}
          colors={colors}
          selectable
          fill={false}
        />
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    content: { flexDirection: "column" },
    head: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingLeft: 16,
      paddingRight: 8,
      paddingTop: 8,
      paddingBottom: 4,
    },
    title: {
      flex: 1,
      color: colors.assistantBubbleText,
      fontFamily: fonts.sans.semiBold,
      fontSize: 13,
    },
    body: { flexShrink: 1 },
    bodyContent: {
      paddingHorizontal: 16,
      paddingBottom: 12,
      paddingTop: 2,
    },
  });
