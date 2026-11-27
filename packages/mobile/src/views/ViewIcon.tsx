import { memo } from "react";
import { View } from "react-native";
import { SvgXml } from "react-native-svg";
import { VIEW_ICONS, viewIconName } from "@stella/views/icons";

const markup = new Map<string, string | null>();

function iconBody(name: string): string | null {
  let body = markup.get(name);
  if (body === undefined) {
    const key = viewIconName(name);
    body = key ? (VIEW_ICONS[key] ?? null) : null;
    markup.set(name, body);
  }
  return body;
}

export const ViewIcon = memo(function ViewIcon({ name, size = 16, color, strokeWidth = 2 }: { name: unknown; size?: number; color: string; strokeWidth?: number }) {
  const body = typeof name === "string" && name.trim() ? iconBody(name) : null;
  if (!body) return <View style={{ width: size, height: size }} />;
  const xml = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  return <SvgXml xml={xml} width={size} height={size} />;
});
