// Draws a Stella View's node tree (packages/views/src/protocol.ts) with Rune elements and Stella's
// kit, so views look like the rest of Stella and follow its theme. Handlers in the tree are ids;
// every event goes back to the view's program through `dispatch`. The same file renders on the
// web through the DOM host.
import { createContext, memo, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { ViewChild, ViewNode } from "@stella/views/protocol";
import { Button, Dialog, DialogBody, DialogCloseButton, DialogHeader, DialogTitle, Icon, Icons, ImageLightbox, Markdown, Select, Switch, Tabs, TextField, type IconData } from "../kit";
import { font, fontSize, hex, look, mix, radius as radii, useTokens, type Tokens } from "../theme";
import type { Cursor } from "../rune";
import { ViewCanvas } from "./ViewCanvas";
import { ViewChart } from "./ViewChart";
import { ViewTable } from "./ViewTable";

type Dispatch = (handler: number, value?: unknown) => void;
type Ctx = { dispatch: Dispatch; scope: string; icons?: boolean };
const RenderCtx = createContext<Ctx>({ dispatch: () => {}, scope: "view" });
/** True for the direct children of a Row: there a field, slider or bar with no width shares the row instead of filling it. */
const InRow = createContext(false);
const fillMain = (width: unknown, inRow: boolean) => {
  const w = size(width);
  if (w !== undefined) return { w };
  return inRow ? { grow: 1, basis: 0, minW: 0 } : { w: "full" as const };
};

// ------------------------------------------------------------------ props → elements

export type Paint = (value: unknown) => string | undefined;

export function paintFor(t: Tokens): Paint {
  const c = t.c;
  const named: Record<string, string> = {
    text: c.foreground,
    muted: c.textWeak,
    accent: c.interactive,
    danger: c.destructive,
    success: c.success,
    warning: c.warning,
    surface: c.card,
    subtle: mix(c.foreground, 5, c.background),
    border: c.border,
    background: c.background,
  };
  return (value) => {
    if (typeof value !== "string" || !value) return undefined;
    const token = named[value];
    if (token) return token;
    try {
      return hex(value);
    } catch {
      return value;
    }
  };
}

const RADIUS: Record<string, number> = { sm: radii.sm, md: radii.md, lg: radii.lg, xl: radii.xl, full: radii.full };
const size = (v: unknown) => (typeof v === "number" || (typeof v === "string" && (v === "full" || v === "fit" || /^\d+(\.\d+)?%$/u.test(v))) ? (v as number | "full" | "fit" | `${number}%`) : undefined);

function boxProps(p: Record<string, unknown>, t: Tokens, paint: Paint): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof p.gap === "number") out.gap = p.gap;
  const pad = p.padding;
  if (typeof pad === "number") out.pad = pad;
  else if (Array.isArray(pad) && pad.length === 2) Object.assign(out, { py: pad[0], px: pad[1] });
  else if (Array.isArray(pad) && pad.length === 4) Object.assign(out, { pt: pad[0], pr: pad[1], pb: pad[2], pl: pad[3] });
  if (p.align === "baseline") out.align = "end";
  else if (typeof p.align === "string") out.align = p.align;
  if (typeof p.justify === "string") out.justify = p.justify;
  if (p.wrap) out.wrap = true;
  if (typeof p.grow === "number") out.grow = p.grow;
  if (p.shrink === 0 || p.shrink === false) out.shrink = false;
  for (const [from, to] of [["width", "w"], ["height", "h"], ["minWidth", "minW"], ["maxWidth", "maxW"], ["minHeight", "minH"], ["maxHeight", "maxH"]] as const) {
    const v = size(p[from]);
    if (v !== undefined) out[to] = v;
  }
  if (typeof p.aspect === "number") out.aspect = p.aspect;
  const fill = paint(p.background);
  if (fill) out.fill = fill;
  if (typeof p.radius === "number") out.radius = p.radius;
  else if (typeof p.radius === "string" && RADIUS[p.radius] !== undefined) out.radius = RADIUS[p.radius];
  if (p.border === true) out.border = t.c.border;
  else if (typeof p.border === "string") out.border = paint(p.border);
  if (p.shadow === "sm" || p.shadow === "md" || p.shadow === "lg") out.shadows = t.shadow[p.shadow];
  if (typeof p.opacity === "number") out.opacity = p.opacity;
  if (p.hidden) out.hidden = true;
  if (p.animate) {
    out.motion = { dur: 0.3, bounce: 0.1 };
    out.layout = 0.3;
  }
  if (typeof p.enter === "string") out.enter = p.enter;
  if (typeof p.exit === "string") out.exit = p.exit;
  if (typeof p.tooltip === "string") out.title = p.tooltip;
  return out;
}

// ------------------------------------------------------------------ text

const TEXT_VARIANTS = {
  display: look(fontSize["4xl"], 600, { lh: 1.15, em: -0.02 }),
  title: look(fontSize["3xl"], 600, { lh: 1.2, em: -0.02 }),
  heading: look(fontSize.xl, 600, { lh: 1.3 }),
  subheading: look(fontSize.lg, 500, { lh: 1.4 }),
  body: look(fontSize.md, 400, { lh: 1.5 }),
  label: look(fontSize.sm, font.emphasisWeight, { lh: 1.4 }),
  caption: look(fontSize.sm, 400, { lh: 1.4 }),
  mono: look(fontSize.sm, 400, { lh: 1.5, em: 0, family: font.mono }),
} as const;

type Run = { t: string; w?: number; c?: string; m?: boolean; i?: boolean; u?: string; st?: boolean; s?: number; href?: string };

function textRuns(children: ViewChild[] | undefined, paint: Paint, inherited: Omit<Run, "t">, out: Run[]) {
  for (const child of children ?? []) {
    if (typeof child === "string") {
      out.push({ t: child, ...inherited });
      continue;
    }
    if (child.t !== "Text") continue;
    const p = child.p ?? {};
    const run: Omit<Run, "t"> = { ...inherited };
    if (typeof p.weight === "number") run.w = p.weight;
    const color = paint(p.color);
    if (color) run.c = color;
    if (p.mono) run.m = true;
    if (p.italic) run.i = true;
    if (p.strike) run.st = true;
    if (typeof p.size === "number") run.s = p.size;
    if (typeof p.href === "string") {
      run.href = p.href;
      run.u = run.c ?? paint("accent");
      run.c = run.c ?? paint("accent");
    } else if (p.underline) run.u = run.c ?? paint("text");
    textRuns(child.c, paint, run, out);
  }
}

function ViewText({ node, paint, t }: { node: ViewNode; paint: Paint; t: Tokens }) {
  const p = node.p ?? {};
  const variant = TEXT_VARIANTS[(p.variant as keyof typeof TEXT_VARIANTS) ?? "body"] ?? TEXT_VARIANTS.body;
  const color = paint(p.color) ?? (p.variant === "caption" ? t.c.textWeak : t.c.foreground);
  const nested = (node.c ?? []).some((c) => typeof c !== "string");
  const style: Record<string, unknown> = {
    ...variant,
    color,
    ...(typeof p.size === "number" ? { size: p.size, lineHeight: Math.round(p.size * 1.45) } : {}),
    ...(typeof p.weight === "number" ? { weight: p.weight } : {}),
    ...(p.italic ? { italic: true } : {}),
    ...(p.underline ? { underline: true } : {}),
    ...(p.strike ? { strike: true } : {}),
    ...(p.mono ? { family: font.mono, tracking: 0 } : {}),
    ...(typeof p.align === "string" ? { textAlign: p.align } : {}),
    ...(typeof p.lines === "number" ? { maxLines: p.lines, truncate: true } : {}),
    ...(p.selectable ? { selectable: true } : {}),
    ...(typeof p.grow === "number" ? { grow: p.grow } : {}),
    ...(size(p.width) !== undefined ? { w: size(p.width) } : {}),
    ...(size(p.maxWidth) !== undefined ? { maxW: size(p.maxWidth) } : {}),
    ...(p.hidden ? { hidden: true } : {}),
  };
  if (nested || typeof p.href === "string") {
    const runs: Run[] = [];
    textRuns([node], paint, {}, runs);
    return <text {...style} spans={runs} onLink={(href: string) => void (globalThis as { stella?: { engine?: { shell: { openExternal(u: string): Promise<void> } } } }).stella?.engine?.shell.openExternal(href)} />;
  }
  return <text {...style}>{(node.c ?? []).join("")}</text>;
}

// ------------------------------------------------------------------ icons

// Stella's own drawn icons win where they cover a name; every other Lucide name comes from the
// shared catalog in @stella/views, loaded the first time a view mounts and kept after.
type IconCatalog = typeof import("@stella/views/icons");
let catalog: IconCatalog | null = null;
let catalogLoad: Promise<void> | null = null;
const catalogListeners = new Set<() => void>();
function loadIconCatalog(): void {
  catalogLoad ??= import("@stella/views/icons").then((mod) => {
    catalog = mod;
    for (const listener of catalogListeners) listener();
  });
}
const subscribeCatalog = (listener: () => void) => {
  catalogListeners.add(listener);
  return () => void catalogListeners.delete(listener);
};
const catalogReady = () => catalog !== null;

let kitIndex: Map<string, IconData> | null = null;
const lucideIcons = new Map<string, IconData>();
export function iconNamed(name: unknown): IconData | null {
  if (typeof name !== "string" || !name.trim()) return null;
  if (!kitIndex) {
    kitIndex = new Map();
    for (const group of Object.values(Icons) as Record<string, IconData>[]) {
      if (!group || typeof group !== "object") continue;
      for (const [key, icon] of Object.entries(group)) {
        if (!icon || typeof icon !== "object" || !("body" in icon)) continue;
        const kebab = key.replace(/([a-z0-9])([A-Z])/gu, "$1-$2").replace(/([A-Za-z])(\d)/gu, "$1-$2").toLowerCase();
        if (!kitIndex.has(kebab)) kitIndex.set(kebab, icon);
      }
    }
  }
  const key = name.trim().toLowerCase().replace(/[\s_]+/gu, "-");
  const own = kitIndex.get(key);
  if (own) return own;
  if (!catalog) return null;
  const lucide = catalog.viewIconName(name);
  if (!lucide) return null;
  const kit = kitIndex.get(lucide);
  if (kit) return kit;
  let icon = lucideIcons.get(lucide);
  if (!icon) {
    icon = { name: `lucide/${lucide}`, view: 24, body: `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${catalog.VIEW_ICONS[lucide]}</g>` };
    lucideIcons.set(lucide, icon);
  }
  return icon;
}

// ------------------------------------------------------------------ nodes

const optionList = (options: unknown): { value: string; label: string }[] =>
  Array.isArray(options) ? options.map((o) => (typeof o === "string" ? { value: o, label: o } : { value: String((o as { value: unknown }).value), label: String((o as { label?: unknown }).label ?? (o as { value: unknown }).value) })) : [];

function slot(value: unknown): ViewChild[] | null {
  return value && typeof value === "object" && Array.isArray((value as { $slot?: unknown }).$slot) ? ((value as { $slot: ViewChild[] }).$slot) : null;
}

function Children({ nodes, path }: { nodes: ViewChild[] | undefined; path: string }) {
  if (!nodes || nodes.length === 0) return null;
  return (
    <>
      {nodes.map((child, i) => (
        <ViewNodeView key={typeof child === "string" ? `s${i}` : child.k !== undefined ? `k${String(child.k)}` : `${child.t}${i}`} node={child} path={`${path}.${child && typeof child !== "string" && child.k !== undefined ? `k${String(child.k)}` : i}`} />
      ))}
    </>
  );
}

export const ViewNodeView = memo(function ViewNodeView({ node, path }: { node: ViewChild; path: string }) {
  const t = useTokens();
  const paint = useMemo(() => paintFor(t), [t]);
  const { dispatch, scope } = useContext(RenderCtx);
  if (typeof node === "string") {
    return <text {...TEXT_VARIANTS.body} color={t.c.foreground}>{node}</text>;
  }
  const p = node.p ?? {};
  const h = node.h ?? {};
  const fire = (name: string) => (h[name] !== undefined ? (value?: unknown) => dispatch(h[name]!, value) : undefined);
  const id = `${scope}${path}`;
  const inRow = useContext(InRow);
  const kids = (
    <InRow.Provider value={node.t === "Row"}>
      <Children nodes={node.c} path={path} />
    </InRow.Provider>
  );
  switch (node.t) {
    case "Column":
      return <col {...boxProps(p, t, paint)}>{kids}</col>;
    case "Row":
      return <row {...boxProps({ align: "center", ...p }, t, paint)}>{kids}</row>;
    case "Stack":
      return (
        <col {...boxProps(p, t, paint)}>
          {(node.c ?? []).map((child, i) =>
            i === 0 ? (
              <ViewNodeView key={i} node={child} path={`${path}.${i}`} />
            ) : (
              <col key={i} absolute={{ left: 0, top: 0, right: 0, bottom: 0 }}>
                <ViewNodeView node={child} path={`${path}.${i}`} />
              </col>
            ),
          )}
        </col>
      );
    case "Grid":
      return (
        <col {...boxProps(p, t, paint)} columns={Math.max(1, Math.round(Number(p.columns) || 2))} rowGap={typeof p.gap === "number" ? p.gap : undefined}>
          {kids}
        </col>
      );
    case "Scroll":
      return (
        <col {...boxProps({ grow: p.height === undefined && p.maxHeight === undefined ? 1 : undefined, ...p }, t, paint)} {...(p.horizontal ? { scrollX: true } : { scrollY: true })} {...(p.stickToBottom ? { stickBottom: true } : {})} minH={0}>
          {p.horizontal ? <row gap={typeof p.gap === "number" ? p.gap : undefined}>{kids}</row> : kids}
        </col>
      );
    case "Spacer":
      return typeof p.size === "number" ? <box w={p.size} h={p.size} /> : <box grow={1} />;
    case "Divider":
      return p.vertical ? <box w={1} selfAlign="stretch" fill={t.c.border} /> : <box h={1} w="full" fill={t.c.border} />;
    case "Pressable": {
      const press = fire("onPress");
      return (
        <col
          {...boxProps(p, t, paint)}
          {...(press && !p.disabled ? { onPress: () => press(), cursor: ((p.cursor as Cursor | undefined) ?? "pointer") } : p.cursor ? { cursor: p.cursor as Cursor } : {})}
          {...(fire("onDoublePress") ? { onDoublePress: () => fire("onDoublePress")!() } : {})}
          {...(fire("onLongPress") ? { onContextMenu: () => fire("onLongPress")!() } : {})}
          {...(fire("onHover") ? { onHover: (inside: boolean) => fire("onHover")!(inside) } : {})}
          {...(fire("onDrag") ? { onDrag: (d: unknown) => fire("onDrag")!(d) } : {})}
          {...(paint(p.hoverBackground) ? { hoverFill: paint(p.hoverBackground) } : press ? { hoverFill: mix(t.c.foreground, 5, "transparent") } : {})}
          {...(paint(p.pressBackground) ? { pressFill: paint(p.pressBackground) } : press ? { pressFill: mix(t.c.foreground, 9, "transparent") } : {})}
          {...(p.disabled ? { opacity: 0.5 } : {})}
        >
          {kids}
        </col>
      );
    }
    case "Text":
      return <ViewText node={node} paint={paint} t={t} />;
    case "Markdown":
      return <Markdown id={id} text={(node.c ?? []).filter((c) => typeof c === "string").join("")} />;
    case "Image":
      return <ViewImage id={id} p={p} t={t} />;
    case "Icon": {
      const icon = iconNamed(p.name);
      return icon ? <Icon icon={icon} size={typeof p.size === "number" ? p.size : 16} color={paint(p.color) ?? t.c.foreground} /> : <box w={typeof p.size === "number" ? p.size : 16} h={typeof p.size === "number" ? p.size : 16} />;
    }
    case "Code":
      return (
        <col fill={mix(t.c.foreground, 5, t.c.background)} radius={radii.md} px={12} py={10} scrollX>
          <text {...TEXT_VARIANTS.mono} color={t.c.foreground} selectable nowrap>
            {(node.c ?? []).filter((c) => typeof c === "string").join("")}
          </text>
        </col>
      );
    case "Video":
      return <video src={String(p.src ?? "")} {...boxProps({ width: "full", ...p }, t, paint)} fit={(p.fit as "cover" | "contain") ?? "contain"} {...(p.autoplay ? { autoplay: true } : {})} {...(p.muted ? { muted: true } : {})} {...(p.loop ? { loopMedia: true } : {})} />;
    case "Audio":
      return <audio src={String(p.src ?? "")} {...(p.autoplay ? { autoplay: true } : {})} {...(p.loop ? { loopMedia: true } : {})} />;
    case "Progress":
      return <ViewProgress p={p} t={t} paint={paint} />;
    case "Button": {
      const press = fire("onPress");
      const label = (node.c ?? []).filter((c) => typeof c === "string").join("");
      const variant = p.variant === "primary" || p.variant === "ghost" ? p.variant : p.variant === "danger" ? "primary" : "secondary";
      const icon = iconNamed(p.icon);
      const iconRight = iconNamed(p.iconRight);
      return (
        <Button id={id} variant={variant} size={(p.size as "small" | "normal" | "large") ?? "normal"} disabled={Boolean(p.disabled)} {...(icon ? { icon } : {})} {...(iconRight ? { iconRight } : {})} {...(typeof p.tooltip === "string" ? { title: p.tooltip } : {})} {...(p.fullWidth ? { w: "full" as const } : {})} {...(press ? { onPress: () => press() } : {})}>
          {label || undefined}
        </Button>
      );
    }
    case "TextField": {
      const change = fire("onChange");
      const submit = fire("onSubmit");
      return (
        <col {...(p.grow ? boxProps({ width: p.width, grow: p.grow }, t, paint) : fillMain(p.width, inRow))}>
          <TextField id={id} value={String(p.value ?? "")} {...(typeof p.placeholder === "string" ? { placeholder: p.placeholder } : {})} {...(typeof p.label === "string" ? { label: p.label } : {})} {...(typeof p.error === "string" ? { error: p.error } : {})} multiline={Boolean(p.multiline)} secure={Boolean(p.secure)} disabled={Boolean(p.disabled)} autoFocus={Boolean(p.autoFocus)} onValueChange={(v) => change?.(v)} onSubmit={(v) => submit?.(v)} />
        </col>
      );
    }
    case "Checkbox":
      return <ViewCheckbox id={id} p={p} t={t} onChange={fire("onChange")} />;
    case "Switch": {
      const change = fire("onChange");
      return <Switch id={id} checked={Boolean(p.checked)} {...(typeof p.label === "string" ? { label: p.label } : { hideLabel: true, label: "" })} {...(typeof p.description === "string" ? { description: p.description } : {})} disabled={Boolean(p.disabled)} onCheckedChange={(v) => change?.(v)} />;
    }
    case "Slider":
      return <ViewSlider id={id} p={p} t={t} onChange={fire("onChange")} />;
    case "Select":
      return <ViewSelect id={id} p={p} onChange={fire("onChange")} />;
    case "Segmented":
      return <ViewSegmented id={id} p={p} t={t} onChange={fire("onChange")} />;
    case "Tabs": {
      const change = fire("onChange");
      return <Tabs id={id} value={String(p.value ?? "")} items={optionList(p.tabs)} onValueChange={(v) => change?.(v)} />;
    }
    case "Disclosure":
      return <ViewDisclosure p={p} t={t} onToggle={fire("onToggle")}>{kids}</ViewDisclosure>;
    case "Modal": {
      const close = fire("onClose");
      return (
        <Dialog id={id} open={Boolean(p.open)} onOpenChange={(open) => (!open ? close?.() : undefined)} size={p.size === "lg" ? "lg" : p.size === "xl" ? "xl" : "md"} fit label={typeof p.title === "string" ? p.title : "Dialog"}>
          <DialogHeader>
            <DialogTitle>{typeof p.title === "string" ? p.title : ""}</DialogTitle>
            <DialogCloseButton id={`${id}-close`} onPress={() => close?.()} />
          </DialogHeader>
          <DialogBody>
            <col px={24} pb={20} gap={14}>
              {kids}
            </col>
          </DialogBody>
        </Dialog>
      );
    }
    case "Table":
      return <ViewTable id={id} node={node} paint={paint} onRowPress={fire("onRowPress")} renderSlot={(nodes, key) => <Children nodes={nodes} path={`${path}.${key}`} />} />;
    case "List":
      return <ViewList id={id} node={node} path={path} t={t} />;
    case "Chart":
      return <ViewChart p={p} paint={paint} />;
    case "Canvas":
      return <ViewCanvas p={p} paint={paint} onPointer={fire("onPointer")} />;
    default:
      return kids;
  }
});

function ViewImage({ id, p, t }: { id: string; p: Record<string, unknown>; t: Tokens }) {
  const [open, setOpen] = useState(false);
  const src = String(p.src ?? "");
  const r = typeof p.radius === "number" ? p.radius : typeof p.radius === "string" ? RADIUS[p.radius] : undefined;
  return (
    <>
      <image
        src={src}
        fit={(p.fit as "cover" | "contain") ?? "cover"}
        {...(size(p.width) !== undefined ? { w: size(p.width) } : {})}
        {...(size(p.height) !== undefined ? { h: size(p.height) } : {})}
        {...(size(p.maxWidth) !== undefined ? { maxW: size(p.maxWidth) } : { maxW: "full" })}
        {...(size(p.maxHeight) !== undefined ? { maxH: size(p.maxHeight) } : {})}
        {...(typeof p.aspect === "number" ? { aspect: p.aspect } : {})}
        {...(r !== undefined ? { radius: r, clip: r } : {})}
        {...(p.border ? { border: t.c.border } : {})}
        {...(p.zoomable ? { onPress: () => setOpen(true), cursor: "zoomIn" } : {})}
        {...(typeof p.alt === "string" ? { label: p.alt } : {})}
      />
      {p.zoomable ? <ImageLightbox id={`${id}-zoom`} open={open} onOpenChange={setOpen} src={src} {...(typeof p.alt === "string" ? { alt: p.alt } : {})} /> : null}
    </>
  );
}

function ViewProgress({ p, t, paint }: { p: Record<string, unknown>; t: Tokens; paint: Paint }) {
  const inRow = useContext(InRow);
  const value = typeof p.value === "number" ? Math.max(0, Math.min(1, p.value)) : null;
  const color = paint(p.color) ?? t.c.interactive;
  return (
    <box {...fillMain(p.width, inRow)} h={4} radius={2} fill={mix(t.c.foreground, 10, "transparent")} clip={2}>
      {value === null ? <box w="30%" h={4} radius={2} fill={color} loop={{ kind: "sequence", period: 1.4, ease: "easeInOut", frames: [{ at: 0, x: -120 }, { at: 1, x: 420 }] }} /> : <box w={`${Math.round(value * 1000) / 10}%`} h={4} radius={2} fill={color} motion={{ dur: 0.25, bounce: 0 }} />}
    </box>
  );
}

function ViewCheckbox({ id, p, t, onChange }: { id: string; p: Record<string, unknown>; t: Tokens; onChange?: (v: unknown) => void }) {
  const checked = Boolean(p.checked);
  const disabled = Boolean(p.disabled);
  return (
    <row id={id} gap={8} align="center" role="checkbox" checked={checked} focusable={!disabled} {...(!disabled ? { onPress: () => onChange?.(!checked), cursor: "pointer" } : { opacity: 0.5 })}>
      <box w={16} h={16} radius={4} center fill={checked ? t.c.primary : t.c.background} border={checked ? t.c.primary : t.c.border} borderWidth={1}>
        {checked ? <Icon icon={Icons.stella.Check} size={12} color={t.c.primaryForeground} strokeWidth={3} /> : null}
      </box>
      {typeof p.label === "string" ? <text {...TEXT_VARIANTS.body} color={t.c.foreground}>{p.label}</text> : null}
    </row>
  );
}

function ViewSlider({ id, p, t, onChange }: { id: string; p: Record<string, unknown>; t: Tokens; onChange?: (v: unknown) => void }) {
  const inRow = useContext(InRow);
  const min = typeof p.min === "number" ? p.min : 0;
  const max = typeof p.max === "number" ? p.max : 1;
  const step = typeof p.step === "number" && p.step > 0 ? p.step : (max - min) / 100;
  const value = Math.max(min, Math.min(max, typeof p.value === "number" ? p.value : min));
  const [width, setWidth] = useState(0);
  const [startValue, setStartValue] = useState(value);
  const frac = max > min ? (value - min) / (max - min) : 0;
  const snap = (v: number) => Math.max(min, Math.min(max, Math.round((v - min) / step) * step + min));
  const disabled = Boolean(p.disabled);
  return (
    <col {...fillMain(p.width, inRow)} gap={6}>
      {typeof p.label === "string" ? (
        <row justify="between">
          <text {...TEXT_VARIANTS.label} color={t.c.mutedForeground}>{p.label}</text>
          <text {...TEXT_VARIANTS.caption} color={t.c.textWeak}>{Math.round(value * 100) / 100}</text>
        </row>
      ) : null}
      <box
        id={id}
        h={20}
        w="full"
        align="center"
        role="slider"
        focusable={!disabled}
        keys={["ArrowLeft", "ArrowRight"]}
        onKey={(e: { key: string }) => onChange?.(snap(value + (e.key === "ArrowRight" ? step : -step)))}
        onLayout={(r: { w: number }) => setWidth(r.w)}
        {...(disabled
          ? { opacity: 0.5 }
          : {
              cursor: "pointer",
              onDrag: (d: { phase: string; dx: number; x: number }) => {
                if (width <= 0) return;
                if (d.phase === "start") {
                  const at = snap(min + (d.x / width) * (max - min));
                  setStartValue(at);
                  onChange?.(at);
                  return;
                }
                onChange?.(snap(startValue + (d.dx / width) * (max - min)));
              },
            })}
      >
        <box w="full" h={4} radius={2} fill={mix(t.c.foreground, 12, "transparent")}>
          <box w={`${Math.round(frac * 1000) / 10}%`} h={4} radius={2} fill={t.c.primary} />
        </box>
        <box absolute={{ left: Math.max(0, frac * width - 8), top: 2 }} w={16} h={16} radius={8} fill={t.c.background} border={t.c.border} borderWidth={1} shadows={t.shadow.sm} />
      </box>
    </col>
  );
}

function ViewSelect({ id, p, onChange }: { id: string; p: Record<string, unknown>; onChange?: (v: unknown) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Select
      id={id}
      value={String(p.value ?? "")}
      options={optionList(p.options)}
      open={open}
      onOpenChange={setOpen}
      w={typeof p.width === "number" || p.width === "full" ? p.width : "fit"}
      minW={160}
      disabled={Boolean(p.disabled)}
      {...(typeof p.placeholder === "string" ? { placeholder: p.placeholder } : {})}
      {...(typeof p.label === "string" ? { label: p.label } : {})}
      onValueChange={(v) => onChange?.(v)}
    />
  );
}

function ViewSegmented({ id, p, t, onChange }: { id: string; p: Record<string, unknown>; t: Tokens; onChange?: (v: unknown) => void }) {
  const value = String(p.value ?? "");
  const text = look(fontSize.sm, font.emphasisWeight, { lh: 1.4 });
  return (
    <row id={id} role="radiogroup" pad={2} gap={2} radius={radii.md} fill={mix(t.c.foreground, 6, t.c.background)} focusGroup>
      {optionList(p.options).map((o) => {
        const on = o.value === value;
        return (
          <box key={o.value} grow={1} h={24} px={10} center radius={radii.sm} role="radio" checked={on} focusable cursor="pointer" fill={on ? t.c.background : undefined} shadows={on ? t.shadow.xsBorder : undefined} hoverFill={on ? undefined : mix(t.c.foreground, 5, "transparent")} onPress={() => (on ? undefined : onChange?.(o.value))} motion={{ dur: 0.2, bounce: 0 }}>
            <text {...text} color={on ? t.c.foreground : t.c.textWeak} nowrap>{o.label}</text>
          </box>
        );
      })}
    </row>
  );
}

function ViewDisclosure({ p, t, onToggle, children }: { p: Record<string, unknown>; t: Tokens; onToggle?: (v: unknown) => void; children: ReactNode }) {
  const [local, setLocal] = useState(Boolean(p.defaultOpen));
  const controlled = typeof p.open === "boolean";
  const open = controlled ? (p.open as boolean) : local;
  const toggle = () => {
    if (!controlled) setLocal(!open);
    onToggle?.(!open);
  };
  return (
    <col w="full">
      <row gap={6} py={6} align="center" cursor="pointer" role="button" expanded={open} focusable onPress={toggle}>
        <box rotate={open ? Math.PI / 2 : 0} motion={{ dur: 0.2, bounce: 0 }}>
          <Icon icon={Icons.stella.ChevronRight} size={14} color={t.c.textWeak} />
        </box>
        <text {...TEXT_VARIANTS.label} size={fontSize.md} color={t.c.foreground}>{String(p.title ?? "")}</text>
      </row>
      {open ? (
        <col pl={20} pt={4} pb={8} gap={8} enter="fade">
          {children}
        </col>
      ) : null}
    </col>
  );
}

function ViewList({ id, node, path, t }: { id: string; node: ViewNode; path: string; t: Tokens }) {
  const p = node.p ?? {};
  const rows = (Array.isArray(p.rows) ? p.rows : []) as ViewChild[][];
  const keys = (Array.isArray(p.rowKeys) ? p.rowKeys : []) as (string | number)[];
  const gap = typeof p.gap === "number" ? p.gap : 0;
  const bounded = p.height !== undefined || typeof p.grow === "number";
  const body = rows.map((row, i) => (
    <col key={String(keys[i] ?? i)} id={`${id}/r${String(keys[i] ?? i)}`} w="full" pb={i < rows.length - 1 ? gap : 0}>
      {p.dividers && i > 0 ? <box h={1} w="full" fill={t.c.border} mb={gap} /> : null}
      <Children nodes={row} path={`${path}.r${String(keys[i] ?? i)}`} />
    </col>
  ));
  if (!bounded) return <col w="full">{body}</col>;
  return (
    <col id={`${id}-scroll`} scrollY w="full" minH={0} {...(size(p.height) !== undefined ? { h: size(p.height) } : {})} {...(typeof p.grow === "number" ? { grow: p.grow } : {})}>
      <list estimate={typeof p.estimatedItemHeight === "number" ? p.estimatedItemHeight : 44} overscan={[6, 10]} growth={false}>
        {body}
      </list>
    </col>
  );
}

export function slotNodes(value: unknown): ViewChild[] | null {
  return slot(value);
}

/** The whole view: the tree, scrolled when taller than its room, with the dispatch context. */
export function ViewRoot({ tree, dispatch, scope, onSize, maxHeight }: { tree: ViewChild | null; dispatch: Dispatch; scope: string; onSize?: (w: number, h: number) => void; maxHeight?: number }) {
  useEffect(loadIconCatalog, []);
  // The catalog arriving re-renders every node through the context, past their memo.
  const icons = useSyncExternalStore(subscribeCatalog, catalogReady);
  const ctx = useMemo(() => ({ dispatch, scope, icons }), [dispatch, scope, icons]);
  // In the panel the view fills its room; elsewhere (a chat card) it is as tall as its content
  // up to maxHeight, then scrolls.
  const sizing = maxHeight === undefined ? { grow: 1, minH: 0 } : { maxH: maxHeight };
  return (
    <RenderCtx.Provider value={ctx}>
      <col id={`${scope}-root`} {...sizing} w="full" scrollY {...(onSize ? { onLayout: (r: { w: number; h: number }) => onSize(r.w, r.h) } : {})}>
        {tree === null ? null : <ViewNodeView node={tree} path="" />}
      </col>
    </RenderCtx.Provider>
  );
}
