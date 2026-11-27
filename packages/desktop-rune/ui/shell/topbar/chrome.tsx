import type { ReactNode } from "react";
import { AppModeScope, layer, mixOklch, radius, derive, type Tokens, useTokens } from "../../theme";
import { menuGlass, POPOVER_GLASS_RADIUS } from "../../kit/menu-glass";
import { MenuCloseProvider } from "./menu-close";
import { DismissLayer } from "../../kit/dismiss-layer";
import { withStroke, type IconData } from "../../kit";

/** Colours of `.shell-topbar-full__right` controls: muted at rest, 5% / 9% foreground fills. */
export function topbarLook(t: Tokens) {
  return derive(t, "topbar:controls", (t) => ({
    rest: t.c.textBase,
    strong: t.c.textStrong,
    hover: mixOklch(t.c.foreground, 5, "transparent"),
    open: mixOklch(t.c.foreground, 9, "transparent"),
    iconHover: mixOklch(t.c.foreground, 8, "transparent"),
  }));
}

type TopbarButtonProps = {
  id: string;
  label: string;
  title?: string;
  active?: boolean;
  icon?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  onHover?: (inside: boolean) => void;
  children: (color: string) => ReactNode;
};

/** `.shell-topbar-icon-btn` / `.sidebar-footer-button` in the top bar's right group (26pt, 7pt radius). */
export function TopbarButton({ id, label, title, active = false, icon = true, disabled, onPress, onHover, children }: TopbarButtonProps) {
  const t = useTokens();
  const l = topbarLook(t);
  return (
    <row
      id={id}
      role="button"
      label={label}
      title={title}
      titleSide="bottom"
      focusable={!disabled}
      disabled={disabled}
      noWindowDrag
      h={26}
      w={icon ? 26 : undefined}
      px={icon ? 0 : 8}
      gap={6}
      align="center"
      justify="center"
      radius={7}
      fill={active ? l.open : undefined}
      hover={active ? l.open : l.hover}
      hoverGroup
      focusRing={{ width: 2, offset: 0, color: t.c.ring, radius: 7 }}
      motion={{ dur: 0.12 }}
      onPress={disabled ? undefined : onPress}
      onHover={onHover}
    >
      {children(active ? l.strong : l.rest)}
    </row>
  );
}

export type PanelProps = {
  id: string;
  anchor: string;
  open: boolean;
  onClose: () => void;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  gap?: number;
  w?: number;
  h?: number;
  maxH?: number;
  label?: string;
  onHover?: (inside: boolean) => void;
  modal?: boolean;
  /** Focus the panel itself on open rather than its first control (desktop-ui's `onOpenAutoFocus` focusing the content). */
  focusSelf?: boolean;
  radius?: number;
  children: ReactNode;
};

/** desktop-ui's `PopoverContent` as Liquid Glass (`menuGlass`), in the app's own mode even when its trigger's capsule took the other; grows out of its anchor and back into it. */
export function Panel(props: PanelProps) {
  if (!props.open) return null;
  return (
    <AppModeScope>
      <PanelGlass {...props} />
    </AppModeScope>
  );
}

function PanelGlass({ id, anchor, onClose, side = "bottom", align = "end", gap = 8, w, h, maxH, label, onHover, modal = true, focusSelf = false, radius: r = POPOVER_GLASS_RADIUS, children }: PanelProps) {
  const g = menuGlass(useTokens());
  return (
    <MenuCloseProvider value={onClose}>
      <col
        id={id}
        role="dialog"
        label={label}
        anchor={{ to: anchor, side, align, gap }}
        raise={layer.popover}
        modal={modal ? { clickOutside: true } : undefined}
        onDismiss={onClose}
        onHover={onHover}
        focusable={focusSelf || undefined}
        tabIndex={focusSelf ? -1 : undefined}
        autoFocus={focusSelf || undefined}
        noWindowDrag
        w={w}
        minW={w ?? 200}
        maxW={w ?? 320}
        h={h}
        maxH={maxH}
        radius={r}
        border={g.border}
        fx={g.morph}
        fill={g.fill}
        enter={g.morph ? undefined : g.enter}
        shadows={g.shadows}
        pad={1}
      >
        <col w="full" grow={1} minH={0} shrink clip={r - 1}>
          <DismissLayer.Provider value={onClose}>{children}</DismissLayer.Provider>
        </col>
      </col>
    </MenuCloseProvider>
  );
}

/** A catalog icon whose colour follows its hover group (`:hover svg { color }`). */
export function GroupIcon({ icon, size, strokeWidth, color, hoverColor, opacity }: { icon: IconData; size: number; strokeWidth?: number; color: string; hoverColor?: string; opacity?: number }) {
  const data = strokeWidth === undefined ? icon : withStroke(icon, strokeWidth);
  return <icon svg={data.body} name={data.name} view={data.view} size={size} color={color} hoverColor={hoverColor} opacity={opacity} motion={{ dur: 0.12 }} />;
}
