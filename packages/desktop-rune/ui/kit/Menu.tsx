import { createContext, isValidElement, useContext, useState, type ReactNode } from "react";
import { DismissLayer } from "./dismiss-layer";
import { AppModeScope, derive, font, fontSize, layer, look, mix, radius, type Tokens, useTokens } from "../theme";
import { MENU_GLASS_RADIUS, menuGlass, POPOVER_GLASS_RADIUS } from "./menu-glass";
import { Icon, Icons, type IconData } from "./icons";

type Side = "top" | "bottom" | "left" | "right";
type Align = "start" | "center" | "end";

export type MenuTrigger = { id: string; open: boolean; toggle: () => void };

const MenuClose = createContext<() => void>(() => {});

/** Closes the menu the caller sits in (an item that opens a dialog, say). */
export const useMenuClose = () => useContext(MenuClose);

/** desktop-ui's dropdown chrome (`[data-component="dropdown-menu-content"]`) as Liquid Glass (`menuGlass`). */
export function menuSurface(t: Tokens) {
  const g = menuGlass(t);
  return { radius: MENU_GLASS_RADIUS, border: g.border, fx: g.morph, shadows: g.shadows } as const;
}

/**
 * How a Radix menu takes focus as it opens (`MenuContent`'s `onEntryFocus`): the menu itself when
 * the pointer opened it, so arrows then reach the first or last item, and its first item when
 * Return or Space did. Call it in a component that mounts with the menu.
 */
export function useMenuEntryFocus() {
  const [byKeys] = useState(() => stella.pressedByKeys());
  return { focusable: true, tabIndex: -1, autoFocus: !byKeys } as const;
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
  /** `false`: closing leaves nothing focused (an `onCloseAutoFocus` that prevents the return to the trigger). */
  returnFocus?: boolean;
  children: ReactNode;
};

/** desktop-ui's `DropdownMenu` (Radix): a trigger and an anchored, modal menu that closes on choice, Escape or outside click. Radix lays menu content left to right unless a DirectionProvider says otherwise, and desktop-ui has none. */
export function DropdownMenu({ id, open, onOpenChange, trigger, side = "bottom", align = "start", sideOffset = 4, minW = 180, maxW, maxH, matchTriggerWidth, returnFocus, children }: DropdownMenuProps) {
  const triggerId = `${id}-trigger`;
  const close = () => onOpenChange(false);
  return (
    <>
      {trigger({ id: triggerId, open, toggle: () => onOpenChange(!open) })}
      {open ? (
        <MenuClose.Provider value={close}>
          <MenuPanel id={id} triggerId={triggerId} side={side} align={align} sideOffset={sideOffset} minW={minW} maxW={maxW} maxH={maxH} matchTriggerWidth={matchTriggerWidth} returnFocus={returnFocus} close={close}>
            {children}
          </MenuPanel>
        </MenuClose.Provider>
      ) : null}
    </>
  );
}

type MenuPanelProps = Omit<DropdownMenuProps, "open" | "onOpenChange" | "trigger"> & { triggerId: string; close: () => void };

function MenuPanel(props: MenuPanelProps) {
  return (
    <AppModeScope>
      <MenuPanelGlass {...props} />
    </AppModeScope>
  );
}

function MenuPanelGlass({ id, triggerId, side, align, sideOffset, minW, maxW, maxH, matchTriggerWidth, returnFocus, close, children }: MenuPanelProps) {
  const t = useTokens();
  const entry = useMenuEntryFocus();
  return (
    <col
      id={`${id}-content`}
      role="menu"
      dir="ltr"
      anchor={{ to: triggerId, side, align, gap: sideOffset, fit: matchTriggerWidth }}
      raise={layer.menu}
      modal={{ clickOutside: true, returnFocus }}
      onDismiss={close}
      focusGroup
      {...entry}
      minW={minW}
      maxW={maxW}
      maxH={maxH}
      pad={6 + 1}
      {...menuSurface(t)}
    >
      <col w="full" minH={0} shrink scrollY>
        <DismissLayer.Provider value={close}>{children}</DismissLayer.Provider>
      </col>
    </col>
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
  return { text: c.textBase, icon: c.textWeak, hi: menuGlass(t).pill, hiText: c.textStrong, hiIcon: c.textStrong };
}

/** Concentric with the menu: its corner less the 7 pt padding. */
const ITEM_RADIUS = MENU_GLASS_RADIUS - 7;

const ITEM_TEXT = look(fontSize.base, 500, { lh: 1.3 });

type ItemBase = { id?: string; disabled?: boolean; keepOpen?: boolean; trailing?: ReactNode; centered?: boolean; strong?: boolean; children: ReactNode };

const isLayoutNode = (node: ReactNode) => isValidElement(node) && typeof node.type === "string" && node.type !== "text";

function ItemRow({ id, disabled, destructive = false, lead, trailing, role, checked, onSelect, keepOpen, centered, strong, children }: ItemBase & { destructive?: boolean; lead?: ReactNode; role: string; checked?: boolean; onSelect?: () => void }) {
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
      px={12}
      py={8}
      align="center"
      justify={centered ? "center" : undefined}
      radius={ITEM_RADIUS}
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
      {isLayoutNode(children) ? (
        <col grow={1} shrink minW={0}>
          {children}
        </col>
      ) : (
        <text {...ITEM_TEXT} weight={strong ? 600 : ITEM_TEXT.weight} color={disabled ? t.c.mutedForeground : strong ? t.c.textStrong : l.text} grow={centered ? undefined : 1} shrink truncate>
          {children}
        </text>
      )}
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
  trigger?: { h?: number; fill?: string; px?: number; pl?: number; pr?: number; hover?: string; color?: string; hoverColor?: string; border?: string; size?: number; weight?: number; tracking?: number };
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
            pl={triggerStyle?.pl}
            pr={triggerStyle?.pr}
            gap={8}
            align="center"
            justify="between"
            radius={triggerRadius}
            border={triggerStyle?.border ?? c.border}
            fill={trig.open ? sel.open : (triggerStyle?.fill ?? c.background)}
            hoverColor={disabled ? undefined : triggerStyle?.hoverColor}
            hover={disabled ? undefined : (triggerStyle?.hover ?? sel.hover)}
            opacity={disabled ? 0.5 : undefined}
            motion={{ dur: 0.12 }}
            onPress={disabled ? undefined : trig.toggle}
          >
            <text {...text} {...(triggerStyle?.size !== undefined ? { size: triggerStyle.size, lineHeight: Math.round(triggerStyle.size * 1.5) } : null)} {...(triggerStyle?.weight !== undefined ? { weight: triggerStyle.weight } : null)} {...(triggerStyle?.tracking !== undefined ? { tracking: triggerStyle.tracking } : null)} color={triggerStyle?.color ?? c.foreground} grow={1} shrink={w !== "fit"} truncate={w !== "fit"} nowrap>
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
  const triggerId = `${id}-trigger`;
  const close = () => onOpenChange(false);
  return (
    <>
      {trigger({ id: triggerId, open, toggle: () => onOpenChange(!open) })}
      {open ? (
        <MenuClose.Provider value={close}>
          <AppModeScope>
            <PopoverGlass id={id} triggerId={triggerId} side={side} align={align} sideOffset={sideOffset} width={width} padded={padded} close={close}>
              {children}
            </PopoverGlass>
          </AppModeScope>
        </MenuClose.Provider>
      ) : null}
    </>
  );
}

function PopoverGlass({ id, triggerId, side, align, sideOffset, width, padded, close, children }: { id: string; triggerId: string; side: Side; align: Align; sideOffset: number; width?: number; padded: boolean; close: () => void; children: ReactNode }) {
  const g = menuGlass(useTokens());
  return (
    <col
      id={`${id}-content`}
      role="dialog"
      anchor={{ to: triggerId, side, align, gap: sideOffset }}
      raise={layer.popover}
      modal={{ clickOutside: true, livePages: true }}
      onDismiss={close}
      w={width}
      minW={width ?? 200}
      maxW={width ?? 320}
      radius={POPOVER_GLASS_RADIUS}
      border={g.border}
      fx={g.morph}
      shadows={g.shadows}
      pad={padded ? 12 + 1 : 1}
    >
      <DismissLayer.Provider value={close}>{children}</DismissLayer.Provider>
    </col>
  );
}
