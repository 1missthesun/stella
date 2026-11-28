import { GUTTER, rt, useRn } from "../../rn";

// packages/mobile's files/FileTypeStrip: the file types present, as big words in a sideways row,
// the chosen one at full strength.

const LABEL = rt(19, 600, -0.4);

export type TypeOption<T extends string> = { value: T; label: string };

export function TypeStrip<T extends string>({ options, value, onChange }: { options: readonly TypeOption<T>[]; value: T; onChange: (next: T) => void }) {
  const c = useRn();
  return (
    <row id="phone-files-types" role="radiogroup" scrollX h={46} mx={-GUTTER} px={GUTTER} gap={20} shrink={false}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <box key={option.value} id={`phone-files-type-${option.value}`} role="radio" label={option.label} selected={selected} focusable minH={46} align="center" shrink={false} pressScale={0.97} onPress={selected ? undefined : () => onChange(option.value)}>
            <text {...LABEL} color={selected ? c.text : c.textWeaker} maxLines={1}>
              {option.label}
            </text>
          </box>
        );
      })}
    </row>
  );
}
