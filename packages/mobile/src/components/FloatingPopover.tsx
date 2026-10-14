import { useEffect } from "react";
import {
  BackHandler,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import {
  POPOVER_MAX_WIDTH,
  POPOVER_SIDE_MARGIN,
  PopoverFooter,
  PopoverSurface,
  type FloatingPopoverProps,
} from "./FloatingPopoverParts";

const PANEL_TOP = 64;

export function FloatingPopover({
  onClose,
  closeLabel,
  width: widthProp,
  height,
  maxHeight,
  actions,
  footer = true,
  children,
}: FloatingPopoverProps) {
  const { width: screenWidth } = useWindowDimensions();
  useEffect(() => {
    const handler = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => handler.remove();
  }, [onClose]);
  const width =
    widthProp ??
    Math.min(screenWidth - POPOVER_SIDE_MARGIN * 2, POPOVER_MAX_WIDTH);
  return (
    <View style={styles.root} accessibilityViewIsModal>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={closeLabel}
        onPress={onClose}
        style={styles.backdrop}
      />
      <View
        pointerEvents="box-none"
        style={[styles.column, { top: PANEL_TOP, left: (screenWidth - width) / 2, width }]}
      >
        <PopoverSurface width={width} height={height} maxHeight={maxHeight} style={styles.shadow}>
          {typeof children === "function" ? children(onClose) : children}
          {footer ? (
            <PopoverFooter actions={actions} closeLabel={closeLabel} onClose={onClose} />
          ) : null}
        </PopoverSurface>
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
  column: { position: "absolute", alignItems: "center" },
  shadow: {
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
});
