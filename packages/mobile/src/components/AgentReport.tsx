import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { Colors } from "../theme/colors";
import { fonts } from "../theme/fonts";
import { fadeHex } from "../theme/oklch";
import { getBackendClient } from "../lib/backend";
import { AssistantMarkdown } from "./AssistantMarkdown";
import { replyTitle } from "./ReplyPreview";
import type { AgentReplyRef } from "./ReplyViewer";

export type { TouchAnchor as ReportAnchor } from "../lib/touch-anchor";

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

export function useAgentReport(
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

export function AgentReportContent({
  sections,
  colors,
}: {
  sections: readonly { reference: AgentReplyRef; report: string }[];
  colors: Colors;
}) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const multiple = sections.length > 1;
  const title = (reference: AgentReplyRef) => (
    <View style={styles.head}>
      <Text numberOfLines={1} style={styles.title}>
        {replyTitle(reference)}
      </Text>
    </View>
  );
  const body = (section: { reference: AgentReplyRef; report: string }) => (
    <AssistantMarkdown
      key={section.reference.threadId}
      text={section.report}
      colors={colors}
      selectable
      fill={false}
    />
  );
  if (!multiple) {
    const only = sections[0];
    if (!only) return null;
    return (
      <View style={styles.content}>
        {title(only.reference)}
        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
          {body(only)}
        </ScrollView>
      </View>
    );
  }
  return (
    <View style={styles.content}>
      <ScrollView style={styles.body}>
        {sections.map((section, index) => (
          <View
            key={section.reference.threadId}
            style={index > 0 ? styles.sectionDivider : undefined}
          >
            {title(section.reference)}
            <View style={styles.bodyContent}>{body(section)}</View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    content: { flexDirection: "column", flexShrink: 1 },
    head: {
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 4,
    },
    title: {
      flex: 1,
      color: colors.assistantBubbleText,
      fontFamily: fonts.sans.semiBold,
      fontSize: 13,
    },
    body: { flexShrink: 1 },
    sectionDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: fadeHex(colors.assistantBubbleText, 0.14),
    },
    bodyContent: {
      paddingHorizontal: 16,
      paddingBottom: 12,
      paddingTop: 2,
    },
  });
