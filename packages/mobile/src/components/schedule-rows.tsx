import { memo } from "react";
import { Pressable, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import type { MobileSchedule } from "../lib/schedules";
import { CONTENT_MAX_FONT_SCALE } from "../lib/font-scale";
import { fadeHex } from "../theme/oklch";
import { useColors } from "../theme/theme-context";
import type { AiryListStyles } from "./airy-list";
import { Text } from "./Text";

export const ScheduleRow = memo(function ScheduleRow({
  schedule,
  when,
  failed,
  busy,
  highlighted,
  styles,
  onPress,
}: {
  schedule: MobileSchedule;
  when: string;
  failed: string | null;
  busy: boolean;
  highlighted: boolean;
  styles: AiryListStyles;
  onPress: (schedule: MobileSchedule) => void;
}) {
  const colors = useColors();
  const detail = [when, failed].filter(Boolean).join(" · ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[schedule.title, detail].filter(Boolean).join(", ")}
      accessibilityState={{ busy }}
      disabled={busy}
      onPress={() => onPress(schedule)}
      style={({ pressed }) => [
        styles.row,
        pressed && styles.pressed,
        busy && { opacity: 0.45 },
      ]}
    >
      {highlighted ? (
        <Animated.View
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(500)}
          pointerEvents="none"
          style={{
            backgroundColor: fadeHex(colors.text, 0.07),
            borderCurve: "continuous",
            borderRadius: 16,
            bottom: 0,
            left: -12,
            position: "absolute",
            right: -12,
            top: 0,
          }}
        />
      ) : null}
      <View style={styles.copy}>
        <Text
          style={[styles.title, !schedule.enabled && styles.quiet]}
          numberOfLines={2}
          maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
        >
          {schedule.title}
        </Text>
        {detail ? (
          <Text
            style={styles.detail}
            numberOfLines={1}
            maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
          >
            {when}
            {failed ? (
              <Text style={styles.danger}>{when ? ` · ${failed}` : failed}</Text>
            ) : null}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
});
