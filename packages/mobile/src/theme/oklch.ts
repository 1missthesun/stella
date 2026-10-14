import { hexToOklch, withAlpha } from "@stella/theme";

export { hexToOklch };

export function fadeHex(color: string, opacity: number): string {
  return withAlpha(color, opacity);
}
