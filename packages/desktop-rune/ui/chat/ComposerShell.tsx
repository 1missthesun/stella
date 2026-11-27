import { useId, useState, type ReactNode } from "react";
import { fontSize, useTokens } from "../theme";
import { ComposerAddButton, ComposerSubmitButton, ComposerTextarea, type ComposerTextareaProps } from "./ComposerPrimitives";
import { COMPOSER_CAPPED_PAD_X, COMPOSER_MAX_W, composerShellLook, MIN_COMPOSER_SHELL_HEIGHT } from "./Composer";

const LINE = fontSize.md * 1.5;
const PILL_INPUT_PAD_X = 4;
const EXPANDED_RADIUS = 20;
const SHELL_SPRING = { dur: 0.35, bounce: 0 };

export type ComposerShellProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
  canSubmit?: boolean;
  inputId?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** The shell alone, without `.composer`'s padded column (the companion's composer). */
  bare?: boolean;
  /** Above the field, inside the shell (attachment tiles). */
  header?: ReactNode;
  /** In place of the field and its buttons (the dictation recording bar). */
  replace?: ReactNode;
  keys?: string[];
  onKey?: ComposerTextareaProps["onKey"];
};

/**
 * desktop-ui's bare `.composer > .composer-shell > form.composer-form`: the pill that springs to a
 * two-row card once the text wraps, with an add button (`leading`) and the animated submit button.
 */
export function ComposerShell({ value, onChange, onSubmit, placeholder, disabled = false, canSubmit, inputId, leading, trailing, bare = false, header, replace, keys, onKey }: ComposerShellProps) {
  const tokens = useTokens();
  const fallbackId = `composer-shell-input:${useId()}`;
  const id = inputId ?? fallbackId;
  const [focused, setFocused] = useState(false);
  const [pillFieldW, setPillFieldW] = useState(0);
  const [pillTextH, setPillTextH] = useState(0);
  const expanded = !replace && value.length > 0 && pillFieldW > 0 && pillTextH > LINE + 0.5;
  const look = composerShellLook(tokens);
  const submittable = canSubmit ?? (!disabled && value.trim().length > 0);
  const lead = leading ?? <ComposerAddButton disabled />;
  const trail = trailing ?? <ComposerSubmitButton disabled={!submittable} animated onPress={onSubmit} />;
  return (
    <col w="full" shrink={false} align="center" justify="end" gap={8} {...(bare ? {} : { pt: 4, px: COMPOSER_CAPPED_PAD_X, pb: 10 })}>
      <col
        w="full"
        maxW={COMPOSER_MAX_W}
        minH={MIN_COMPOSER_SHELL_HEIGHT}
        pad={1}
        radius={expanded ? EXPANDED_RADIUS : MIN_COMPOSER_SHELL_HEIGHT / 2}
        clip={expanded ? EXPANDED_RADIUS : MIN_COMPOSER_SHELL_HEIGHT / 2}
        gradient={look.gradient}
        border={focused ? look.focusBorder : look.border}
        shadows={look.shadows}
        motion={SHELL_SPRING}
        layout={SHELL_SPRING.dur}
        onFocusWithin={setFocused}
      >
        {header}
        {replace ?? (
        <row w="full" align="center" gap={8} minH={expanded ? undefined : 44} py={expanded ? 0 : 6} px={expanded ? 0 : 8}>
          {expanded ? null : <box key="lead">{lead}</box>}
          <box key="field" grow={1} minW={0} selfAlign={expanded ? "stretch" : "center"} onLayout={expanded ? undefined : (r) => setPillFieldW(r.w)}>
            {pillFieldW > 0 && value.length > 0 ? (
              <text absolute={{ left: 0, top: 0 }} w={pillFieldW - PILL_INPUT_PAD_X * 2} size={fontSize.md} lineHeight={LINE} hidden inert onSize={(r) => setPillTextH(r.h)}>
                {value.endsWith("\n") ? `${value} ` : value}
              </text>
            ) : null}
            <ComposerTextarea
              id={id}
              value={value}
              placeholder={placeholder}
              disabled={disabled}
              minH={expanded ? 36 : 28}
              pt={expanded ? 10 : 3.5}
              pb={expanded ? 2 : 3.5}
              px={expanded ? 16 : PILL_INPUT_PAD_X}
              onInput={onChange}
              onSubmit={() => {
                if (submittable) onSubmit();
              }}
              {...(keys ? { keys } : {})}
              {...(onKey ? { onKey } : {})}
            />
          </box>
          {expanded ? null : <box key="trail">{trail}</box>}
        </row>
        )}
        {expanded && !replace ? (
          <row w="full" align="center" justify="between" pt={2} px={8} pb={6}>
            <row align="center" gap={4}>
              {lead}
            </row>
            <row align="center" gap={8}>
              {trail}
            </row>
          </row>
        ) : null}
      </col>
    </col>
  );
}
