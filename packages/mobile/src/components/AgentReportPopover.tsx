import { useCallback, useEffect, useMemo, useState } from "react";
import { useWindowDimensions } from "react-native";
import * as Clipboard from "expo-clipboard";
import type { Colors } from "../theme/colors";
import { notifySuccess } from "../lib/haptics";
import type { TouchAnchor } from "../lib/touch-anchor";
import { AgentReportContent, useAgentReport } from "./AgentReport";
import { FloatingPopover } from "./FloatingPopover";
import type { PopoverAction } from "./FloatingPopoverParts";
import { replyTitle } from "./ReplyPreview";
import type { AgentReplyRef } from "./ReplyViewer";

const MAX_HEIGHT_RATIO = 0.58;
const PLACEHOLDERS = new Set([
  "Loading report…",
  "Working…",
  "No report is available yet.",
  "Couldn’t load the report. Close and reopen it to retry.",
]);

/** Loads one task's report and hands it to the popover; renders nothing. */
function ReportLoader({
  conversationId,
  threadId,
  journalReport,
  onChange,
}: {
  conversationId: string;
  threadId: string;
  journalReport?: string;
  onChange: (threadId: string, report: string) => void;
}) {
  const report = useAgentReport(conversationId, threadId, journalReport);
  useEffect(() => onChange(threadId, report), [onChange, report, threadId]);
  return null;
}

/**
 * The full reports behind a reply's one "Show more", in the floating popover
 * that points at it: one task's report, or several stacked under their
 * titles.
 */
export function AgentReportPopover({
  references,
  conversationId,
  colors,
  journalReports,
  anchor,
  onClose,
  topInset = 0,
}: {
  references: readonly AgentReplyRef[];
  conversationId: string;
  colors: Colors;
  /** Each report as the conversation recorded it, when the backend has none. */
  journalReports?: Readonly<Record<string, string | undefined>>;
  /** Window point of the tap that opened the report. */
  anchor: TouchAnchor | null;
  onClose: () => void;
  /** Room the chrome above takes; a popover without an anchor points below it. */
  topInset?: number;
}) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [reports, setReports] = useState<Readonly<Record<string, string>>>({});
  const onReport = useCallback((threadId: string, report: string) => {
    setReports((previous) =>
      previous[threadId] === report ? previous : { ...previous, [threadId]: report },
    );
  }, []);
  const sections = references.map((reference) => ({
    reference,
    report: reports[reference.threadId] ?? "Loading report…",
  }));
  const ready = sections.every((section) => !PLACEHOLDERS.has(section.report));
  const copyText =
    sections.length === 1
      ? (sections[0]?.report ?? "")
      : sections
          .map((section) => `${replyTitle(section.reference)}\n\n${section.report}`)
          .join("\n\n");
  const actions = useMemo<PopoverAction[]>(
    () => [
      {
        key: "copy",
        icon: "copy",
        accessibilityLabel: sections.length > 1 ? "Copy reports" : "Copy report",
        disabled: !ready,
        confirm: true,
        onPress: async () => {
          await Clipboard.setStringAsync(copyText);
          notifySuccess();
        },
      },
    ],
    [copyText, ready, sections.length],
  );
  return (
    <>
      {references.map((reference) => (
        <ReportLoader
          key={reference.threadId}
          conversationId={conversationId}
          threadId={reference.threadId}
          journalReport={journalReports?.[reference.threadId]}
          onChange={onReport}
        />
      ))}
      <FloatingPopover
        anchor={anchor}
        fallbackAnchor={{ x: screenWidth / 2, y: topInset + 52 }}
        onClose={onClose}
        closeLabel={sections.length > 1 ? "Close reports" : "Close report"}
        maxHeight={Math.round(screenHeight * MAX_HEIGHT_RATIO)}
        actions={actions}
      >
        <AgentReportContent sections={sections} colors={colors} />
      </FloatingPopover>
    </>
  );
}
