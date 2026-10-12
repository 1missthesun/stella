import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { Colors } from "../theme/colors";
import { fonts } from "../theme/fonts";
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

/**
 * A task's report: the backend's record of the thread when it has one, else
 * the text the conversation itself carried back (`journalReport`). Agents a
 * cloud chat runs on Stella's own models report only into the conversation,
 * so for them the journal is the report.
 */
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

/** The report's title row and scrolling body. */
export function AgentReportContent({
  reference,
  colors,
  report,
}: {
  reference: AgentReplyRef;
  colors: Colors;
  report: string;
}) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.content}>
      <View style={styles.head}>
        <Text numberOfLines={1} style={styles.title}>
          {replyTitle(reference)}
        </Text>
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
    bodyContent: {
      paddingHorizontal: 16,
      paddingBottom: 12,
      paddingTop: 2,
    },
  });
