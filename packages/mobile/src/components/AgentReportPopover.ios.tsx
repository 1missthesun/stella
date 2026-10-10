import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Platform,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import {
  Host,
  Popover,
  RNHostView,
  Rectangle,
  ZStack,
} from "@expo/ui/swift-ui";
import {
  foregroundStyle,
  frame,
  opacity,
  presentationBackground,
  strokeBorder,
} from "@expo/ui/swift-ui/modifiers";
import { useTheme } from "../theme/theme-context";
import {
  AgentReportContent,
  REPORT_MAX_HEIGHT_RATIO,
  REPORT_MAX_WIDTH,
  REPORT_SIDE_MARGIN,
  reportRimColors,
  reportSurfaceFill,
  type AgentReportPopoverProps,
} from "./AgentReport";

const ANCHOR_WIDTH = 72;
const ANCHOR_HEIGHT = 22;
const DISMISS_MS = 320;
const iosMajor = Number.parseInt(String(Platform.Version), 10) || 0;

/**
 * A task's full report in iOS's own popover, pointing at the "Show more"
 * that opened it. SwiftUI presents it with compact adaptation forced to
 * `.popover`, so iPhone gets a real popover rather than a sheet: system
 * placement, arrow, tap-outside dismissal and VoiceOver focus. The surface
 * wears the assistant bubble's fill with a specular rim so it reads as a
 * bubble lifted out of the chat.
 */
export function AgentReportPopover({
  reference,
  conversationId,
  colors,
  journalReport,
  anchor,
  onClose,
  topInset = 0,
}: AgentReportPopoverProps) {
  const { isDark } = useTheme();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const rootRef = useRef<View>(null);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const [presented, setPresented] = useState(false);
  const closingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finish = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setPresented(false);
    timerRef.current = setTimeout(onClose, DISMISS_MS);
  }, [onClose]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!origin) return;
    const frameId = requestAnimationFrame(() => setPresented(true));
    return () => cancelAnimationFrame(frameId);
  }, [origin]);

  const fill = useMemo(() => reportSurfaceFill(colors), [colors]);
  const rim = useMemo(() => reportRimColors(isDark), [isDark]);
  const width = Math.min(screenWidth - REPORT_SIDE_MARGIN * 2, REPORT_MAX_WIDTH);
  const maxHeight = Math.round(screenHeight * REPORT_MAX_HEIGHT_RATIO);
  const point = anchor ?? { x: screenWidth / 2, y: topInset + 52 };

  return (
    <View
      ref={rootRef}
      pointerEvents="box-none"
      style={StyleSheet.absoluteFill}
      onLayout={() =>
        rootRef.current?.measureInWindow((x, y) => setOrigin({ x, y }))
      }
    >
      {origin ? (
        <Host
          colorScheme={isDark ? "dark" : "light"}
          style={{
            position: "absolute",
            left: point.x - origin.x - ANCHOR_WIDTH / 2,
            top: point.y - origin.y - ANCHOR_HEIGHT / 2,
            width: ANCHOR_WIDTH,
            height: ANCHOR_HEIGHT,
          }}
        >
          <Popover
            isPresented={presented}
            onIsPresentedChange={(next) => {
              if (!next) finish();
            }}
          >
            <Popover.Trigger>
              <Rectangle
                modifiers={[
                  opacity(0),
                  frame({ width: ANCHOR_WIDTH, height: ANCHOR_HEIGHT }),
                ]}
              />
            </Popover.Trigger>
            <Popover.Content>
              <ZStack
                modifiers={[
                  strokeBorder(
                    iosMajor >= 26
                      ? { shape: "containerRelativeShape", style: { lineWidth: 1 } }
                      : {
                          shape: "roundedRectangle",
                          cornerRadius: 13,
                          style: { lineWidth: 1 },
                        },
                  ),
                  foregroundStyle({
                    type: "linearGradient",
                    colors: rim,
                    startPoint: { x: 0.5, y: 0 },
                    endPoint: { x: 0.5, y: 1 },
                  }),
                  presentationBackground(fill.solid),
                ]}
              >
                <RNHostView matchContents>
                  <AgentReportContent
                    reference={reference}
                    conversationId={conversationId}
                    colors={colors}
                    journalReport={journalReport}
                    onClose={finish}
                    width={width}
                    maxHeight={maxHeight}
                  />
                </RNHostView>
              </ZStack>
            </Popover.Content>
          </Popover>
        </Host>
      ) : null}
    </View>
  );
}
