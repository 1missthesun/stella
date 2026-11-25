import { Children, cloneElement, createContext, isValidElement, useContext, useId, useState, type ReactElement, type ReactNode } from "react";
import { Scrim } from "../Dialog";
import { menuSurface } from "../Menu";
import { font, fontSize, layer, look, mix, radius, useTokens, type Style } from "../../theme";
import { useT } from "../../i18n";
import { Icon, Icons } from "../icons";
import { Press, type DomEvent } from "./press";
import { BODY_TEXT, TextScope } from "./scope";
import { Ink, T } from "./text";

type OpenState = { open: boolean; setOpen: (open: boolean) => void; id: string };

function useOpenState(open: boolean | undefined, onOpenChange: ((open: boolean) => void) | undefined, defaultOpen = false): OpenState {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [own, setOwn] = useState(defaultOpen);
  const value = open ?? own;
  return {
    id,
    open: value,
    setOpen: (next) => {
      if (open === undefined) setOwn(next);
      onOpenChange?.(next);
    },
  };
}

// ---------------------------------------------------------------- dialog

const DialogState = createContext<OpenState>({ open: false, setOpen: () => {}, id: "dialog" });

export function Dialog({ open, onOpenChange, defaultOpen, children }: { open?: boolean; onOpenChange?: (open: boolean) => void; defaultOpen?: boolean; modal?: boolean; children?: ReactNode }) {
  const state = useOpenState(open, onOpenChange, defaultOpen);
  return <DialogState.Provider value={state}>{children}</DialogState.Provider>;
}

const SIZES = { md: { w: 480, h: 512 }, lg: { w: 720, h: 512 }, xl: { w: 860, h: 640 }, page: { w: 1120, h: 820 } } as const;

export type DialogContentProps = Omit<Style, "size"> & {
  /** A dialog size; a number is a spread stylesheet's text size and is ignored. */
  size?: keyof typeof SIZES | number;
  fit?: boolean;
  className?: string;
  children?: ReactNode;
  onOpenAutoFocus?: (e: DomEvent) => void;
  onEscapeKeyDown?: (e: DomEvent) => void;
  onPointerDownOutside?: (e: DomEvent) => void;
  onInteractOutside?: (e: DomEvent) => void;
  "aria-describedby"?: string;
  "aria-label"?: string;
};

/** desktop-ui's `DialogContent`: scrim, and an overlay-surface panel 480×512 (md), 720 (lg), 860×640 (xl) or 1120×820 (page), its text in the portal's body face. */
export function DialogContent({ size = "md", fit = false, children, onEscapeKeyDown, onPointerDownOutside, onInteractOutside, className: _c, onOpenAutoFocus: _f, "aria-describedby": _d, "aria-label": label, ...panel }: DialogContentProps) {
  const t = useTokens();
  const { open, setOpen, id } = useContext(DialogState);
  if (!open) return null;
  const sized = typeof size === "number" ? "md" : size;
  const s = SIZES[sized];
  const dismiss = (outside: boolean) => {
    const e = { defaultPrevented: false, preventDefault() { e.defaultPrevented = true; } } as DomEvent;
    if (outside) {
      onPointerDownOutside?.(e);
      onInteractOutside?.(e);
    } else onEscapeKeyDown?.(e);
    if (!e.defaultPrevented) setOpen(false);
  };
  return (
    <>
      <Scrim id={`dlg${id}-scrim`} color={t.c.scrim} />
      <col id={`dlg${id}-layer`} fixed inset={0} raise={layer.dialog + 1} center pad={8} modal={{ clickOutside: false }} onDismiss={() => dismiss(false)} onPress={() => dismiss(true)}>
        <col w={s.w} maxW="100%" h={fit ? undefined : s.h} maxH="100%" align="center" justify="start">
          <col
            id={`dlg${id}`}
            role="dialog"
            label={label}
            w="full"
            h={sized === "page" ? "full" : undefined}
            maxH="100%"
            minH={fit ? undefined : 280}
            align="start"
            radius={radius["2xl"]}
            border={t.c.borderWeak}
            fill={t.c.overlayTop}
            gradient={t.gradient.overlay}
            shadows={t.shadow.xl}
            clip={radius["2xl"]}
            pad={1}
            enter={{ opacity: 0, scale: 0.96, dur: 0.3 }}
            exit={{ opacity: 0, scale: 0.96, dur: 0.15 }}
            onPress={() => {}}
            {...panel}
          >
            <TextScope base={BODY_TEXT}>{children}</TextScope>
          </col>
        </col>
      </col>
    </>
  );
}

export function DialogHeader({ children, className: _c, ...style }: Style & { children?: ReactNode; className?: string }) {
  return (
    <row w="full" pt={20} pr={16} pb={16} pl={24} justify="between" align="center" {...style}>
      {children}
    </row>
  );
}

export function DialogTitle({ children, className: _c, ...style }: Style & { children?: ReactNode; className?: string; asChild?: boolean }) {
  const t = useTokens();
  return (
    <T size={fontSize["2xl"]} weight={600} lh={1.2} em={-0.03} family={font.display} color={t.c.textStrong} role="heading" grow={1} {...style}>
      {children}
    </T>
  );
}

export function DialogDescription({ children, className: _c, ...style }: Style & { children?: ReactNode; className?: string }) {
  const t = useTokens();
  return (
    <T size={fontSize.md} weight={font.sansWeight} lh={1.43} em={-0.01} family="sans" color={t.c.mutedForeground} w="full" pr={16} pb={16} pl={24} mt={-8} {...style}>
      {children}
    </T>
  );
}

export function DialogBody({ children, className: _c, ...style }: Style & { children?: ReactNode; className?: string }) {
  return (
    <col w="full" grow={1} shrink minH={0} scrollY {...style}>
      {children}
    </col>
  );
}

export function DialogCloseButton({ className: _c, onClick, ...style }: Style & { className?: string; onClick?: () => void; "aria-label"?: string }) {
  const t = useTokens();
  const tr = useT();
  const { setOpen } = useContext(DialogState);
  return (
    <Press label={tr("common.close")} w={24} h={24} justify="center" radius={radius.sm} hover={t.c.ghostHover} hoverColor={t.c.foreground} color={t.c.mutedForeground} {...style} onPress={() => (onClick ? onClick() : setOpen(false))}>
      <Icon icon={Icons.stella.X} size={16} color={t.c.mutedForeground} />
    </Press>
  );
}

Dialog.Content = DialogContent;
Dialog.Header = DialogHeader;
Dialog.Title = DialogTitle;
Dialog.Description = DialogDescription;
Dialog.Body = DialogBody;
Dialog.CloseButton = DialogCloseButton;

// ---------------------------------------------------------------- dropdown menu and popover

type Floating = OpenState & { kind: "menu" | "popover" };
const FloatingState = createContext<Floating>({ open: false, setOpen: () => {}, id: "menu", kind: "menu" });
const useFloating = () => useContext(FloatingState);

export function DropdownMenu({ open, onOpenChange, defaultOpen, children }: { open?: boolean; onOpenChange?: (open: boolean) => void; defaultOpen?: boolean; modal?: boolean; children?: ReactNode }) {
  const state = useOpenState(open, onOpenChange, defaultOpen);
  return <FloatingState.Provider value={{ ...state, kind: "menu" }}>{children}</FloatingState.Provider>;
}

export function Popover({ open, onOpenChange, defaultOpen, children }: { open?: boolean; onOpenChange?: (open: boolean) => void; defaultOpen?: boolean; modal?: boolean; children?: ReactNode }) {
  const state = useOpenState(open, onOpenChange, defaultOpen);
  return <FloatingState.Provider value={{ ...state, kind: "popover" }}>{children}</FloatingState.Provider>;
}

type TriggerChild = ReactElement<{ id?: string; onPress?: (e: DomEvent) => void; onClick?: (e: DomEvent) => void; expanded?: boolean; "aria-expanded"?: boolean }>;

/** The element that opens the menu: with `asChild` its child, which gets the anchor id and the toggle. */
export function FloatingTrigger({ asChild, children, disabled, className: _c, ...style }: Omit<Style, "onPress"> & { asChild?: boolean; children?: ReactNode; disabled?: boolean; className?: string; "aria-label"?: string; title?: string }) {
  const { open, setOpen, id } = useFloating();
  const anchor = `fl${id}-trigger`;
  const toggle = (e?: DomEvent) => {
    if (!disabled) setOpen(!open);
    return e;
  };
  const only = Children.toArray(children)[0];
  if (asChild && isValidElement(only)) {
    const child = only as TriggerChild;
    const original = child.props.onPress ?? child.props.onClick;
    const handler = (e: DomEvent) => {
      original?.(e);
      if (!e?.defaultPrevented) toggle(e);
    };
    return cloneElement(child, { id: anchor, expanded: open, ...("onClick" in child.props || typeof child.type !== "string" ? { onClick: handler } : {}), onPress: handler } as Partial<TriggerChild["props"]>);
  }
  return (
    <Press id={anchor} expanded={open} disabled={disabled} {...style} onPress={() => toggle()}>
      {children}
    </Press>
  );
}

export const DropdownMenuTrigger = FloatingTrigger;
export const PopoverTrigger = FloatingTrigger;

type Side = "top" | "bottom" | "left" | "right";
export type FloatingContentProps = Style & {
  side?: Side;
  align?: "start" | "center" | "end";
  sideOffset?: number;
  collisionPadding?: number;
  className?: string;
  children?: ReactNode;
  forceMount?: boolean;
  onOpenAutoFocus?: (e: DomEvent) => void;
  onCloseAutoFocus?: (e: DomEvent) => void;
  onEscapeKeyDown?: (e: DomEvent) => void;
  onInteractOutside?: (e: DomEvent) => void;
  avoidCollisions?: boolean;
  "aria-label"?: string;
  /** The id of the element to open at instead of the trigger (a hidden Radix trigger laid over it). */
  anchorTo?: string;
};

/** desktop-ui's `DropdownMenuContent`: the glass menu surface anchored to its trigger, closing on choice, Escape or a press outside. */
export function DropdownMenuContent({ side = "bottom", align = "center", sideOffset = 4, children, className: _c, collisionPadding: _p, forceMount: _f, onOpenAutoFocus: _o, onCloseAutoFocus: _cl, onEscapeKeyDown: _e, onInteractOutside: _i, avoidCollisions: _a, "aria-label": label, ...style }: FloatingContentProps) {
  const t = useTokens();
  const { open, setOpen, id } = useFloating();
  if (!open) return null;
  return (
    <col
      id={`fl${id}-content`}
      role="menu"
      label={label}
      anchor={{ to: `fl${id}-trigger`, side, align, gap: sideOffset }}
      raise={layer.menu}
      modal={{ clickOutside: true }}
      onDismiss={() => setOpen(false)}
      focusGroup
      minW={180}
      scrollY
      pad={6 + 1}
      {...menuSurface(t)}
      {...style}
    >
      <TextScope base={BODY_TEXT}>{children}</TextScope>
    </col>
  );
}

/** desktop-ui's `PopoverContent`: an anchored overlay-surface panel; `PopoverBody` pads it. */
export function PopoverContent({ side = "bottom", align = "center", sideOffset = 4, anchorTo, children, className: _c, collisionPadding: _p, forceMount: _f, onOpenAutoFocus: _o, onCloseAutoFocus: _cl, onEscapeKeyDown: _e, onInteractOutside: _i, avoidCollisions: _a, "aria-label": label, ...style }: FloatingContentProps) {
  const t = useTokens();
  const { open, setOpen, id } = useFloating();
  if (!open) return null;
  return (
    <col
      id={`fl${id}-content`}
      role="dialog"
      label={label}
      anchor={{ to: anchorTo ?? `fl${id}-trigger`, side, align, gap: sideOffset }}
      raise={layer.popover}
      modal={{ clickOutside: true }}
      onDismiss={() => setOpen(false)}
      minW={200}
      maxW={320}
      radius={radius.lg}
      border={t.c.borderBase}
      fill={t.c.overlayTop}
      gradient={t.gradient.overlay}
      shadows={t.shadow.overlay}
      pad={1}
      {...style}
    >
      <TextScope base={BODY_TEXT}>{children}</TextScope>
    </col>
  );
}

export function PopoverBody({ children, className: _c, ...style }: Style & { children?: ReactNode; className?: string }) {
  return (
    <col w="full" pad={12} {...style}>
      {children}
    </col>
  );
}

Popover.Trigger = PopoverTrigger;
Popover.Content = PopoverContent;
Popover.Body = PopoverBody;

type ItemProps = Omit<Style, "onPress"> & {
  onSelect?: (e: DomEvent) => void;
  onClick?: (e: DomEvent) => void;
  disabled?: boolean;
  variant?: "default" | "destructive";
  className?: string;
  children?: ReactNode;
  textValue?: string;
  "data-active"?: string;
  [data: `data-${string}`]: unknown;
};

function MenuRow({ onSelect, onClick, disabled, variant, children, lead, role = "menuitem", checked, className: _c, textValue: _tv, ...rest }: ItemProps & { lead?: ReactNode; role?: string; checked?: boolean }) {
  const t = useTokens();
  const c = t.c;
  const { setOpen } = useFloating();
  const destructive = variant === "destructive";
  const active = rest["data-active"] === "true";
  const style: Style = {};
  for (const [k, v] of Object.entries(rest)) if (!k.startsWith("data-")) (style as Record<string, unknown>)[k] = v;
  const text = destructive ? c.textBase : active ? c.textStrong : c.textBase;
  return (
    <Press
      role={role}
      checked={checked}
      disabled={disabled}
      w="full"
      gap={10}
      px={10}
      py={8}
      radius={radius.sm}
      hover={disabled ? undefined : destructive ? mix(c.destructive, 14, "transparent") : mix(c.foreground, 7, "transparent")}
      hoverColor={disabled ? undefined : destructive ? mix(c.textStrong, 30, c.destructive) : c.textStrong}
      opacity={disabled ? 0.55 : undefined}
      motion={{ dur: 0.12 }}
      color={destructive ? mix(c.textWeak, 60, c.destructive) : c.textWeak}
      text={{ ...look(fontSize.base, active ? 600 : 500, { lh: 1.3 }), family: "sans", color: text }}
      {...style}
      onPress={(e) => {
        onClick?.(e);
        onSelect?.(e);
        if (!e.defaultPrevented) setOpen(false);
      }}
    >
      {lead}
      <MenuItemText color={disabled ? c.mutedForeground : text} weight={active ? 600 : 500}>
        {children}
      </MenuItemText>
    </Press>
  );
}

function MenuItemText({ children, color, weight }: { children?: ReactNode; color: string; weight: number }) {
  return (
    <Ink.Provider value={color}>
      {Children.map(children, (child) =>
        typeof child === "string" || typeof child === "number" ? (
          <T size={fontSize.base} weight={weight} lh={1.3} em={-0.01} family="sans" color={color} grow={1} truncate>
            {child}
          </T>
        ) : (
          child
        ),
      )}
    </Ink.Provider>
  );
}

export function DropdownMenuItem(props: ItemProps) {
  return <MenuRow {...props} />;
}

const CHECK = { name: "compat/menu-check", view: 24, body: '<path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' };

export function DropdownMenuCheckboxItem({ checked, onCheckedChange, ...rest }: ItemProps & { checked?: boolean; onCheckedChange?: (checked: boolean) => void }) {
  const t = useTokens();
  return (
    <MenuRow
      {...rest}
      role="menuitemcheckbox"
      checked={checked}
      lead={<box w={16} h={16} center>{checked ? <Icon icon={CHECK} size={12} color={t.c.textStrong} /> : null}</box>}
      onSelect={(e) => {
        rest.onSelect?.(e);
        onCheckedChange?.(!checked);
      }}
    />
  );
}

const RadioGroup = createContext<{ value?: string; onValueChange?: (v: string) => void }>({});

export function DropdownMenuRadioGroup({ value, onValueChange, children }: { value?: string; onValueChange?: (v: string) => void; children?: ReactNode; className?: string }) {
  return <RadioGroup.Provider value={{ value, onValueChange }}>{children}</RadioGroup.Provider>;
}

export function DropdownMenuRadioItem({ value, ...rest }: ItemProps & { value: string }) {
  const t = useTokens();
  const group = useContext(RadioGroup);
  const checked = group.value === value;
  return (
    <MenuRow
      {...rest}
      role="menuitemradio"
      checked={checked}
      lead={<box w={16} h={16} center>{checked ? <box w={6} h={6} radius={3} fill={t.c.textBase} /> : null}</box>}
      onSelect={(e) => {
        rest.onSelect?.(e);
        group.onValueChange?.(value);
      }}
    />
  );
}

export function DropdownMenuSeparator(_: { className?: string }) {
  const t = useTokens();
  return <box h={1} mt={6} mb={6} ml={-2} mr={-2} fill={t.c.borderWeak} />;
}

export function DropdownMenuLabel({ children, className: _c, ...style }: Style & { children?: ReactNode; className?: string }) {
  const t = useTokens();
  return (
    <T size={fontSize["2xs"]} weight={600} em={0.08} family="sans" textCase="upper" color={t.c.textWeaker} px={10} pt={6} pb={4} {...style}>
      {children}
    </T>
  );
}
