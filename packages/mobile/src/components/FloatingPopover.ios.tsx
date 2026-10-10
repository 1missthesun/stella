import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { Group, Host, Popover, RNHostView, Rectangle } from "@expo/ui/swift-ui";
import {
  frame,
  opacity,
  presentationBackground,
} from "@expo/ui/swift-ui/modifiers";
import { useTheme } from "../theme/theme-context";
import { recentTouchAnchor, type TouchAnchor } from "../lib/touch-anchor";
import {
  POPOVER_MAX_WIDTH,
  POPOVER_SIDE_MARGIN,
  PopoverActionRow,
  PopoverSurface,
  type FloatingPopoverProps,
} from "./FloatingPopoverParts";

const ANCHOR_SIZE = 24;
const DISMISS_MS = 320;

/**
 * iOS's own popover, pointing at what was tapped. SwiftUI presents it with
 * compact adaptation forced to `.popover`, so iPhone gets a real popover
 * rather than a sheet: system placement, tap-outside dismissal and VoiceOver
 * focus. Its system background is cleared so the content is a bubble that
 * wears the assistant fill and a specular rim, with its glass controls
 * floating free underneath.
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
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
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
              <Group modifiers={[presentationBackground(CLEAR)]}>
              <RNHostView matchContents>
                <View
                  style={[
                    styles.column,
                    { width, padding: POPOVER_SIDE_MARGIN / 2 },
                  ]}
                >
                  <PopoverSurface
                    width={width - POPOVER_SIDE_MARGIN}
                    height={height}
                    maxHeight={maxHeight}
                  >
                    {typeof children === "function" ? children(close) : children}
                  </PopoverSurface>
                  <PopoverActionRow
                    width={width - POPOVER_SIDE_MARGIN}
                    actions={actions}
                    closeLabel={closeLabel}
                    onClose={close}
                  />
                </View>
              </RNHostView>
              </Group>
            </Popover.Content>
          </Popover>
        </Host>
      ) : null}
    </View>
  );
}

const CLEAR = "#00000000";

const styles = StyleSheet.create({
  column: { alignItems: "center" },
});
