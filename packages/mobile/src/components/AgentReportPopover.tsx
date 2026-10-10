import { useEffect, useMemo } from "react";
import {
  BackHandler,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
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

const PANEL_TOP = 52;
const RADIUS = 20;
const RIM = 1;

/**
 * A task's full report in a floating panel, for platforms without iOS's
 * popover. Same surface as iOS: the assistant bubble's fill inside a
 * specular rim, a little narrower than the chat so it reads as nested.
 */
export function AgentReportPopover({
  reference,
  conversationId,
  colors,
  journalReport,
  onClose,
  topInset = 0,
}: AgentReportPopoverProps) {
  const { isDark } = useTheme();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const fill = useMemo(() => reportSurfaceFill(colors), [colors]);
  const rim = useMemo(() => reportRimColors(isDark), [isDark]);
  useEffect(() => {
    const handler = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => handler.remove();
  }, [onClose]);
  const width = Math.min(screenWidth - REPORT_SIDE_MARGIN * 2, REPORT_MAX_WIDTH);
  const maxHeight = Math.round(screenHeight * REPORT_MAX_HEIGHT_RATIO);
  return (
    <View style={styles.root} accessibilityViewIsModal>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close report"
        onPress={onClose}
        style={styles.backdrop}
      />
      <View
        style={[
          styles.panel,
          {
            top: topInset + PANEL_TOP,
            width,
            left: (screenWidth - width) / 2,
            backgroundColor: fill.solid,
          },
        ]}
      >
        <LinearGradient
          pointerEvents="none"
          colors={rim as [string, string, ...string[]]}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.inner}>
          <LinearGradient
            pointerEvents="none"
            colors={[fill.top, fill.bottom]}
            style={StyleSheet.absoluteFill}
          />
          <AgentReportContent
            reference={reference}
            conversationId={conversationId}
            colors={colors}
            journalReport={journalReport}
            onClose={onClose}
            width={width - RIM * 2}
            maxHeight={maxHeight}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 40,
  },
  backdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(0,0,0,0.2)",
  },
  panel: {
    position: "absolute",
    borderRadius: RADIUS,
    borderCurve: "continuous",
    overflow: "hidden",
    padding: RIM,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  inner: {
    borderRadius: RADIUS - RIM,
    borderCurve: "continuous",
    overflow: "hidden",
  },
});
