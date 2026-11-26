import { createElement, useImperativeHandle, useLayoutEffect, useRef, type ReactNode } from "react";
import type { BoxProps, InputProps, TextProps } from "../../host/rune-jsx/props";
import { registerFile } from "./files";
import { useHost } from "./host";
import { matchChord, modsOf } from "./registry";
import { textStyle } from "./style";

type Field = HTMLInputElement | HTMLTextAreaElement;

const lineHeightOf = (p: InputProps) => (p.lineHeight && p.lineHeight > 0 ? p.lineHeight : (p.size ?? 13) * 1.25);

function marksOverlay(value: string, marks: NonNullable<InputProps["marks"]>, paintText: boolean): ReactNode[] {
  const sorted = [...marks].filter((m) => m.end > m.start).sort((a, b) => a.start - b.start);
  const out: ReactNode[] = [];
  let at = 0;
  sorted.forEach((m, i) => {
    const start = Math.max(at, m.start);
    if (start > at) out.push(value.slice(at, start));
    if (m.end <= start) return;
    const pad = m.pad ?? 0;
    const vpad = m.vpad ?? 0;
    out.push(createElement("mark", {
      key: i,
      style: {
        background: paintText ? "transparent" : m.bg ?? "transparent",
        color: paintText ? m.color ?? "transparent" : "transparent",
        borderRadius: m.radius ? `${m.radius}px` : undefined,
        padding: pad || vpad ? `${vpad}px ${pad}px` : undefined,
        margin: pad ? `0 ${-pad}px` : undefined,
        boxDecorationBreak: "clone",
      },
    }, value.slice(start, m.end)));
    at = m.end;
  });
  out.push(value.slice(at) + "​");
  return out;
}

/** `<input>`: a native field (textarea when `multiline`), semi-controlled so typing never races a render. */
export function Input(raw: InputProps) {
  const p = raw;
  const field = useRef<Field | null>(null);
  const under = useRef<HTMLDivElement | null>(null);
  const over = useRef<HTMLDivElement | null>(null);
  const latest = useRef(p);
  latest.current = p;
  const reported = useRef<string | null>(null);
  const lines = useRef("");
  const h = useHost({ ...p, onKey: undefined, onPaste: undefined, keys: undefined } as BoxProps, "rin");
  const s = h.props.style;
  textStyle(p as TextProps, s);
  if (p.placeholderColor) s["--ph"] = p.placeholderColor;
  const lh = lineHeightOf(p);
  const multiline = !!p.multiline;

  useImperativeHandle((p as { ref?: React.Ref<unknown> }).ref, () => ({ set() {} }), []);

  const grown = useRef("");
  const grow = (force = false) => {
    const f = field.current;
    if (!f || !(f instanceof HTMLTextAreaElement)) return;
    const q = latest.current;
    const min = (q.minLines ?? 1) * lh;
    const maxByLines = q.maxLines ? q.maxLines * lh : Infinity;
    const maxH = typeof q.maxH === "number" ? q.maxH - (q.pt ?? q.py ?? q.pad ?? 0) - (q.pb ?? q.py ?? q.pad ?? 0) : Infinity;
    const max = Math.min(maxByLines, maxH);
    const inputs = `${f.value}\0${min}\0${max}`;
    if (!force && inputs === grown.current) return;
    grown.current = inputs;
    f.style.height = "0px";
    const content = f.scrollHeight;
    const height = Math.max(min, Math.min(content, max));
    f.style.height = `${height}px`;
    f.classList.toggle("scroll", content > max + 1);
    const count = Math.max(1, Math.round(content / lh));
    const key = `${count}:${height}`;
    if (key !== lines.current) {
      lines.current = key;
      q.onLines?.({ lines: count, height });
    }
  };

  const syncMarks = () => {
    const f = field.current;
    if (!f) return;
    for (const m of [under.current, over.current]) if (m) m.scrollTop = f.scrollTop;
  };

  useLayoutEffect(() => {
    const f = field.current;
    if (!f) return;
    if (p.value !== undefined && p.value !== f.value && p.value !== reported.current) {
      const focused = document.activeElement === f;
      const atEnd = f.selectionStart === f.value.length;
      f.value = p.value;
      if (focused && atEnd) f.setSelectionRange(p.value.length, p.value.length);
    }
    reported.current = null;
    grow();
    syncMarks();
  });

  useLayoutEffect(() => {
    const f = field.current;
    if (!f || !multiline) return;
    let width = -1;
    const ro = new ResizeObserver(([entry]) => {
      const next = entry?.contentRect.width ?? -1;
      if (next === width) return;
      const first = width < 0;
      width = next;
      if (!first) grow(true);
    });
    ro.observe(f.parentElement ?? f);
    return () => ro.disconnect();
  }, [multiline]);

  useLayoutEffect(() => {
    const f = field.current;
    if (!f || !p.onSelection) return;
    let last = "";
    const report = () => {
      if (document.activeElement !== f) return;
      const start = f.selectionStart ?? 0;
      const end = f.selectionEnd ?? start;
      const key = `${start}:${end}`;
      if (key === last) return;
      last = key;
      latest.current.onSelection?.({ start, end });
    };
    document.addEventListener("selectionchange", report);
    f.addEventListener("select", report);
    return () => {
      document.removeEventListener("selectionchange", report);
      f.removeEventListener("select", report);
    };
  }, [!!p.onSelection]);

  const onInput = (e: React.FormEvent<Field>) => {
    const v = e.currentTarget.value;
    reported.current = v;
    grow();
    latest.current.onInput?.(v);
  };

  const onKeyDown = (e: React.KeyboardEvent<Field>) => {
    const q = latest.current;
    const f = e.currentTarget;
    const native = e.nativeEvent;
    if (native.isComposing || native.keyCode === 229) return;
    const chord = matchChord(q.keys, native);
    if (chord) {
      e.preventDefault();
      e.stopPropagation();
      const start = f.selectionStart ?? 0;
      q.onKey?.({ key: e.key, chord, mods: modsOf(e), value: f.value, start, end: f.selectionEnd ?? start, length: f.value.length });
      return;
    }
    if (e.key === "Enter" && q.onSubmit && !(multiline && e.shiftKey) && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      q.onSubmit(f.value);
    }
  };

  const onPaste = (e: React.ClipboardEvent<Field>) => {
    const q = latest.current;
    if (!q.onPaste) return;
    const data = e.clipboardData;
    const files = Array.from(data.files ?? []);
    if (files.length) {
      e.preventDefault();
      const image = files.find((f) => f.type.startsWith("image/"));
      const rest = files.filter((f) => f !== image);
      q.onPaste({ files: rest.map(registerFile), image: image ? registerFile(image) : null, text: "" });
      return;
    }
    const text = data.getData("text/plain");
    const t = q.pasteAsEvent;
    if (t && text && ((t.minChars !== undefined && text.length >= t.minChars) || (t.minLines !== undefined && text.split("\n").length >= t.minLines))) {
      e.preventDefault();
      q.onPaste({ files: [], image: null, text });
    }
  };

  const fieldProps: Record<string, unknown> = {
    ref: field,
    className: "f",
    defaultValue: p.value,
    placeholder: p.placeholder,
    readOnly: p.readOnly,
    disabled: p.disabled,
    spellCheck: p.spellcheck,
    autoFocus: p.autoFocus,
    "aria-label": p.label ?? p.placeholder,
    style: { caretColor: p.caretColor, lineHeight: `${lh}px` },
    onInput,
    onKeyDown,
    onPaste,
    onScroll: p.marks?.length ? syncMarks : undefined,
    onFocus: p.selectOnFocus ? (e: React.FocusEvent<Field>) => e.currentTarget.select() : undefined,
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
  };
  if (!multiline) {
    fieldProps.type = p.secure ? "password" : "text";
    fieldProps.autoComplete = p.secure ? "current-password" : "off";
  } else fieldProps.rows = p.minLines ?? 1;

  const marks = p.marks?.length ? p.marks : null;
  const inset = `${p.pt ?? p.py ?? p.pad ?? 0}px ${p.pr ?? p.px ?? p.pad ?? 0}px ${p.pb ?? p.py ?? p.pad ?? 0}px ${p.pl ?? p.px ?? p.pad ?? 0}px`;
  const value = field.current?.value ?? p.value ?? "";
  const children: ReactNode[] = [];
  if (marks) children.push(createElement("div", { key: "u", ref: under, className: "mk", "aria-hidden": true, style: { inset, lineHeight: `${lh}px` } }, marksOverlay(value, marks, false)));
  children.push(createElement(multiline ? "textarea" : "input", { key: "f", ...fieldProps }));
  if (marks?.some((m) => m.color)) children.push(createElement("div", { key: "o", ref: over, className: "mk", "aria-hidden": true, style: { inset, lineHeight: `${lh}px` } }, marksOverlay(value, marks, true)));
  h.props.onClick = () => field.current?.focus();
  return h.wrap(createElement("div", { ...h.props, "data-input": "" }, children));
}
