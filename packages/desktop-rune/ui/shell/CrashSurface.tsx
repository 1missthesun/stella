import { useLayoutEffect, useState } from "react";
import { Icon, type IconData } from "../kit";
import { discardViewState } from "@/platform/view-state/view-state";
import { derive, font, fontSize, look, mix, radius, useTokens } from "../theme";
import { removeLaunchSplash } from "./launch-splash";

/** `inApp`: drawn inside the app root (route errors), where text inherits `.app`'s 15px, -0.15px tracking and 1.45 line height. */
type Props = { error: Error | null; componentStack: string | null; inApp?: boolean };

const APP_TRACKING = -0.15;

const DISCLOSURE_CLOSED: IconData = { name: "stella/DisclosureClosed", view: 10, body: '<path d="M1.5 0.8 9 5 1.5 9.2Z" fill="currentColor"/>' };
const DISCLOSURE_OPEN: IconData = { name: "stella/DisclosureOpen", view: 10, body: '<path d="M0.8 1.5 9.2 1.5 5 9Z" fill="currentColor"/>' };

const reload = () => {
  discardViewState();
  window.location.reload();
};

/** desktop-ui's `CrashSurface` (error-boundary.css). */
export function CrashSurface({ error, componentStack, inApp = false }: Props) {
  const t = useTokens();
  useLayoutEffect(() => removeLaunchSplash(), []);
  const c = t.c;
  const fix = derive(t, "crash:fix-hover", (t) => mix(t.c.primary, 85, t.c.foreground));
  const [detailsOpen, setDetailsOpen] = useState(false);
  const inherited = (size: number, weight: number, lh: number) => ({ ...look(size, weight, { lh, em: 0 }), ...(inApp ? { tracking: APP_TRACKING } : {}) });
  const control = inApp ? 1.45 : 1.5;
  const detailSize = inApp ? fontSize.lg : 16;
  const linkLook = inherited(fontSize.sm, 400, control);
  const link = (id: string, label: string, run: () => void) => (
    <box id={id} role="button" px={6} py={4} hoverGroup onPress={run}>
      <text {...linkLook} color={c.textWeak} hoverColor={c.textBase}>{label}</text>
    </box>
  );
  return (
    <col id="error-boundary" w="full" h="full" center fill={c.background}>
      <box absolute={{ left: 0, top: 0, right: 0, bottom: 0 }} inert radial={{ center: [0.5, 0], radius: 700, stops: [[0, mix(c.primary, 8, "transparent")], [1, "#00000000"]] }} />
      <col maxW={480} px={24} py={48} align="center" enter={{ opacity: 0, y: 6, dur: 0.3 }}>
        <text {...look(28, 700, { em: -0.03, lh: 1.2, family: font.display })} color={c.textStrong} textAlign="center" mb={12}>Something went wrong</text>
        <text {...inherited(fontSize.lg, 400, 1.5)} color={c.textWeak} textAlign="center" mb={32}>An unexpected error occurred. Reload Stella or inspect the logs.</text>
        <col w="full" gap={10} align="stretch">
          <box id="error-boundary-reload" role="button" focusable py={7} px={24} minW={100} radius={radius.md} center fill={c.primary} border={c.primary} hover={fix} focusRing={{ width: 2, offset: 2, color: c.ring }} onPress={reload}>
            <text {...inherited(fontSize.lg, 500, control)} color={c.primaryForeground}>Reload</text>
          </box>
        </col>
        <row mt={14}>
          {link("error-boundary-open-logs", "Open logs folder", () => void window.electronAPI?.system?.openLogs?.())}
          {link("error-boundary-export-logs", "Export debug logs", () => void window.electronAPI?.system?.exportLogs?.())}
        </row>
        {import.meta.env.DEV && error ? (
          <col w="full" align="center">
            <row id="error-boundary-details" role="button" h={Math.round(detailSize * control * 100) / 100} gap={4} align="center" onPress={() => setDetailsOpen((open) => !open)}>
              <Icon icon={detailsOpen ? DISCLOSURE_OPEN : DISCLOSURE_CLOSED} size={10} color={c.textStrong} />
              <text {...inherited(detailSize, 400, control)} color={c.textStrong}>Technical details</text>
            </row>
            {detailsOpen ? (
              <text w="full" {...inherited(detailSize, 400, control)} family={font.mono} textAlign="center" color={c.textStrong} selectable>{`${error.name}: ${error.message}\n${componentStack ?? ""}`.trimEnd()}</text>
            ) : null}
          </col>
        ) : null}
      </col>
    </col>
  );
}
