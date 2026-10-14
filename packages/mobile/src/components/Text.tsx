import type { ComponentRef, Ref } from "react";
import { Text as NativeText, type TextProps } from "react-native";
import { CHROME_MAX_FONT_SCALE } from "../lib/font-scale";

export function Text({
  maxFontSizeMultiplier = CHROME_MAX_FONT_SCALE,
  ...props
}: TextProps & { ref?: Ref<ComponentRef<typeof NativeText>> }) {
  return (
    <NativeText maxFontSizeMultiplier={maxFontSizeMultiplier} {...props} />
  );
}
