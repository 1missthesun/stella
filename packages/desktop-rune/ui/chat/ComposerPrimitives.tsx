import type { ReactNode } from "react";
import type { InputKeyEvent } from "../../host/rune-jsx/props";
import { Icon, Icons, withStroke, type IconData } from "../kit";
import { derive, fontSize, mix, mixOklch, useTokens } from "../theme";

const BUTTON = 32;
const SPINNER: IconData = {
  name: "composer/spinner",
  view: 24,
  body: '<g fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><circle cx="12" cy="12" r="9" opacity="0.2"/><path d="M21 12a9 9 0 0 0-9-9"/></g>',
};

const primitiveLook = (t: ReturnType<typeof useTokens>) =>
  derive(t, "composer-primitives", (k) => ({
    addFill: mixOklch(k.c.foreground, 6, "transparent"),
    addHover: mixOklch(k.c.foreground, 10, "transparent"),
    ghostHover: mixOklch(k.c.foreground, 10, "transparent"),
    submitHover: mix(k.c.primary, 90, k.c.foreground),
  }));

type ButtonBase = {
  id?: string;
  title?: string;
  label?: string;
  disabled?: boolean;
  onPress?: () => void;
  onHover?: (inside: boolean) => void;
  onFocus?: (focused: boolean, keyboard: boolean) => void;
  children?: ReactNode;
};

function IconButton({ id, title, label, disabled, onPress, onHover, onFocus, fill, hoverFill, hoverColor, disabledOpacity = 0.45, checked, children }: ButtonBase & { fill?: string; hoverFill?: string; hoverColor: string; disabledOpacity?: number; checked?: boolean }) {
  const tokens = useTokens();
  return (
    <box
      id={id}
      role="button"
      focusable={!disabled}
      disabled={disabled}
      title={title}
      label={label ?? title}
      checked={checked}
      shrink={false}
      w={BUTTON}
      h={BUTTON}
      center
      radius={BUTTON / 2}
      fill={fill}
      hoverFill={disabled ? undefined : hoverFill}
      opacity={disabled ? disabledOpacity : 1}
      hoverGroup
      motion={{ dur: 0.15, bounce: 0 }}
      cursor={disabled ? "notAllowed" : "default"}
      focusRing={{ color: tokens.c.ring, width: 2, offset: 0 }}
      onPress={disabled ? undefined : onPress}
      onHover={onHover}
      onFocus={onFocus}
    >
      <box hoverColor={disabled ? undefined : hoverColor} center>
        {children}
      </box>
    </box>
  );
}

export function ComposerAddButton({ children, ...props }: ButtonBase) {
  const tokens = useTokens();
  const look = primitiveLook(tokens);
  return (
    <IconButton {...props} disabled={props.disabled ?? !props.onPress} fill={look.addFill} hoverFill={look.addHover} hoverColor={tokens.c.textBase}>
      {children ?? <Icon icon={withStroke(Icons.stella.Plus, 1.75)} size={16} color={tokens.c.textWeak} />}
    </IconButton>
  );
}

export function ComposerMicButton({ isTranscribing, title, children, ...props }: ButtonBase & { isTranscribing?: boolean }) {
  const tokens = useTokens();
  const look = primitiveLook(tokens);
  const computedTitle = title ?? (isTranscribing ? "Transcribing…" : "Start dictation");
  const color = isTranscribing ? tokens.c.textStrong : tokens.c.textBase;
  return (
    <IconButton {...props} title={computedTitle} hoverFill={look.ghostHover} hoverColor={tokens.c.textStrong} disabledOpacity={isTranscribing ? 1 : 0.45}>
      {children ?? (isTranscribing ? <Icon icon={SPINNER} size={16} color={color} spin={0.85} /> : <Icon icon={withStroke(Icons.stella.Mic, 1.75)} size={16} color={color} />)}
    </IconButton>
  );
}

export function ComposerRealtimeVoiceButton({ active = false, title, children, ...props }: ButtonBase & { active?: boolean }) {
  const tokens = useTokens();
  const look = primitiveLook(tokens);
  const computedTitle = title ?? (active ? "Stop realtime voice conversation" : "Start realtime voice conversation");
  return (
    <IconButton {...props} title={computedTitle} checked={active} fill={active ? look.ghostHover : undefined} hoverFill={look.ghostHover} hoverColor={tokens.c.textStrong}>
      {children ?? <Icon icon={withStroke(Icons.stella.AudioLines, 1.75)} size={17} color={active ? tokens.c.textStrong : tokens.c.textBase} />}
    </IconButton>
  );
}

export function ComposerSubmitButton({ animated = false, disabled, children, id, title, label, onPress }: ButtonBase & { animated?: boolean }) {
  const tokens = useTokens();
  const look = primitiveLook(tokens);
  const canSubmit = !disabled;
  return (
    <box
      id={id}
      role="button"
      focusable={canSubmit}
      disabled={disabled}
      title={title}
      label={label ?? title}
      shrink={false}
      w={BUTTON}
      h={BUTTON}
      center
      radius={BUTTON / 2}
      fill={tokens.c.primary}
      hoverFill={canSubmit && !animated ? look.submitHover : undefined}
      opacity={canSubmit ? 1 : 0.4}
      hoverOpacity={animated && canSubmit ? [1, 0.9] : undefined}
      hoverGroup={animated && canSubmit}
      scale={animated && !canSubmit ? 0.92 : 1}
      motion={animated ? { dur: 0.2, bounce: 0 } : { dur: 0.15, bounce: 0 }}
      cursor={canSubmit ? "default" : "notAllowed"}
      focusRing={{ color: tokens.c.ring, width: 2, offset: 0 }}
      onPress={canSubmit ? onPress : undefined}
    >
      {children ?? <Icon icon={withStroke(Icons.stella.ArrowUp, 1.75)} size={16} color={tokens.c.primaryForeground} />}
    </box>
  );
}

export type ComposerTextareaProps = {
  id: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  tone?: "default" | "orb";
  grow?: number;
  minH?: number;
  pt?: number;
  pb?: number;
  px?: number;
  py?: number;
  color?: string;
  keys?: string[];
  onInput?: (value: string) => void;
  onSubmit?: (value: string) => void;
  onSelection?: (sel: { start: number; end: number }) => void;
  onPaste?: (p: { files: string[]; image: string | null; text: string }) => void;
  onKey?: (e: InputKeyEvent) => void;
  onFocus?: (focused: boolean, keyboard: boolean) => void;
  onLayout?: (r: { x: number; y: number; w: number; h: number }) => void;
};

/** `.chat-composer-field.chat-composer-textarea`: 14/1.5, strong text, weaker placeholder, wraps. */
export function ComposerTextarea({ tone = "default", disabled, color, ...props }: ComposerTextareaProps) {
  const tokens = useTokens();
  return (
    <input
      {...props}
      multiline
      spellcheck
      readOnly={disabled}
      size={fontSize.md}
      lineHeight={fontSize.md * 1.5}
      color={color ?? (tone === "orb" ? tokens.c.foreground : tokens.c.textStrong)}
      placeholderColor={tokens.c.textWeaker}
      caretColor={tokens.c.textStrong}
      w="full"
      minW={0}
    />
  );
}
