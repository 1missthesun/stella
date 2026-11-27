import { memo, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLocale, useT } from "@/shared/i18n";
import {
  clearNotifications,
  dismissNotification,
  endNotificationToast,
  openNotificationLink,
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
import { BODY_TEXT } from "../../kit/compat";
import { derive, fontSize, layer, mix, mixOklch, radius, useTokens } from "../../theme";
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
const CLEAR_CONFIRM_MS = 4000;
const PANEL_INSET = 32;
const PANEL_GUTTER = 16;
const ROW_INSET = PANEL_INSET - PANEL_GUTTER;

const body = (size: number, weight: number, lineHeight = size * BODY_TEXT.lh, em = 0) => ({ family: BODY_TEXT.family, size, weight, lineHeight, tracking: size * em });
const HEAD = body(fontSize.base, 600, undefined, -0.01);
const EMPTY = body(fontSize.sm, 400);
const TITLE = body(fontSize.base, 600, fontSize.base * 1.35);
const DETAIL = body(fontSize.sm, 400, fontSize.sm * 1.4);
const TIME = body(fontSize.xs, 400);
const BUTTON = body(fontSize.sm, 500, 22);
const MORE = body(fontSize.sm, 500, 20);
const GROUP = body(fontSize.xs, 500, fontSize.xs * 1.3);

let toastSpace = 0;
const toastSpaceListeners = new Set<() => void>();
const setToastSpace = (next: number) => {
  if (next === toastSpace) return;
  toastSpace = next;
  for (const listener of toastSpaceListeners) listener();
};

/** The room the notification toast takes under the top bar; the app's toast stack starts below it. */
export const useNotificationToastSpace = (): number =>
  useSyncExternalStore(
    (listener) => {
      toastSpaceListeners.add(listener);
      return () => toastSpaceListeners.delete(listener);
    },
    () => toastSpace,
  );

const useMinuteNow = () => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
};

const startOfDay = (time: number) => {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

const whenText = (t: ReturnType<typeof useT>, locale: string, date: number, now: number) => {
  const minutes = Math.round((date - now) / 60_000);
  if (minutes > -1) return t("shell.notifications.justNow");
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
  if (date >= startOfDay(now)) return relative.format(Math.round(minutes / 60), "hour");
  const sameYear = new Date(date).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};

const fullDate = (locale: string, date: number) => new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short" }).format(date);

function looks(t: ReturnType<typeof useTokens>) {
  return derive(t, "notifications", (t) => ({
    iconFill: mixOklch(t.c.foreground, 6, "transparent"),
    iconFillRead: mixOklch(t.c.foreground, 4, "transparent"),
    closeHover: mixOklch(t.c.foreground, 8, "transparent"),
    primaryHover: mix(t.c.foreground, 10, t.c.ring),
    interactiveForeground: t.c.interactiveForeground,
  }));
}

function RowButton({ id, label, primary, disabled, strong, onPress }: { id: string; label: string; primary?: boolean; disabled?: boolean; strong?: boolean; onPress: () => void }) {
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
      <text {...BUTTON} nowrap color={primary ? l.interactiveForeground : strong ? t.c.textStrong : t.c.textWeak} hoverColor={primary || disabled ? undefined : t.c.textStrong}>{label}</text>
    </box>
  );
}

function CloseButton({ id, label, onPress, visible = true }: { id: string; label: string; onPress?: () => void; visible?: boolean }) {
  const tk = useTokens();
  const l = looks(tk);
  return (
    <box id={id} role="button" label={label} title={label} w={22} h={22} radius={6} center hover={l.closeHover} hoverGroup opacity={visible ? 1 : 0} motion={{ dur: 0.12 }} onPress={onPress}>
      <GroupIcon icon={Icons.stella.X} size={13} color={tk.c.textWeak} hoverColor={tk.c.textStrong} />
    </box>
  );
}

const NotificationRow = ({ item, variant, now, onClose }: { item: AppNotification; variant: "panel" | "toast"; now: number; onClose?: () => void }) => {
  const t = useT();
  const tk = useTokens();
  const l = looks(tk);
  const locale = useLocale();
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const running = useNotificationRunning().has(item.id);
  const busy = running || item.busy === true;
  const actions = (item.actions ?? []).filter((action) => variant === "panel" || !action.panelOnly);
  const more = item.more;
  const panel = variant === "panel";
  const unread = panel && item.unread === true;
  const title = panel && !unread ? { ...TITLE, weight: 500 } : TITLE;
  return (
    <row
      id={`notification-${variant}-${item.id}`}
      w="full"
      gap={10}
      {...(panel ? { py: 12, px: ROW_INSET } : { pad: 10 })}
      align="start"
      minW={0}
      onHover={panel ? setHovered : undefined}
      onFocusWithin={panel ? setFocusWithin : undefined}
    >
      {unread ? <box absolute={{ top: 23, left: 0 }} w={6} h={6} radius={3} fill={tk.c.ring} inert /> : null}
      <box w={28} h={28} radius={8} center shrink={false} fill={panel && !unread ? l.iconFillRead : l.iconFill}>
        <GroupIcon icon={KIND_ICON[item.kind]} size={15} strokeWidth={1.9} color={tk.c.textWeak} />
      </box>
      <col grow={1} shrink minW={0}>
        <text {...title} pr={panel ? 22 : 0} color={tk.c.textStrong} selectable label={unread ? `${t("shell.notifications.unread")}, ${item.title}` : undefined}>{item.title}</text>
        {more ? (
          <row mt={2} gap={8} align="end" minW={0}>
            {item.detail ? <text {...DETAIL} grow={1} shrink minW={0} truncate nowrap color={tk.c.textWeak}>{item.detail}</text> : null}
            <box
              id={`notification-more-${variant}-${item.id}`}
              role="button"
              px={6}
              mr={-6}
              radius={999}
              shrink={false}
              hover={l.closeHover}
              focusRing={{ width: 2, offset: 0, color: tk.c.ring, radius: 999 }}
              onPress={() => {
                if (variant === "toast") onClose?.();
                else setNotificationPanelOpen(false);
                openNotificationLink(item.id, more);
              }}
            >
              <text {...MORE} nowrap color={tk.c.textStrong}>{more.label}</text>
            </box>
          </row>
        ) : item.detail ? (
          <text {...DETAIL} mt={2} color={tk.c.textWeak} maxLines={3}>{item.detail}</text>
        ) : null}
        {panel || actions.length > 0 ? (
          <row {...(actions.length > 0 ? { mt: 8, minH: 22 } : { mt: 4 })} gap={10} align="center" justify={panel ? "between" : "end"}>
            {panel ? <text {...TIME} color={tk.c.textWeak} truncate nowrap shrink minW={0} title={fullDate(locale, item.createdAt)}>{whenText(t, locale, item.createdAt, now)}</text> : null}
            {actions.length > 0 ? (
              <row gap={12} align="center" shrink={false}>
                {actions.map((action) => (
                  <RowButton
                    key={action.label}
                    id={`notification-action-${variant}-${item.id}-${action.label}`}
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
            ) : null}
          </row>
        ) : null}
      </col>
      {panel ? (
        <box absolute={{ top: 10, right: ROW_INSET - 4 }}>
          <CloseButton id={`notification-dismiss-${item.id}`} label={t("shell.notifications.dismiss")} visible={hovered || focusWithin} onPress={() => dismissNotification(item.id)} />
        </box>
      ) : (
        <box mt={-2} mr={-4} shrink={false}>
          <CloseButton id={`notification-toast-close-${item.id}`} label={t("shell.notifications.later")} onPress={onClose} />
        </box>
      )}
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

  useEffect(() => {
    if (!id) setToastSpace(0);
    return () => setToastSpace(0);
  }, [id]);

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
      onSize={(r) => setToastSpace(Math.round(r.h) + 8)}
    >
      <NotificationRow item={item} variant="toast" now={now} onClose={leave} />
    </col>
  );
}

function ClearAllButton() {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(false), CLEAR_CONFIRM_MS);
    return () => window.clearTimeout(timer);
  }, [confirming]);
  return (
    <RowButton
      id="notification-clear"
      strong={confirming}
      label={confirming ? t("shell.notifications.clearConfirm") : t("shell.notifications.clear")}
      onPress={() => {
        if (!confirming) {
          setConfirming(true);
          return;
        }
        setConfirming(false);
        clearNotifications();
      }}
    />
  );
}

/** desktop-ui's `NotificationBell`: the bell, its dot, the history panel (unread first, then Earlier), and a toast under it. */
export const NotificationBell = memo(function NotificationBell() {
  const t = useT();
  const tk = useTokens();
  const items = useNotifications();
  const unseen = useUnseenNotificationCount();
  const open = useNotificationPanelOpen();
  const now = useMinuteNow();
  const [bellRight, setBellRight] = useState<number | null>(null);
  const unreadItems = items.filter((item) => item.unread);
  const unreadCount = unreadItems.length;
  const ordered = unreadCount > 0 ? [...unreadItems, ...items.filter((item) => !item.unread)] : items;
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
      <Panel id="notification-panel" anchor="notification-bell" focusSelf open={open} onClose={() => setNotificationPanelOpen(false)} w={Math.min(392, window.innerWidth - 16)} maxH={Math.min(480, window.innerHeight - 64)} label={t("shell.notifications.title")}>
        <row w="full" pt={12} px={PANEL_INSET} pb={6} gap={12} align="center" justify="between">
          <text {...HEAD} color={tk.c.textStrong}>{t("shell.notifications.title")}</text>
          {items.length > 1 ? <ClearAllButton /> : null}
        </row>
        {items.length === 0 ? (
          <text {...EMPTY} px={PANEL_INSET} pt={6} pb={16} color={tk.c.textWeak}>{t("shell.notifications.empty")}</text>
        ) : (
          <col id="notification-panel-list" w="full" pl={PANEL_GUTTER} pr={PANEL_GUTTER} pb={6} scrollY grow={1} shrink minH={0}>
            {ordered.map((item, index) => {
              const earlierStart = index > 0 && index === unreadCount;
              const divided = index > 0 && !earlierStart;
              return (
                <col key={item.id} w="full" pt={divided ? 1 : 0} borderSides={divided ? [1, 0, 0, 0] : undefined} border={divided ? tk.c.borderWeak : undefined}>
                  {earlierStart ? (
                    <text {...GROUP} role="heading" pt={14} pb={2} pl={ROW_INSET} color={tk.c.textWeak}>{t("shell.notifications.earlier")}</text>
                  ) : null}
                  <NotificationRow item={item} variant="panel" now={now} />
                </col>
              );
            })}
          </col>
        )}
      </Panel>
      <NotificationToast bellRight={bellRight} />
    </>
  );
});
