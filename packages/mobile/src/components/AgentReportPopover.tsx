import { useMemo } from "react";
import { useWindowDimensions } from "react-native";
import * as Clipboard from "expo-clipboard";
import type { Colors } from "../theme/colors";
import { notifySuccess } from "../lib/haptics";
import type { TouchAnchor } from "../lib/touch-anchor";
import { AgentReportContent, useAgentReport } from "./AgentReport";
import { FloatingPopover } from "./FloatingPopover";
import type { PopoverAction } from "./FloatingPopoverParts";
import type { AgentReplyRef } from "./ReplyViewer";

const MAX_HEIGHT_RATIO = 0.58;
const PLACEHOLDERS = new Set([
  "Loading report…",
  "Working…",
  "No report is available yet.",
  "Couldn’t load the report. Close and reopen it to retry.",
]);

/** A task's full report, in the floating popover that points at its "Show more". */
export function AgentReportPopover({
  reference,
  conversationId,
  colors,
  journalReport,
  anchor,
  onClose,
  topInset = 0,
}: {
  reference: AgentReplyRef;
  conversationId: string;
  colors: Colors;
  /** The report as the conversation recorded it, when the backend has none. */
  journalReport?: string;
  /** Window point of the tap that opened the report. */
  anchor: TouchAnchor | null;
  onClose: () => void;
  /** Room the chrome above takes; a popover without an anchor points below it. */
  topInset?: number;
}) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const report = useAgentReport(conversationId, reference.threadId, journalReport);
  const ready = !PLACEHOLDERS.has(report);
  const actions = useMemo<PopoverAction[]>(
    () => [
      {
        key: "copy",
        icon: "copy",
        accessibilityLabel: "Copy report",
        disabled: !ready,
        confirm: true,
        onPress: async () => {
          await Clipboard.setStringAsync(report);
          notifySuccess();
        },
      },
    ],
    [ready, report],
  );
  return (
    <FloatingPopover
      anchor={anchor}
      fallbackAnchor={{ x: screenWidth / 2, y: topInset + 52 }}
      onClose={onClose}
      closeLabel="Close report"
      maxHeight={Math.round(screenHeight * MAX_HEIGHT_RATIO)}
      actions={actions}
    >
      <AgentReportContent reference={reference} colors={colors} report={report} />
    </FloatingPopover>
  );
}
