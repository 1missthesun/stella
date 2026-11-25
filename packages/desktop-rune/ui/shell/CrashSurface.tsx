import { useLayoutEffect } from "react";
import { discardViewState } from "@/platform/view-state/view-state";
import { derive, font, fontSize, look, mix, radius, useTokens } from "../theme";
import { removeLaunchSplash } from "./launch-splash";

type Props = { error: Error | null; componentStack: string | null };

const reload = () => {
  discardViewState();
  window.location.reload();
};

/** desktop-ui's `CrashSurface` (error-boundary.css). */
export function CrashSurface({ error, componentStack }: Props) {
  const t = useTokens();
  useLayoutEffect(() => removeLaunchSplash(), []);
  const c = t.c;
  const fix = derive(t, "crash:fix-hover", (t) => mix(t.c.primary, 85, t.c.foreground));
  const linkLook = look(fontSize.sm, 400);
  const link = (id: string, label: string, run: () => void) => (
    <box id={id} role="button" mt={14} px={6} py={4} hoverGroup onPress={run}>
      <text {...linkLook} color={c.textWeak} hoverColor={c.textBase}>{label}</text>
    </box>
  );
  return (
    <col id="error-boundary" w="full" h="full" center fill={c.background}>
      <box absolute={{ left: 0, top: 0, right: 0, bottom: 0 }} inert radial={{ center: [0.5, 0], radius: 700, stops: [[0, mix(c.primary, 8, "transparent")], [1, "#00000000"]] }} />
      <col maxW={480} px={24} py={48} align="center" enter={{ opacity: 0, y: 6, dur: 0.3 }}>
        <text {...look(28, 700, { em: -0.03, lh: 1.2, family: font.display })} color={c.textStrong} textAlign="center" mb={12}>Something went wrong</text>
        <text {...look(fontSize.lg, 400, { lh: 1.5 })} color={c.textWeak} textAlign="center" mb={32}>An unexpected error occurred. Reload Stella or inspect the logs.</text>
        <col w="full" gap={10} align="stretch">
          <box id="error-boundary-reload" role="button" focusable py={6} px={24} minW={100} radius={radius.md} center fill={c.primary} border={c.primary} hover={fix} focusRing={{ width: 2, offset: 2, color: c.ring }} onPress={reload}>
            <text {...look(fontSize.lg, 500)} color={c.primaryForeground}>Reload</text>
          </box>
        </col>
        {link("error-boundary-open-logs", "Open logs folder", () => void window.electronAPI?.system?.openLogs?.())}
        {link("error-boundary-export-logs", "Export debug logs", () => void window.electronAPI?.system?.exportLogs?.())}
        {import.meta.env.DEV && error ? (
          <text mt={16} size={12} mono color={c.textWeak} selectable maxLines={12}>{`${error.name}: ${error.message}\n${componentStack ?? ""}`}</text>
        ) : null}
      </col>
    </col>
  );
}
