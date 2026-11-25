import { memo, useEffect, useRef, useState } from "react";
import { useLocale, useT } from "@/shared/i18n";
import {
  clearNotifications,
  dismissNotification,
  endNotificationToast,
  runNotificationAction,
  setNotificationPanelOpen,
  useNotificationPanelOpen,
  useNotificationRunning,
  useNotifications,
  useNotificationToast,
  useUnseenNotificationCount,
  type AppNotification,
  type NotificationKind,
} from "@/features/notifications/notification-store";
import { useWindowFocus } from "@/shared/hooks/use-window-focus";
import { Icons, type IconData } from "../../kit";
import { derive, fontSize, layer, look, mix, mixOklch, radius, useTokens } from "../../theme";
import { GroupIcon, Panel, TopbarButton } from "../../shell/topbar/chrome";
import { SHELL_TOPBAR_HEIGHT } from "../../shell/metrics";

const KIND_ICON: Record<NotificationKind, IconData> = {
  "device-change": Icons.stella.Download,
  update: Icons.stella.RotateCcw,
  email: Icons.stella.Mail,
  "sign-in": Icons.stella.LogIn,
  plan: Icons.stella.Lock,
  problem: Icons.stella.AlertCircle,
  info: Icons.stella.Bell,
};

const TOAST_MS = 6000;
const TOAST_LEAVE_MS = 200;

const TITLE = look(fontSize.base, 600, { lh: 1.35 });
const DETAIL = look(fontSize.sm, 400, { lh: 1.4 });
const TIME = look(fontSize.xs, 400);
const BUTTON = look(fontSize.sm, 500, { lh: 22 / fontSize.sm });

const useMinuteNow = () => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
};

const whenText = (t: ReturnType<typeof useT>, locale: string, date: number, now: number) => {
  const minutes = Math.round((date - now) / 60_000);
  if (minutes > -1) return t("shell.notifications.justNow");
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (Math.abs(minutes) < 60) return format.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return format.format(hours, "hour");
  return format.format(Math.round(hours / 24), "day");
};

function looks(t: ReturnType<typeof useTokens>) {
  return derive(t, "notifications", (t) => ({
    iconFill: mixOklch(t.c.foreground, 6, "transparent"),
    closeHover: mixOklch(t.c.foreground, 8, "transparent"),
    primaryHover: mix(t.c.foreground, 10, t.c.ring),
    interactiveForeground: t.c.interactiveForeground,
  }));
}

function RowButton({ id, label, primary, disabled, onPress }: { id: string; label: string; primary?: boolean; disabled?: boolean; onPress: () => void }) {
  const t = useTokens();
  const l = looks(t);
  return (
    <box
      id={id}
      role="button"
      focusable={!disabled}
      disabled={disabled}
      px={primary ? 11 : 6}
      mx={primary ? 0 : -6}
      h={22}
      center
      radius={999}
      fill={primary ? t.c.ring : undefined}
      hover={primary && !disabled ? l.primaryHover : undefined}
      hoverGroup
      opacity={disabled ? 0.55 : 1}
      focusRing={{ width: 2, offset: 0, color: t.c.ring, radius: 999 }}
      onPress={disabled ? undefined : onPress}
    >
      <text {...BUTTON} nowrap color={primary ? l.interactiveForeground : t.c.textWeak} hoverColor={primary || disabled ? undefined : t.c.textStrong}>{label}</text>
    </box>
  );
}

const NotificationRow = ({ item, variant, now, onClose }: { item: AppNotification; variant: "panel" | "toast"; now: number; onClose?: () => void }) => {
  const t = useT();
  const tk = useTokens();
  const l = looks(tk);
  const locale = useLocale();
  const running = useNotificationRunning().has(item.id);
  const busy = running || item.busy === true;
  const actions = item.actions ?? [];
  return (
    <row id={`notification-${variant}-${item.id}`} w="full" gap={10} pad={10} align="start" minW={0}>
      <box w={28} h={28} radius={8} center fill={l.iconFill}>
        <GroupIcon icon={KIND_ICON[item.kind]} size={15} strokeWidth={1.9} color={tk.c.textWeak} />
      </box>
      <col grow={1} shrink minW={0}>
        <text {...TITLE} color={tk.c.textStrong} selectable>{item.title}</text>
        {item.detail ? <text {...DETAIL} mt={2} color={tk.c.textWeak} maxLines={3}>{item.detail}</text> : null}
        <row mt={8} minH={22} gap={10} align="center" justify={variant === "toast" ? "end" : "between"}>
          {variant === "panel" ? <text {...TIME} color={tk.c.textWeak} truncate shrink minW={0}>{whenText(t, locale, item.createdAt, now)}</text> : null}
          <row gap={12} align="center" ml={variant === "panel" ? undefined : 0}>
            {variant === "panel" ? <RowButton id={`notification-dismiss-${item.id}`} label={t("shell.notifications.dismiss")} onPress={() => dismissNotification(item.id)} /> : null}
            {actions.map((action) => (
              <RowButton
                key={action.label}
                id={`notification-action-${item.id}-${action.label}`}
                label={busy && action.primary && item.busyLabel ? item.busyLabel : action.label}
                primary={action.primary}
                disabled={busy || action.disabled}
                onPress={() => {
                  if (variant === "toast") onClose?.();
                  void runNotificationAction(item.id, action);
                }}
              />
            ))}
          </row>
        </row>
      </col>
      {variant === "toast" ? (
        <box id={`notification-toast-close-${item.id}`} role="button" label={t("shell.notifications.later")} title={t("shell.notifications.later")} w={22} h={22} mt={-2} mr={-4} radius={6} center hover={l.closeHover} hoverGroup onPress={onClose}>
          <GroupIcon icon={Icons.stella.X} size={13} color={tk.c.textWeak} hoverColor={tk.c.textStrong} />
        </box>
      ) : null}
    </row>
  );
};

function NotificationToast({ bellRight }: { bellRight: number | null }) {
  const item = useNotificationToast();
  const tk = useTokens();
  const now = useMinuteNow();
  const windowFocused = useWindowFocus();
  const [held, setHeld] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const remaining = useRef(TOAST_MS);
  const id = item?.id ?? null;

  useEffect(() => {
    remaining.current = TOAST_MS;
    setLeaving(false);
    setHeld(false);
  }, [id]);

  const leave = () => {
    if (!id) return;
    setLeaving(true);
    window.setTimeout(() => endNotificationToast(id), TOAST_LEAVE_MS);
  };
  const leaveRef = useRef(leave);
  leaveRef.current = leave;

  const paused = held || !windowFocused || leaving;
  useEffect(() => {
    if (!id || paused) return;
    const started = performance.now();
    const timer = window.setTimeout(() => leaveRef.current(), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(1200, remaining.current - (performance.now() - started));
    };
  }, [id, paused]);

  if (!item) return null;
  const right = Math.max(8, Math.round(window.innerWidth - (bellRight ?? window.innerWidth - 12) - 6));
  return (
    <col
      id="notification-toast"
      key={item.id}
      role="status"
      fixed
      absolute={{ top: SHELL_TOPBAR_HEIGHT + 4, right }}
      raise={layer.toast}
      w={Math.min(340, window.innerWidth - 16)}
      radius={radius.lg}
      border={tk.c.borderBase}
      fill={tk.c.overlayTop}
      gradient={tk.gradient.overlay}
      shadows={tk.shadow.overlay}
      pad={1}
      noWindowDrag
      origin={[1, 0]}
      enter={{ opacity: 0, y: -6, scale: 0.98, dur: 0.18 }}
      opacity={leaving ? 0 : 1}
      y={leaving ? -6 : 0}
      scale={leaving ? 0.96 : 1}
      motion={{ dur: 0.2 }}
      onHover={setHeld}
      onFocusWithin={setHeld}
    >
      <NotificationRow item={item} variant="toast" now={now} onClose={leave} />
    </col>
  );
}

/** desktop-ui's `NotificationBell`: the bell, its dot, the history panel, and a toast under it. */
export const NotificationBell = memo(function NotificationBell() {
  const t = useT();
  const tk = useTokens();
  const items = useNotifications();
  const unseen = useUnseenNotificationCount();
  const open = useNotificationPanelOpen();
  const now = useMinuteNow();
  const [bellRight, setBellRight] = useState<number | null>(null);
  const label = unseen > 0 ? t("shell.notifications.bellNew", { count: unseen }) : t("shell.notifications.title");

  return (
    <>
      <box onLayout={(r) => setBellRight(r.x + r.w)}>
        <TopbarButton id="notification-bell" label={label} active={open} onPress={() => setNotificationPanelOpen(!open)}>
          {(color) => (
            <>
              <GroupIcon icon={Icons.stella.Bell} size={19} strokeWidth={1.4} color={color} hoverColor={tk.c.textStrong} />
              {unseen > 0 ? <box absolute={{ top: 4, right: 4 }} w={7} h={7} radius={3.5} fill={tk.c.ring} shadows={[{ spread: 1.5, color: tk.c.background }]} inert /> : null}
            </>
          )}
        </TopbarButton>
      </box>
      <Panel id="notification-panel" anchor="notification-bell" open={open} onClose={() => setNotificationPanelOpen(false)} w={Math.min(360, window.innerWidth - 16)} maxH={Math.min(480, window.innerHeight - 64)} label={t("shell.notifications.title")}>
        <row w="full" pt={12} pr={14} pb={6} pl={16} gap={12} align="center" justify="between">
          <text {...look(fontSize.base, 600)} color={tk.c.textStrong}>{t("shell.notifications.title")}</text>
          {items.length > 1 ? <RowButton id="notification-clear" label={t("shell.notifications.clear")} onPress={clearNotifications} /> : null}
        </row>
        {items.length === 0 ? (
          <text {...look(fontSize.sm, 400)} px={16} pt={6} pb={16} color={tk.c.textWeak}>{t("shell.notifications.empty")}</text>
        ) : (
          <col id="notification-panel-list" w="full" px={6} pb={6} scrollY grow={1} shrink minH={0}>
            {items.map((item, index) => (
              <col key={item.id} w="full" borderSides={index > 0 ? [1, 0, 0, 0] : undefined} border={index > 0 ? tk.c.borderWeak : undefined}>
                <NotificationRow item={item} variant="panel" now={now} />
              </col>
            ))}
          </col>
        )}
      </Panel>
      <NotificationToast bellRight={bellRight} />
    </>
  );
});
