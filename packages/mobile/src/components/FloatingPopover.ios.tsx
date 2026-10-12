import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { Host, Popover, RNHostView, Rectangle, ZStack } from "@expo/ui/swift-ui";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  frame,
  opacity,
  presentationBackground,
} from "@expo/ui/swift-ui/modifiers";
import { useColors, useTheme } from "../theme/theme-context";
import { recentTouchAnchor, type TouchAnchor } from "../lib/touch-anchor";
import { TOP_BAR_BAR_HEIGHT } from "./AppBackdrop";
import {
  POPOVER_FOOTER_HEIGHT,
  POPOVER_MAX_WIDTH,
  POPOVER_SIDE_MARGIN,
  PopoverFooter,
  popoverSurfaceFill,
  type FloatingPopoverProps,
} from "./FloatingPopoverParts";

const ANCHOR_SIZE = 24;
const DISMISS_MS = 320;
const ARROW_ROOM = 16;
const EDGE_GAP = 8;
const MIN_BUBBLE_HEIGHT = 160;

/**
 * iOS's own popover, pointing at what was tapped. SwiftUI presents it with
 * compact adaptation forced to `.popover`, so iPhone gets a real popover
 * rather than a sheet: system placement, tap-outside dismissal and VoiceOver
 * focus. The system surface itself wears the assistant fill, arrow included,
 * so the content and its footer of glass controls read as one card.
 */
export function FloatingPopover({
  anchor,
  fallbackAnchor,
  onClose,
  closeLabel,
  width: widthProp,
  height,
  maxHeight,
  actions,
  children,
}: FloatingPopoverProps) {
  const { isDark } = useTheme();
  const fill = popoverSurfaceFill(useColors()).solid;
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const rootRef = useRef<View>(null);
  const [point] = useState<TouchAnchor>(
    () =>
      anchor ??
      recentTouchAnchor() ??
      fallbackAnchor ?? { x: screenWidth / 2, y: screenHeight * 0.18 },
  );
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const [presented, setPresented] = useState(false);
  const closingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = useCallback(() => {
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

  const width =
    widthProp ??
    Math.min(screenWidth - POPOVER_SIDE_MARGIN * 2, POPOVER_MAX_WIDTH);
  const topLimit = insets.top + TOP_BAR_BAR_HEIGHT + EDGE_GAP;
  const bottomLimit = screenHeight - insets.bottom - EDGE_GAP;
  const above = point.y - ANCHOR_SIZE / 2 - ARROW_ROOM - topLimit;
  const below = bottomLimit - (point.y + ANCHOR_SIZE / 2) - ARROW_ROOM;
  const placeBelow = below >= above;
  const room = Math.max(
    MIN_BUBBLE_HEIGHT,
    Math.floor(Math.max(above, below) - POPOVER_FOOTER_HEIGHT),
  );
  const bubbleHeight = height === undefined ? undefined : Math.min(height, room);
  const bubbleMaxHeight = Math.min(maxHeight ?? room, room);

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
            left: point.x - origin.x - ANCHOR_SIZE / 2,
            top: point.y - origin.y - ANCHOR_SIZE / 2,
            width: ANCHOR_SIZE,
            height: ANCHOR_SIZE,
          }}
        >
          <Popover
            isPresented={presented}
            arrowEdge={placeBelow ? "top" : "bottom"}
            onIsPresentedChange={(next) => {
              if (!next) close();
            }}
          >
            <Popover.Trigger>
              <Rectangle
                modifiers={[
                  opacity(0),
                  frame({ width: ANCHOR_SIZE, height: ANCHOR_SIZE }),
                ]}
              />
            </Popover.Trigger>
            <Popover.Content>
              <ZStack modifiers={[presentationBackground(fill)]}>
                <RNHostView matchContents>
                  <View style={[styles.column, { width, backgroundColor: fill }]}>
                    <View
                      style={[
                        styles.body,
                        bubbleHeight !== undefined ? { height: bubbleHeight } : null,
                        { maxHeight: bubbleMaxHeight },
                      ]}
                    >
                      {typeof children === "function" ? children(close) : children}
                    </View>
                    <PopoverFooter
                      actions={actions}
                      closeLabel={closeLabel}
                      onClose={close}
                    />
                  </View>
                </RNHostView>
              </ZStack>
            </Popover.Content>
          </Popover>
        </Host>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  column: { alignItems: "stretch" },
  body: { flexShrink: 1, overflow: "hidden" },
});
