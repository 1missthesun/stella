import { createContext, useContext, type ReactNode } from "react";
import { derive, font, fontSize, layer, look, mix, radius, type Tokens, useTokens } from "../theme";
import { Icon, Icons, type IconData } from "./icons";

type Side = "top" | "bottom" | "left" | "right";
type Align = "start" | "center" | "end";

export type MenuTrigger = { id: string; open: boolean; toggle: () => void };

const MenuClose = createContext<() => void>(() => {});

/** Closes the menu the caller sits in (an item that opens a dialog, say). */
export const useMenuClose = () => useContext(MenuClose);

/** `--glass-bg` surface with desktop-ui's dropdown chrome (`[data-component="dropdown-menu-content"]`). */
export function menuSurface(t: Tokens) {
  return {
    radius: radius.lg,
    border: t.c.borderBase,
    gradient: t.gradient.glass,
    fill: t.c.glassTop,
    shadows: t.shadow.overlay,
  } as const;
}

export type DropdownMenuProps = {
  id: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: (t: MenuTrigger) => ReactNode;
  side?: Side;
  align?: Align;
  sideOffset?: number;
  minW?: number;
  maxW?: number;
  maxH?: number;
  matchTriggerWidth?: boolean;
  children: ReactNode;
};

/** desktop-ui's `DropdownMenu` (Radix): a trigger and an anchored, modal menu that closes on choice, Escape or outside click. */
export function DropdownMenu({ id, open, onOpenChange, trigger, side = "bottom", align = "start", sideOffset = 4, minW = 180, maxW, maxH, matchTriggerWidth, children }: DropdownMenuProps) {
  const t = useTokens();
  const s = menuSurface(t);
  const triggerId = `${id}-trigger`;
  const close = () => onOpenChange(false);
  return (
    <>
      {trigger({ id: triggerId, open, toggle: () => onOpenChange(!open) })}
      {open ? (
        <MenuClose.Provider value={close}>
          <col
            id={`${id}-content`}
            role="menu"
            anchor={{ to: triggerId, side, align, gap: sideOffset, fit: matchTriggerWidth }}
            raise={layer.menu}
            modal={{ clickOutside: true }}
            onDismiss={close}
            focusGroup
            minW={minW}
            maxW={maxW}
            maxH={maxH}
            scrollY
            pad={6 + 1}
            {...s}
          >
            {children}
          </col>
        </MenuClose.Provider>
      ) : null}
    </>
  );
}

type ItemLook = { text: string; icon: string; hi: string; hiText: string; hiIcon: string };

function itemLook(t: Tokens, destructive: boolean): ItemLook {
  const c = t.c;
  if (destructive) {
    return {
      text: c.textBase,
      icon: mix(c.textWeak, 60, c.destructive),
      hi: mix(c.destructive, 14, "transparent"),
      hiText: mix(c.textStrong, 30, c.destructive),
      hiIcon: mix(c.textStrong, 25, c.destructive),
    };
  }
  return { text: c.textBase, icon: c.textWeak, hi: c.menuHighlight, hiText: c.textStrong, hiIcon: c.textStrong };
}

const ITEM_TEXT = look(fontSize.base, 500, { lh: 1.3 });

type ItemBase = { id?: string; disabled?: boolean; keepOpen?: boolean; trailing?: ReactNode; children: ReactNode };

function ItemRow({ id, disabled, destructive = false, lead, trailing, role, checked, onSelect, keepOpen, children }: ItemBase & { destructive?: boolean; lead?: ReactNode; role: string; checked?: boolean; onSelect?: () => void }) {
  const t = useTokens();
  const close = useMenuClose();
  const l = derive(t, `menu-item:${destructive}`, (t) => itemLook(t, destructive));
  return (
    <row
      id={id}
      role={role}
      checked={checked}
      disabled={disabled}
      focusable={!disabled}
      w="full"
      gap={10}
      px={10}
      py={8}
      align="center"
      radius={radius.sm}
      hover={disabled ? undefined : l.hi}
      hoverColor={disabled ? undefined : l.hiText}
      opacity={disabled ? 0.55 : undefined}
      motion={{ dur: 0.12 }}
      onPress={
        disabled
          ? undefined
          : () => {
              onSelect?.();
              if (!keepOpen) close();
            }
      }
    >
      {lead}
      <text {...ITEM_TEXT} color={disabled ? t.c.mutedForeground : l.text} grow={1} shrink truncate>
        {children}
      </text>
      {trailing}
    </row>
  );
}

export type MenuItemProps = ItemBase & { icon?: IconData; destructive?: boolean; onSelect?: () => void };

export function MenuItem({ icon, destructive, ...rest }: MenuItemProps) {
  const t = useTokens();
  const l = derive(t, `menu-item:${!!destructive}`, (t) => itemLook(t, !!destructive));
  const lead = icon ? (
    <box w={16} h={16} center shrink={false}>
      <Icon icon={icon} size={16} color={l.icon} />
    </box>
  ) : undefined;
  return <ItemRow {...rest} role="menuitem" destructive={destructive} lead={lead} />;
}

const MENU_CHECK: IconData = {
  name: "menu/check",
  view: 24,
  body: '<path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
};

export function MenuCheckboxItem({ checked, onCheckedChange, ...rest }: ItemBase & { checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  const t = useTokens();
  const lead = (
    <box w={16} h={16} center>
      {checked ? <Icon icon={MENU_CHECK} size={12} color={t.c.textStrong} /> : null}
    </box>
  );
  return <ItemRow {...rest} role="menuitemcheckbox" checked={checked} lead={lead} onSelect={() => onCheckedChange(!checked)} />;
}

export function MenuRadioItem({ checked, onSelect, ...rest }: ItemBase & { checked: boolean; onSelect: () => void }) {
  const t = useTokens();
  const lead = checked ? (
    <box w={16} h={16} center>
      <box w={6} h={6} radius={3} fill={t.c.textBase} />
    </box>
  ) : undefined;
  return <ItemRow {...rest} role="menuitemradio" checked={checked} lead={lead} onSelect={onSelect} />;
}

export function MenuSeparator() {
  const t = useTokens();
  return <box h={1} mt={6} mb={6} ml={-2} mr={-2} fill={t.c.borderWeak} />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  const t = useTokens();
  return (
    <text {...look(fontSize["2xs"], 600, { em: 0.08 })} textCase="upper" color={t.c.textWeaker} px={10} pt={6} pb={4}>
      {children}
    </text>
  );
}

export type SelectOption<T extends string = string> = { value: T; label: string; disabled?: boolean };

export type SelectProps<T extends string = string> = {
  id: string;
  value: T;
  onValueChange?: (value: T) => void;
  options: ReadonlyArray<SelectOption<T>>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  placeholder?: string;
  label?: string;
  hideLabel?: boolean;
  w?: number | "full" | "fit";
  minW?: number;
  maxW?: number;
  radius?: number;
  /** A descendant rule's trigger height and fill (e.g. `.usage-filters [data-slot="select-trigger"]`). */
  trigger?: { h?: number; fill?: string; px?: number; hover?: string; color?: string };
};

/** desktop-ui's `Select`: a 32pt field-like trigger with a chevron, opening a radio menu at least as wide as itself. */
export function Select<T extends string = string>({ id, value, onValueChange, options, open = false, onOpenChange, disabled = false, placeholder, label, hideLabel, w = "full", minW, maxW, radius: triggerRadius = radius.md, trigger: triggerStyle }: SelectProps<T>) {
  const t = useTokens();
  const c = t.c;
  const sel = derive(t, "select", (t) => ({ hover: mix(t.c.foreground, 7, t.c.background), open: mix(t.c.foreground, 9, t.c.background) }));
  const selected = options.find((o) => o.value === value);
  const text = look(fontSize.sm, font.emphasisWeight, { lh: 1.5 });
  return (
    <col w={w} minW={minW} maxW={maxW} gap={4}>
      {label && !hideLabel ? (
        <text {...text} color={c.mutedForeground}>
          {label}
        </text>
      ) : null}
      <DropdownMenu
        id={id}
        open={open && !disabled}
        onOpenChange={(next) => onOpenChange?.(next)}
        matchTriggerWidth
        maxW={360}
        maxH={320}
        trigger={(trig) => (
          <row
            id={trig.id}
            role="button"
            label={label ?? selected?.label}
            expanded={trig.open}
            disabled={disabled}
            focusable={!disabled}
            focusRing={{ width: 2, offset: 2, color: c.ring }}
            w={w === "fit" ? "fit" : "full"}
            minW={w === "fit" ? minW : undefined}
            maxW={w === "fit" ? maxW : undefined}
            h={triggerStyle?.h ?? 32}
            px={triggerStyle?.px ?? 10 + 1}
            gap={8}
            align="center"
            justify="between"
            radius={triggerRadius}
            border={c.border}
            fill={trig.open ? sel.open : (triggerStyle?.fill ?? c.background)}
            hover={disabled ? undefined : (triggerStyle?.hover ?? sel.hover)}
            opacity={disabled ? 0.5 : undefined}
            motion={{ dur: 0.12 }}
            onPress={disabled ? undefined : trig.toggle}
          >
            <text {...text} color={triggerStyle?.color ?? c.foreground} grow={1} shrink={w !== "fit"} truncate={w !== "fit"} nowrap>
              {selected?.label ?? placeholder ?? ""}
            </text>
            <Icon icon={Icons.stella.ChevronDown} size={14} color={c.mutedForeground} />
          </row>
        )}
      >
        {options.map((o) => (
          <MenuRadioItem key={o.value} id={`${id}-opt-${o.value}`} checked={o.value === value} disabled={o.disabled} onSelect={() => onValueChange?.(o.value)}>
            {o.label}
          </MenuRadioItem>
        ))}
      </DropdownMenu>
    </col>
  );
}

export type PopoverProps = {
  id: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: (t: MenuTrigger) => ReactNode;
  side?: Side;
  align?: Align;
  sideOffset?: number;
  width?: number;
  padded?: boolean;
  children: ReactNode;
};

/** desktop-ui's `Popover`: an anchored overlay-surface panel (200–320pt, or `width`), `padded` = `Popover.Body`. */
export function Popover({ id, open, onOpenChange, trigger, side = "bottom", align = "center", sideOffset = 4, width, padded = true, children }: PopoverProps) {
  const t = useTokens();
  const triggerId = `${id}-trigger`;
  const close = () => onOpenChange(false);
  return (
    <>
      {trigger({ id: triggerId, open, toggle: () => onOpenChange(!open) })}
      {open ? (
        <MenuClose.Provider value={close}>
          <col
            id={`${id}-content`}
            role="dialog"
            anchor={{ to: triggerId, side, align, gap: sideOffset }}
            raise={layer.popover}
            modal={{ clickOutside: true }}
            onDismiss={close}
            w={width}
            minW={width ?? 200}
            maxW={width ?? 320}
            radius={radius.lg}
            border={t.c.borderBase}
            fill={t.c.overlayTop}
            gradient={t.gradient.overlay}
            shadows={t.shadow.overlay}
            pad={padded ? 12 + 1 : 1}
          >
            {children}
          </col>
        </MenuClose.Provider>
      ) : null}
    </>
  );
}
