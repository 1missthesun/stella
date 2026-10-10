import { Pressable } from "react-native";
import { GlassSurface } from "./glass";
import type { NativeMenuProps } from "./NativeMenu.types";

/** Android fallback; iOS uses the system SwiftUI Menu implementation. */
export function NativeMenu(props: NativeMenuProps) {
  if (props.plain) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={props.accessibilityLabel}
        disabled={props.disabled}
        onPress={props.onFallbackPress}
        style={({ pressed }) => ({
          width: props.width,
          height: props.height,
          justifyContent: "center",
          opacity: pressed ? 0.55 : 1,
        })}
      >
        {props.label}
      </Pressable>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      disabled={props.disabled}
      onPress={props.onFallbackPress}
    >
      <GlassSurface
        radius={props.circular ? props.height / 2 : 14}
        legible
        style={{
          width: props.width,
          height: props.height,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        {props.label}
      </GlassSurface>
    </Pressable>
  );
}
