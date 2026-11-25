import { Children, createContext, useContext, type ReactNode } from "react";
import { useTokens, type BoxHandlers, type Style } from "../../theme";
import { Ink, T, tx, type TextStyle } from "./text";

export type DomEvent = { preventDefault(): void; stopPropagation(): void; defaultPrevented: boolean; target: { value: string }; currentTarget: { value: string }; key?: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; nativeEvent?: { isComposing: boolean } };

/** The event object desktop-ui handlers read: enough of a DOM event for `preventDefault`, `target.value` and key fields. */
export function domEvent(value = "", init: Partial<DomEvent> = {}): DomEvent {
  const e: DomEvent = {
    defaultPrevented: false,
    preventDefault() {
      e.defaultPrevented = true;
    },
    stopPropagation() {},
    target: { value },
    currentTarget: { value },
    nativeEvent: { isComposing: false },
    ...init,
  };
  return e;
}

const FormSubmit = createContext<(() => void) | null>(null);
export const useFormSubmit = () => useContext(FormSubmit);

/** A `<form>`: Enter in a field inside, or a `type="submit"` button, calls `onSubmit` with a cancellable event. */
export function Form({ onSubmit, children, ...style }: Style & { onSubmit?: (e: DomEvent) => void; children?: ReactNode; noValidate?: boolean }) {
  const { noValidate: _n, ...rest } = style as Style & { noValidate?: boolean };
  return (
    <FormSubmit.Provider value={onSubmit ? () => onSubmit(domEvent()) : null}>
      <col w="full" {...rest}>
        {children}
      </col>
    </FormSubmit.Provider>
  );
}

export type PressProps = Style & Omit<BoxHandlers, "onPress"> & {
  onPress?: (e: DomEvent) => void;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  role?: string;
  text?: TextStyle;
  vertical?: boolean;
  children?: ReactNode;
  tabIndex?: number;
  href?: string;
  target?: string;
  rel?: string;
};

const textual = (children: ReactNode) => {
  let only = true;
  Children.forEach(children, (c) => {
    if (c !== null && c !== undefined && typeof c !== "boolean" && typeof c !== "string" && typeof c !== "number") only = false;
  });
  return only;
};

/** A `<button>`: focusable, a focus ring, `onPress` with a DOM-like event, string children drawn as its text. */
export function Press({ onPress, disabled, type, role = "button", text, vertical, children, href: _h, target: _t, rel: _r, ...style }: PressProps) {
  const t = useTokens();
  const submit = useFormSubmit();
  const ink = (style.color as string | undefined) ?? text?.color;
  const press = disabled
    ? undefined
    : () => {
        onPress?.(domEvent());
        if (type === "submit") submit?.();
      };
  const Box = vertical ? "col" : "row";
  return (
    <Box
      role={role}
      focusable={!disabled}
      disabled={disabled}
      focusRing={{ width: 2, offset: 2, color: t.c.ring }}
      align="center"
      {...style}
      onPress={press}
    >
      <Ink.Provider value={ink}>{textual(children) && children != null && children !== "" ? <T {...tx(text, style)}>{children}</T> : children}</Ink.Provider>
    </Box>
  );
}
