import { useState, useSyncExternalStore } from "react";
import { fontSize, look, mix, radius, useTokens, derive } from "../theme";
import { useT } from "../i18n";
import { Icon, Icons } from "./icons";

export type ToastAction = { label: string; onClick: () => void };
export type ToastDetail = { label: string; text: string };
export type ToastOptions = {
  title?: string;
  description?: string;
  detail?: ToastDetail;
  variant?: "default" | "success" | "error" | "loading";
  duration?: number;
  action?: ToastAction;
  secondaryAction?: ToastAction;
};
type Toast = ToastOptions & { id: string };

let toasts: Toast[] = [];
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const keys = new Map<string, string>();

function emit(next: Toast[]) {
  toasts = next;
  for (const l of listeners) l();
}

export function dismissToast(id: string): void {
  if (!id) return;
  const timer = timers.get(id);
  if (timer !== undefined) clearTimeout(timer);
  timers.delete(id);
  for (const [k, v] of keys) if (v === id) keys.delete(k);
  emit(toasts.filter((t) => t.id !== id));
}

/** desktop-ui's `showToast`: same options, same dedupe (variant + title + description) and 4 s default. */
export function showToast(options: ToastOptions | string): string {
  const opts = typeof options === "string" ? { description: options } : options;
  const dedupe = `${opts.variant ?? "default"}::${opts.title ?? ""}::${opts.description ?? ""}`;
  const existing = keys.get(dedupe);
  const id = existing ?? Math.random().toString(36).substring(2, 9);
  if (existing) {
    emit(toasts.map((t) => (t.id === existing ? { ...t, ...opts, id } : t)));
    const prev = timers.get(existing);
    if (prev !== undefined) clearTimeout(prev);
    timers.delete(existing);
  } else {
    emit([...toasts, { id, ...opts }]);
    keys.set(dedupe, id);
  }
  if (opts.duration !== 0 && !opts.detail) {
    timers.set(
      id,
      setTimeout(() => {
        keys.delete(dedupe);
        dismissToast(id);
      }, opts.duration || 4000),
    );
  }
  return id;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The toast stack (`[data-component="toast-region"]`), top right under the 48pt top bar. Render once per window. */
export function ToastRegion({ top = 48 }: { top?: number }) {
  const list = useSyncExternalStore(subscribe, () => toasts);
  if (list.length === 0) return null;
  return (
    <col id="toast-region" fixed absolute={{ top, right: 16 }} raise={1000} w={400} maxW="100%" gap={8}>
      {list.map((t) => (
        <ToastItem key={t.id} toast={t} onClose={() => dismissToast(t.id)} />
      ))}
    </col>
  );
}

const TITLE = look(fontSize.base, 500, { lh: 1.43 });
const DESC = look(fontSize.base, 500, { lh: 1.55 });

export function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const t = useTokens();
  const tr = useT();
  const c = t.c;
  const [detailOpen, setDetailOpen] = useState(false);
  const rail = toast.variant === "success" ? c.success : toast.variant === "error" ? c.destructive : toast.variant === "loading" ? c.textWeak : undefined;
  const actionHover = derive(t, "toast-action", (t) => mix(t.c.foreground, 10, t.c.interactive));
  const hasActions = toast.action || toast.secondaryAction;
  return (
    <row
      id={`toast-${toast.id}`}
      role="status"
      w="full"
      gap={16}
      align="start"
      px={16 + 1}
      py={14 + 1}
      radius={radius.lg}
      border={c.borderBase}
      fill={c.glassTop}
      gradient={t.gradient.glass}
      shadows={t.shadow.overlay}
      clip={radius.lg}
      enter={{ opacity: 0, y: -12, dur: 0.15 }}
      exit={{ opacity: 0, dur: 0.15 }}
      layout={0.15}
    >
      {rail ? <box absolute={{ left: 0, top: 8, bottom: 8 }} w={3} radius={3} fill={rail} /> : null}
      <col grow={1} shrink minW={0} gap={2} pr={!toast.title && hasActions ? 28 : 0}>
        {toast.title ? (
          <text {...TITLE} color={c.textStrong} pr={22}>
            {toast.title}
          </text>
        ) : null}
        {toast.description || hasActions ? (
          <row w="full" gap={12} align="center" justify="between">
            {toast.description ? (
              <text {...DESC} color={c.textBase} grow={1} shrink pr={toast.title ? 0 : 22}>
                {toast.description}
              </text>
            ) : null}
            {hasActions ? (
              <row gap={12} align="center" shrink={false} ml={0}>
                {toast.secondaryAction ? (
                  <text
                    {...DESC}
                    id={`toast-${toast.id}-secondary`}
                    role="button"
                    focusable
                    color={c.textWeak}
                    onPress={() => {
                      toast.secondaryAction!.onClick();
                      onClose();
                    }}
                  >
                    {toast.secondaryAction.label}
                  </text>
                ) : null}
                {toast.action ? (
                  <box
                    id={`toast-${toast.id}-action`}
                    role="button"
                    focusable
                    px={10}
                    py={4}
                    mt={-2}
                    mb={-2}
                    radius={radius.full}
                    fill={c.interactive}
                    hover={actionHover}
                    onPress={() => {
                      toast.action!.onClick();
                      onClose();
                    }}
                  >
                    <text {...look(fontSize.base, 500)} lineHeight={16} color={c.interactiveForeground}>
                      {toast.action.label}
                    </text>
                  </box>
                ) : null}
              </row>
            ) : null}
          </row>
        ) : null}
        {toast.detail ? (
          <col mt={4} gap={6}>
            <text {...look(fontSize.sm, 500)} color={c.textWeak} hoverColor={c.textBase} role="button" focusable onPress={() => setDetailOpen(!detailOpen)}>
              {`${detailOpen ? "▾" : "▸"} ${toast.detail.label}`}
            </text>
            {detailOpen ? (
              <col maxH={160} scrollY>
                <text mono size={11} lineHeight={16.5} color={c.textWeak} selectable>
                  {toast.detail.text}
                </text>
              </col>
            ) : null}
          </col>
        ) : null}
      </col>
      <box
        id={`toast-${toast.id}-close`}
        role="button"
        label={tr("common.close")}
        focusable
        absolute={{ top: 12, right: 13 }}
        w={22}
        h={22}
        radius={radius.sm}
        center
        hover={c.menuHighlight}
        hoverColor={c.textStrong}
        onPress={onClose}
      >
        <Icon icon={Icons.stella.X} size={16} color={c.textWeak} />
      </box>
    </row>
  );
}
