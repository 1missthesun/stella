import { useId, useState } from "react";
import { layer, mix, radius, useTokens, type Style } from "../../theme";
import { Icon, Icons } from "../icons";
import { T } from "./text";

type Segment = "hour" | "minute" | "period";
const SEGMENTS: Segment[] = ["hour", "minute", "period"];
const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
const KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Backspace", "Delete", "a", "p", "A", "P", ...DIGITS];

const parse = (value: string) => {
  const m = value.match(/^(\d{1,2}):(\d{2})/);
  return m ? { h: Math.min(23, +m[1]), m: Math.min(59, +m[2]) } : null;
};
const pad = (n: number) => String(n).padStart(2, "0");
const toValue = (h: number, m: number) => `${pad(h)}:${pad(m)}`;

/** Chromium's `<input type="time">` in an en-US 12-hour locale: `hh : mm AM` segments edited with arrows and digits, and a clock button that opens hour / minute / AM-PM columns. */
export function TimeInput({ value, onValue, disabled, label, id, ...style }: Style & { value: string; onValue: (next: string) => void; disabled?: boolean; label?: string; id?: string }) {
  const t = useTokens();
  const c = t.c;
  const auto = useId();
  const base = id ?? `time${auto}`;
  const [focus, setFocus] = useState<Segment | null>(null);
  const [typed, setTyped] = useState("");
  const [open, setOpen] = useState(false);
  const time = parse(value);
  const h12 = time ? time.h % 12 || 12 : null;
  const period = time ? (time.h < 12 ? "AM" : "PM") : null;

  const set = (h: number, m: number) => onValue(toValue(((h % 24) + 24) % 24, ((m % 60) + 60) % 60));
  const step = (segment: Segment, delta: number) => {
    const cur = time ?? { h: 0, m: 0 };
    if (segment === "hour") set(cur.h + delta, cur.m);
    else if (segment === "minute") set(cur.h, cur.m + delta);
    else set(cur.h + 12, cur.m);
  };
  const typeDigit = (segment: Segment, digit: string) => {
    const cur = time ?? { h: 0, m: 0 };
    const next = typed + digit;
    if (segment === "hour") {
      const n = Math.max(1, Math.min(12, +next));
      const pm = cur.h >= 12;
      set((n % 12) + (pm ? 12 : 0), cur.m);
      if (next.length >= 2 || +next > 1) {
        setTyped("");
        setFocus("minute");
      } else setTyped(next);
    } else if (segment === "minute") {
      set(cur.h, Math.min(59, +next));
      if (next.length >= 2 || +next > 5) {
        setTyped("");
        setFocus("period");
      } else setTyped(next);
    }
  };
  const onKey = (key: string) => {
    if (disabled || !focus) return;
    const i = SEGMENTS.indexOf(focus);
    if (key === "ArrowUp") step(focus, 1);
    else if (key === "ArrowDown") step(focus, -1);
    else if (key === "ArrowRight") setFocus(SEGMENTS[Math.min(2, i + 1)]);
    else if (key === "ArrowLeft") setFocus(SEGMENTS[Math.max(0, i - 1)]);
    else if (DIGITS.includes(key)) typeDigit(focus, key);
    else if (focus === "period" && /^[ap]$/i.test(key)) {
      const cur = time ?? { h: 0, m: 0 };
      const wantPm = key.toLowerCase() === "p";
      if (wantPm !== cur.h >= 12) set(cur.h + 12, cur.m);
    }
  };

  const segment = (name: Segment, text: string) => (
    <T
      id={`${base}-${name}`}
      focusable={!disabled}
      keys={KEYS}
      onKey={(k) => onKey(k.key)}
      onFocus={(focused) => {
        setTyped("");
        setFocus((cur) => (focused ? name : cur === name ? null : cur));
      }}
      onPress={() => {
        if (disabled) return;
        setFocus(name);
        void stella.engine.focus(`${base}-${name}`);
      }}
      fill={focus === name && !disabled ? c.selectFill : undefined}
      color={focus === name && !disabled ? c.selectText : c.foreground}
      radius={2}
      size={14}
      lh={1.43}
      em={-0.01}
      family="sans"
      features="'tnum' 1"
      nowrap
    >
      {text}
    </T>
  );

  return (
    <row id={base} w={120} h={34} pl={13} pr={5} align="center" radius={radius.md} fill={c.background} border={c.border} opacity={disabled ? 0.5 : undefined} label={label} {...style}>
      <row grow={1} shrink minW={0} align="center">
        {segment("hour", h12 === null ? "--" : pad(h12))}
        <T size={14} lh={1.43} family="sans" color={c.foreground} px={1}>:</T>
        {segment("minute", time ? pad(time.m) : "--")}
        <T size={14} family="sans"> </T>
        {segment("period", period ?? "--")}
      </row>
      <box id={`${base}-picker`} w={24} h={24} center radius={radius.sm} hover={disabled ? undefined : mix(c.foreground, 8, "transparent")} onPress={disabled ? undefined : () => setOpen(!open)} label={label}>
        <Icon icon={Icons.stella.Clock} size={15} color={c.foreground} />
      </box>
      {open ? (
        <row anchor={{ to: `${base}-picker`, side: "bottom", align: "end", gap: 4 }} raise={layer.popover} modal={{ clickOutside: true }} onDismiss={() => setOpen(false)} fill={c.popover} border={c.border} radius={radius.md} shadows={t.shadow.lg} pad={5} gap={2} h={220}>
          <TimeColumn values={Array.from({ length: 12 }, (_, i) => pad(i + 1))} selected={h12 === null ? null : pad(h12)} onPick={(v) => set((+v % 12) + ((time?.h ?? 0) >= 12 ? 12 : 0), time?.m ?? 0)} />
          <TimeColumn values={Array.from({ length: 60 }, (_, i) => pad(i))} selected={time ? pad(time.m) : null} onPick={(v) => set(time?.h ?? 0, +v)} />
          <TimeColumn values={["AM", "PM"]} selected={period} onPick={(v) => set(((time?.h ?? 0) % 12) + (v === "PM" ? 12 : 0), time?.m ?? 0)} />
        </row>
      ) : null}
    </row>
  );
}

function TimeColumn({ values, selected, onPick }: { values: string[]; selected: string | null; onPick: (value: string) => void }) {
  const c = useTokens().c;
  return (
    <col w={44} h="full" scrollY gap={1}>
      {values.map((v) => (
        <row key={v} h={26} center radius={radius.sm} fill={v === selected ? c.selectFill : undefined} hover={v === selected ? undefined : mix(c.foreground, 7, "transparent")} onPress={() => onPick(v)}>
          <T size={13} family="sans" color={v === selected ? c.selectText : c.foreground}>{v}</T>
        </row>
      ))}
    </col>
  );
}
