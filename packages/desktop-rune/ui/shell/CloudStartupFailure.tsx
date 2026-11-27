import { derive, font, fontSize, look, mix, radius, useTokens } from "../theme";

/** __root's `CloudStartupFailure`, on the crash surface's look (error-boundary.css). */
export function CloudStartupFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useTokens();
  const c = t.c;
  const fixHover = derive(t, "crash:fix-hover", (t) => mix(t.c.primary, 85, t.c.foreground));
  return (
    <col id="error-boundary" role="alert" grow={1} h="full" center fill={c.background}>
      <box absolute={{ left: 0, top: 0, right: 0, bottom: 0 }} inert radial={{ center: [0.5, 0], radius: 700, stops: [[0, mix(c.primary, 8, "transparent")], [1, "#00000000"]] }} />
      <col maxW={480} px={24} py={48} align="center" enter={{ opacity: 0, y: 6, dur: 0.3 }}>
        <text {...look(28, 700, { em: -0.03, lh: 1.2, family: font.display })} color={c.textStrong} textAlign="center" mb={12}>{"Stella couldn't start chat"}</text>
        <text {...look(fontSize.lg, 400, { lh: 1.5 })} color={c.textWeak} textAlign="center" mb={32} selectable>{message}</text>
        <col w="full" gap={10} align="stretch">
          <box id="cloud-startup-retry" role="button" focusable py={6} px={24} minW={100} radius={radius.md} center fill={c.primary} border={c.primary} hover={fixHover} focusRing={{ width: 2, offset: 2, color: c.ring }} onPress={onRetry}>
            <text {...look(fontSize.lg, 500)} color={c.primaryForeground}>Try again</text>
          </box>
        </col>
      </col>
    </col>
  );
}
