import { Pressable, StyleSheet } from "react-native";
import { tapLight } from "../../lib/haptics";
import { CONTENT_MAX_FONT_SCALE } from "../../lib/font-scale";
import { fonts } from "../../theme/fonts";
import { useColors } from "../../theme/theme-context";
import { KIT } from "../chat-settings/kit";
import { SideScroller } from "../SideScroller";
import { Text } from "../Text";

export type FileTypeOption<T extends string> = { value: T; label: string };

export function FileTypeStrip<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly FileTypeOption<T>[];
  value: T;
  onChange: (next: T) => void;
}) {
  const colors = useColors();
  return (
    <SideScroller
      style={styles.strip}
      contentContainerStyle={styles.content}
      fade={false}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            onPress={() => {
              if (selected) return;
              tapLight();
              onChange(option.value);
            }}
            style={({ pressed }) => [styles.option, pressed && styles.pressed]}
            testID={`mobile-files-type-${option.value}`}
          >
            <Text
              style={[
                styles.label,
                { color: selected ? colors.text : colors.textWeaker },
              ]}
              maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </SideScroller>
  );
}

const styles = StyleSheet.create({
  strip: { marginHorizontal: -KIT.gutter },
  content: { gap: 20, paddingHorizontal: KIT.gutter },
  option: { justifyContent: "center", minHeight: 46 },
  pressed: { opacity: 0.55 },
  label: {
    fontFamily: fonts.sans.semiBold,
    fontSize: 19,
    letterSpacing: -0.4,
  },
});
