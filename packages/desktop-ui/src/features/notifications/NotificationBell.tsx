import { memo, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Bell, Download, Lock, LogIn, Mail, RotateCcw, X } from "@/ui/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
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
} from "./notification-store";
import "./notification-bell.css";

const KIND_ICON: Record<NotificationKind, typeof Bell> = {
  "device-change": Download,
  update: RotateCcw,
  email: Mail,
  "sign-in": LogIn,
  plan: Lock,
  problem: AlertCircle,
  info: Bell,
};

const TOAST_MS = 6000;
const TOAST_LEAVE_MS = 200;
const CLEAR_CONFIRM_MS = 4000;

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

const fullDate = (locale: string, date: number) =>
  new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short" }).format(date);

const NotificationRow = ({
  item,
  variant,
  now,
  onClose,
}: {
  item: AppNotification;
  variant: "panel" | "toast";
  now: number;
  onClose?: () => void;
}) => {
  const t = useT();
  const locale = useLocale();
  const running = useNotificationRunning().has(item.id);
  const busy = running || item.busy === true;
  const Icon = KIND_ICON[item.kind];
  const actions = (item.actions ?? []).filter((action) => variant === "panel" || !action.panelOnly);
  const more = item.more;
  const unread = variant === "panel" && item.unread;
  return (
    <div
      className="notification-row"
      data-kind={item.kind}
      data-variant={variant}
      data-unread={unread || undefined}
      data-live={item.live || undefined}
      data-testid={variant === "panel" ? "notification-row" : undefined}
    >
      {unread ? <span className="notification-row__dot" aria-hidden /> : null}
      <span className="notification-row__icon" aria-hidden>
        <Icon size={15} strokeWidth={1.9} />
      </span>
      <div className="notification-row__body">
        <p className="notification-row__title">
          {unread ? <span className="sr-only">{t("shell.notifications.unread")}, </span> : null}
          {item.title}
        </p>
        {more ? (
          <div className="notification-row__line">
            {item.detail ? <p className="notification-row__summary">{item.detail}</p> : null}
            <button
              type="button"
              className="notification-row__more"
              onClick={() => {
                if (variant === "toast") onClose?.();
                else setNotificationPanelOpen(false);
                openNotificationLink(item.id, more);
              }}
              data-testid="notification-more"
            >
              {more.label}
            </button>
          </div>
        ) : item.detail ? (
          <p className="notification-row__detail">{item.detail}</p>
        ) : null}
        {variant === "panel" || actions.length > 0 ? (
          <div className="notification-row__foot">
            {variant === "panel" ? (
              <time
                className="notification-row__time"
                dateTime={new Date(item.createdAt).toISOString()}
                title={fullDate(locale, item.createdAt)}
              >
                {whenText(t, locale, item.createdAt, now)}
              </time>
            ) : null}
            <span className="notification-row__actions">
              {actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  className={`notification-row__button${action.primary ? " notification-row__button--primary" : ""}`}
                  disabled={busy || action.disabled}
                  onClick={() => {
                    if (variant === "toast") onClose?.();
                    void runNotificationAction(item.id, action);
                  }}
                  data-testid="notification-action"
                >
                  {busy && action.primary && item.busyLabel ? item.busyLabel : action.label}
                </button>
              ))}
            </span>
          </div>
        ) : null}
      </div>
      {variant === "toast" ? (
        <button
          type="button"
          className="notification-row__close"
          aria-label={t("shell.notifications.later")}
          title={t("shell.notifications.later")}
          onClick={onClose}
          data-testid="notification-toast-close"
        >
          <X size={13} />
        </button>
      ) : (
        <button
          type="button"
          className="notification-row__close notification-row__remove"
          aria-label={t("shell.notifications.dismiss")}
          title={t("shell.notifications.dismiss")}
          onClick={() => dismissNotification(item.id)}
          data-testid="notification-dismiss"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
};

const useWindowFocused = () => {
  const [focused, setFocused] = useState(() => document.hasFocus());
  useEffect(() => {
    const on = () => setFocused(true);
    const off = () => setFocused(false);
    window.addEventListener("focus", on);
    window.addEventListener("blur", off);
    return () => {
      window.removeEventListener("focus", on);
      window.removeEventListener("blur", off);
    };
  }, []);
  return focused;
};

const NotificationToast = ({ anchor }: { anchor: RefObject<HTMLButtonElement | null> }) => {
  const item = useNotificationToast();
  const now = useMinuteNow();
  const windowFocused = useWindowFocused();
  const [held, setHeld] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [right, setRight] = useState(12);
  const remaining = useRef(TOAST_MS);
  const box = useRef<HTMLDivElement>(null);
  const id = item?.id ?? null;

  useLayoutEffect(() => {
    remaining.current = TOAST_MS;
    setLeaving(false);
    setHeld(false);
    if (!id) return;
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      setRight(Math.max(8, Math.round(window.innerWidth - rect.right - 6)));
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchor, id]);

  useEffect(() => {
    const root = document.documentElement;
    const node = box.current;
    if (!id || !node) {
      root.style.removeProperty("--notification-toast-space");
      return;
    }
    const observer = new ResizeObserver(() => {
      root.style.setProperty("--notification-toast-space", `${node.offsetHeight + 8}px`);
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--notification-toast-space");
    };
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
  return createPortal(
    <div
      ref={box}
      className="notification-toast"
      role="status"
      aria-live="polite"
      style={{ right }}
      data-leaving={leaving || undefined}
      data-testid="notification-toast"
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHeld(false);
      }}
    >
      <NotificationRow item={item} variant="toast" now={now} onClose={leave} />
    </div>,
    document.body,
  );
};

const ClearAllButton = () => {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(false), CLEAR_CONFIRM_MS);
    return () => window.clearTimeout(timer);
  }, [confirming]);
  return (
    <button
      type="button"
      className="notification-row__button"
      data-confirming={confirming || undefined}
      onClick={() => {
        if (!confirming) {
          setConfirming(true);
          return;
        }
        setConfirming(false);
        clearNotifications();
      }}
      data-testid="notification-clear"
    >
      {confirming ? t("shell.notifications.clearConfirm") : t("shell.notifications.clear")}
    </button>
  );
};

export const NotificationBell = memo(function NotificationBell() {
  const t = useT();
  const items = useNotifications();
  const unseen = useUnseenNotificationCount();
  const open = useNotificationPanelOpen();
  const now = useMinuteNow();
  const bell = useRef<HTMLButtonElement>(null);
  const unreadItems = items.filter((item) => item.unread);
  const unreadCount = unreadItems.length;
  const ordered = unreadCount > 0 ? [...unreadItems, ...items.filter((item) => !item.unread)] : items;
  const label =
    unseen > 0
      ? t("shell.notifications.bellNew", { count: unseen })
      : t("shell.notifications.title");

  return (
    <>
      <Popover open={open} onOpenChange={setNotificationPanelOpen}>
        <PopoverTrigger asChild>
          <button
            ref={bell}
            type="button"
            className="shell-topbar-icon-btn notification-bell"
            aria-label={label}
            data-unseen={unseen > 0 || undefined}
            data-testid="notification-bell"
          >
            <Bell size={19} strokeWidth={1.4} />
            {unseen > 0 ? <span className="notification-bell__dot" aria-hidden /> : null}
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="notification-panel"
          side="bottom"
          align="end"
          sideOffset={8}
          collisionPadding={8}
          aria-label={t("shell.notifications.title")}
          data-testid="notification-panel"
          tabIndex={-1}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement | null)?.focus({ preventScroll: true });
          }}
        >
          <div className="notification-panel__head">
            <h2 className="notification-panel__title">{t("shell.notifications.title")}</h2>
            {items.length > 1 ? <ClearAllButton /> : null}
          </div>
          {items.length === 0 ? (
            <p className="notification-panel__empty">{t("shell.notifications.empty")}</p>
          ) : (
            <ul className="notification-panel__list" data-testid="notification-list">
              {ordered.map((item, index) => (
                <li
                  key={item.id}
                  data-earlier-start={index > 0 && index === unreadCount ? true : undefined}
                >
                  {index > 0 && index === unreadCount ? (
                    <h3 className="notification-panel__group">{t("shell.notifications.earlier")}</h3>
                  ) : null}
                  <NotificationRow item={item} variant="panel" now={now} />
                </li>
              ))}
            </ul>
          )}
        </PopoverContent>
      </Popover>
      <NotificationToast anchor={bell} />
    </>
  );
});
