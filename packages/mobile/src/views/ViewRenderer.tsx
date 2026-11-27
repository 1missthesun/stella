import { createContext, memo, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
  type ImageStyle,
  type LayoutChangeEvent,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeInRight,
  FadeInUp,
  FadeOut,
  FadeOutDown,
  FadeOutLeft,
  FadeOutUp,
  LinearTransition,
  ZoomIn,
  ZoomOut,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import Svg, { Path } from "react-native-svg";
import type { ViewChild, ViewNode } from "@stella/views/protocol";
import { centreViewContent } from "@stella/views/layout";
import { AssistantMarkdown } from "../components/AssistantMarkdown";
import { AudioPlayerView } from "../components/AudioPlayerView";
import { SegmentedControl } from "../components/SegmentedControl";
import { SideScroller } from "../components/SideScroller";
import { Text } from "../components/Text";
import { VideoPlayerView } from "../components/VideoPlayerView";
import { ZoomableImageView } from "../components/ZoomableImageView";
import { openWebLink } from "../lib/open-web-link";
import type { Colors } from "../theme/colors";
import { fonts } from "../theme/fonts";
import { ViewCanvas } from "./ViewCanvas";
import { ViewChart } from "./ViewChart";
import { ViewIcon } from "./ViewIcon";
import { ViewTable } from "./ViewTable";
import { boxStyle, familyFor, mix, optionList, paintFor, radiusOf, sizeOf, textOf, variantStyle, type Paint } from "./view-style";

type Dispatch = (handler: number, value?: unknown) => void;
type Ctx = { dispatch: Dispatch; colors: Colors; paint: Paint; dark: boolean; modals: boolean };
const RenderCtx = createContext<Ctx | null>(null);
const InRow = createContext(false);

const useRender = () => useContext(RenderCtx)!;

/** In a Row a field, slider or bar with no width shares the row; elsewhere it fills the width. */
const fillMain = (width: unknown, inRow: boolean): ViewStyle => {
  const w = sizeOf(width);
  if (w !== undefined) return { width: w };
  return inRow ? { flexGrow: 1, flexBasis: 0, minWidth: 0 } : { alignSelf: "stretch" };
};

const openLink = (href: string) => {
  if (/^https?:/iu.test(href)) void openWebLink(href);
};

// ------------------------------------------------------------------ motion

const ENTER = {
  fade: FadeIn.duration(220),
  rise: FadeInDown.duration(260),
  drop: FadeInUp.duration(260),
  scale: ZoomIn.duration(220),
  pop: ZoomIn.springify().damping(14),
  slide: FadeInRight.duration(260),
} as const;
const EXIT = {
  fade: FadeOut.duration(180),
  rise: FadeOutUp.duration(200),
  drop: FadeOutDown.duration(200),
  scale: ZoomOut.duration(180),
  pop: ZoomOut.duration(160),
  slide: FadeOutLeft.duration(200),
} as const;
const LAYOUT = LinearTransition.springify().damping(22).stiffness(220);

function Box({ p, style, children }: { p: Record<string, unknown>; style: ViewStyle | ViewStyle[]; children?: ReactNode }) {
  const enter = typeof p.enter === "string" ? ENTER[p.enter as keyof typeof ENTER] : undefined;
  const exit = typeof p.exit === "string" ? EXIT[p.exit as keyof typeof EXIT] : undefined;
  const label = typeof p.tooltip === "string" ? p.tooltip : undefined;
  if (!enter && !exit && !p.animate) {
    return (
      <View style={style} accessibilityLabel={label}>
        {children}
      </View>
    );
  }
  return (
    <Animated.View style={style} entering={enter} exiting={exit} layout={p.animate ? LAYOUT : undefined} accessibilityLabel={label}>
      {children}
    </Animated.View>
  );
}

// ------------------------------------------------------------------ children

const childKey = (child: ViewChild, i: number) => (typeof child === "string" ? `s${i}` : child.k !== undefined ? `k${String(child.k)}` : `${child.t}${i}`);

export function ViewChildren({ nodes }: { nodes: ViewChild[] | undefined }) {
  if (!nodes || nodes.length === 0) return null;
  return (
    <>
      {nodes.map((child, i) => (
        <ViewNodeView key={childKey(child, i)} node={child} />
      ))}
    </>
  );
}

function Kids({ node, row = false }: { node: ViewNode; row?: boolean }) {
  return (
    <InRow.Provider value={row}>
      <ViewChildren nodes={node.c} />
    </InRow.Provider>
  );
}

// ------------------------------------------------------------------ nodes

export const ViewNodeView = memo(function ViewNodeView({ node }: { node: ViewChild }) {
  const { dispatch, colors, paint, modals } = useRender();
  const inRow = useContext(InRow);
  if (typeof node === "string") {
    return <Text style={[variantStyle("body").style, { color: colors.text }]}>{node}</Text>;
  }
  const p = node.p ?? {};
  const h = node.h ?? {};
  const fire = (name: string) => (h[name] !== undefined ? (value?: unknown) => dispatch(h[name]!, value) : undefined);
  switch (node.t) {
    case "Column":
      return (
        <Box p={p} style={boxStyle(p, colors, paint)}>
          <Kids node={node} />
        </Box>
      );
    case "Row":
      return (
        <Box p={p} style={[{ flexDirection: "row" }, boxStyle({ align: "center", ...p }, colors, paint)]}>
          <Kids node={node} row />
        </Box>
      );
    case "Stack":
      return (
        <Box p={p} style={[{ position: "relative" }, boxStyle(p, colors, paint)]}>
          {(node.c ?? []).map((child, i) =>
            i === 0 ? (
              <ViewNodeView key={childKey(child, i)} node={child} />
            ) : (
              <View key={childKey(child, i)} style={StyleSheet.absoluteFill} pointerEvents="box-none">
                <ViewNodeView node={child} />
              </View>
            ),
          )}
        </Box>
      );
    case "Grid":
      return <ViewGrid node={node} />;
    case "Scroll":
      return <ViewScroll node={node} />;
    case "Spacer":
      return typeof p.size === "number" ? <View style={{ width: p.size, height: p.size }} /> : <View style={{ flexGrow: 1 }} />;
    case "Divider":
      return p.vertical ? (
        <View style={{ width: StyleSheet.hairlineWidth, alignSelf: "stretch", backgroundColor: colors.border }} />
      ) : (
        <View style={{ height: StyleSheet.hairlineWidth, alignSelf: "stretch", backgroundColor: colors.border }} />
      );
    case "Pressable":
      return <ViewPressable node={node} fire={fire} />;
    case "Text":
      return <ViewText node={node} />;
    case "Markdown":
      return <AssistantMarkdown text={textOf(node.c)} colors={colors} fill={false} selectable={Boolean(p.selectable)} />;
    case "Image":
      return <ViewImage p={p} />;
    case "Icon":
      return <ViewIcon name={p.name} size={typeof p.size === "number" ? p.size : 16} color={paint(p.color) ?? colors.text} />;
    case "Code":
      return (
        <View style={{ backgroundColor: mix(colors.text, 5, colors.background), borderRadius: 10, overflow: "hidden" }}>
          <SideScroller contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 10 }}>
            <Text selectable style={{ fontFamily: fonts.mono.regular, fontSize: 13, lineHeight: 19, color: colors.text }}>
              {textOf(node.c)}
            </Text>
          </SideScroller>
        </View>
      );
    case "Video":
      return (
        <View style={[{ width: "100%", aspectRatio: 16 / 9, overflow: "hidden" }, boxStyle({ ...p, padding: undefined }, colors, paint)]}>
          <VideoPlayerView uri={String(p.src ?? "")} posterUri={null} colors={colors} />
        </View>
      );
    case "Audio":
      return <AudioPlayerView uri={String(p.src ?? "")} />;
    case "Progress":
      return <ViewProgress p={p} inRow={inRow} />;
    case "Button":
      return <ViewButton node={node} press={fire("onPress")} />;
    case "TextField":
      return <ViewTextField p={p} inRow={inRow} onChange={fire("onChange")} onSubmit={fire("onSubmit")} />;
    case "Checkbox":
      return <ViewCheckbox p={p} onChange={fire("onChange")} />;
    case "Switch":
      return <ViewSwitch p={p} onChange={fire("onChange")} />;
    case "Slider":
      return <ViewSlider p={p} inRow={inRow} onChange={fire("onChange")} />;
    case "Select":
      return <ViewSelect p={p} onChange={fire("onChange")} />;
    case "Segmented": {
      const change = fire("onChange");
      return <SegmentedControl options={optionList(p.options)} value={String(p.value ?? "")} onChange={(v) => change?.(v)} accessibilityLabel={String(p.label ?? "")} />;
    }
    case "Tabs":
      return <ViewTabs p={p} onChange={fire("onChange")} />;
    case "Disclosure":
      return (
        <ViewDisclosure p={p} onToggle={fire("onToggle")}>
          <Kids node={node} />
        </ViewDisclosure>
      );
    case "Modal":
      return modals ? (
        <ViewSheet p={p} onClose={fire("onClose")}>
          <Kids node={node} />
        </ViewSheet>
      ) : null;
    case "Table":
      return <ViewTable node={node} colors={colors} paint={paint} onRowPress={fire("onRowPress")} renderSlot={(nodes) => <ViewChildren nodes={nodes} />} />;
    case "List":
      return <ViewList node={node} />;
    case "Chart":
      return <ViewChart p={p} colors={colors} paint={paint} />;
    case "Canvas":
      return <ViewCanvas p={p} colors={colors} paint={paint} onPointer={fire("onPointer")} />;
    default:
      return <Kids node={node} />;
  }
});

// ------------------------------------------------------------------ layout

function ViewGrid({ node }: { node: ViewNode }) {
  const { colors, paint } = useRender();
  const p = node.p ?? {};
  const columns = Math.max(1, Math.round(Number(p.columns) || 2));
  const gap = typeof p.gap === "number" ? p.gap : 0;
  const children = node.c ?? [];
  const rows: ViewChild[][] = [];
  for (let i = 0; i < children.length; i += columns) rows.push(children.slice(i, i + columns));
  return (
    <Box p={p} style={[boxStyle({ ...p, gap: undefined }, colors, paint), { gap }]}>
      {rows.map((row, r) => (
        <View key={r} style={{ flexDirection: "row", gap }}>
          {Array.from({ length: columns }, (_, c) => {
            const child = row[c];
            return (
              <View key={child === undefined ? `e${c}` : childKey(child, r * columns + c)} style={{ flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
                {child === undefined ? null : <ViewNodeView node={child} />}
              </View>
            );
          })}
        </View>
      ))}
    </Box>
  );
}

function ViewScroll({ node }: { node: ViewNode }) {
  const { colors, paint } = useRender();
  const p = node.p ?? {};
  const ref = useRef<ScrollView>(null);
  const gap = typeof p.gap === "number" ? p.gap : undefined;
  const outer = boxStyle({ ...p, padding: undefined, gap: undefined, align: undefined, justify: undefined, ...(p.height === undefined && p.maxHeight === undefined && p.grow === undefined ? { grow: 1 } : {}) }, colors, paint);
  const inner = boxStyle({ padding: p.padding, gap: p.gap, align: p.align, justify: p.justify }, colors, paint);
  if (p.horizontal) {
    return (
      <View style={outer}>
        <SideScroller contentContainerStyle={[{ flexDirection: "row", alignItems: "center", gap }, inner]}>
          <Kids node={node} row />
        </SideScroller>
      </View>
    );
  }
  return (
    <ScrollView
      ref={ref}
      style={[outer, { minHeight: 0 }]}
      contentContainerStyle={inner}
      nestedScrollEnabled
      keyboardShouldPersistTaps="handled"
      onContentSizeChange={p.stickToBottom ? () => ref.current?.scrollToEnd({ animated: false }) : undefined}
    >
      <Kids node={node} />
    </ScrollView>
  );
}

function ViewPressable({ node, fire }: { node: ViewNode; fire: (name: string) => ((value?: unknown) => void) | undefined }) {
  const { colors, paint } = useRender();
  const p = node.p ?? {};
  const press = fire("onPress");
  const double = fire("onDoublePress");
  const long = fire("onLongPress");
  const hover = fire("onHover");
  const drag = fire("onDrag");
  const disabled = Boolean(p.disabled);
  const lastTap = useRef(0);
  const pressFill = paint(p.pressBackground) ?? (press || double ? mix(colors.text, 8, "transparent") : undefined);
  const base = boxStyle(p, colors, paint);
  const body = (
    <Pressable
      disabled={disabled || (!press && !double && !long)}
      onPress={() => {
        press?.();
        if (!double) return;
        const now = Date.now();
        if (now - lastTap.current < 300) {
          lastTap.current = 0;
          double();
        } else lastTap.current = now;
      }}
      onLongPress={long ? () => long() : undefined}
      onHoverIn={hover ? () => hover(true) : undefined}
      onHoverOut={hover ? () => hover(false) : undefined}
      accessibilityRole={press ? "button" : undefined}
      accessibilityLabel={typeof p.tooltip === "string" ? p.tooltip : undefined}
      style={({ pressed }) => [base, pressed && pressFill ? { backgroundColor: pressFill } : null, disabled ? { opacity: 0.5 } : null]}
    >
      <Kids node={node} />
    </Pressable>
  );
  if (!drag || disabled) return body;
  return <DragArea onDrag={drag}>{body}</DragArea>;
}

function DragArea({ onDrag, children }: { onDrag: (value: unknown) => void; children: ReactNode }) {
  const handler = useRef(onDrag);
  handler.current = onDrag;
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .minDistance(2)
        .onStart((e) => handler.current({ phase: "start", dx: 0, dy: 0, x: e.x, y: e.y }))
        .onUpdate((e) => handler.current({ phase: "move", dx: e.translationX, dy: e.translationY, x: e.x, y: e.y }))
        .onEnd((e) => handler.current({ phase: "end", dx: e.translationX, dy: e.translationY, x: e.x, y: e.y })),
    [],
  );
  return <GestureDetector gesture={gesture}>{children}</GestureDetector>;
}

// ------------------------------------------------------------------ text

type Run = { text: string; style: TextStyle; href?: string };

function textRuns(children: ViewChild[] | undefined, paint: Paint, inherited: TextStyle, href: string | undefined, out: Run[]) {
  for (const child of children ?? []) {
    if (typeof child === "string") {
      out.push({ text: child, style: inherited, ...(href ? { href } : {}) });
      continue;
    }
    if (child.t !== "Text") continue;
    const p = child.p ?? {};
    const style: TextStyle = { ...inherited, ...runStyle(p, paint, inherited) };
    const link = typeof p.href === "string" ? p.href : href;
    if (typeof p.href === "string") {
      style.color = paint(p.color) ?? paint("accent");
      style.textDecorationLine = "underline";
    }
    textRuns(child.c, paint, style, link, out);
  }
}

function runStyle(p: Record<string, unknown>, paint: Paint, inherited: TextStyle = {}): TextStyle {
  const style: TextStyle = {};
  const weight = typeof p.weight === "number" ? p.weight : undefined;
  if (weight !== undefined || p.mono) style.fontFamily = familyFor(weight ?? 400, Boolean(p.mono));
  const color = paint(p.color);
  if (color) style.color = color;
  if (p.italic) style.fontStyle = "italic";
  const lines = [p.underline || inherited.textDecorationLine?.includes("underline") ? "underline" : null, p.strike || inherited.textDecorationLine?.includes("line-through") ? "line-through" : null].filter(Boolean);
  if (lines.length) style.textDecorationLine = lines.join(" ") as TextStyle["textDecorationLine"];
  if (typeof p.size === "number") {
    style.fontSize = p.size;
    style.lineHeight = Math.round(p.size * 1.4);
  }
  return style;
}

function ViewText({ node }: { node: ViewNode }) {
  const { colors, paint } = useRender();
  const p = node.p ?? {};
  const { style: variant, variant: v } = variantStyle(p.variant);
  const style: TextStyle = {
    ...variant,
    color: v.muted ? colors.textMuted : colors.text,
    ...runStyle(p, paint),
    ...(typeof p.align === "string" ? { textAlign: p.align === "end" ? "right" : p.align === "center" ? "center" : "left" } : {}),
    ...(typeof p.grow === "number" ? { flexGrow: p.grow, flexShrink: 1 } : {}),
    ...(sizeOf(p.width) !== undefined ? { width: sizeOf(p.width) } : {}),
    ...(sizeOf(p.maxWidth) !== undefined ? { maxWidth: sizeOf(p.maxWidth) } : {}),
    ...(p.hidden ? { display: "none" } : {}),
  };
  const nested = (node.c ?? []).some((c) => typeof c !== "string");
  const common = { style: [style, { flexShrink: 1 }], numberOfLines: typeof p.lines === "number" ? p.lines : undefined, selectable: Boolean(p.selectable) };
  if (!nested && typeof p.href !== "string") return <Text {...common}>{(node.c ?? []).join("")}</Text>;
  const runs: Run[] = [];
  textRuns([{ ...node, p: { ...p, color: undefined, size: undefined, weight: undefined, mono: undefined, italic: undefined, underline: undefined, strike: undefined } }], paint, {}, undefined, runs);
  return (
    <Text {...common}>
      {runs.map((run, i) => (
        <Text key={i} style={run.style} onPress={run.href ? () => openLink(run.href!) : undefined}>
          {run.text}
        </Text>
      ))}
    </Text>
  );
}

// ------------------------------------------------------------------ media

function ViewImage({ p }: { p: Record<string, unknown> }) {
  const { colors } = useRender();
  const [open, setOpen] = useState(false);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const src = String(p.src ?? "");
  const r = radiusOf(p.radius);
  const width = sizeOf(p.width);
  const height = sizeOf(p.height);
  const aspect = typeof p.aspect === "number" && p.aspect > 0 ? p.aspect : height === undefined ? (natural ? natural.w / natural.h : 16 / 9) : undefined;
  const style: ImageStyle = {
    width: width ?? (height === undefined ? "100%" : undefined),
    ...(height !== undefined ? { height } : {}),
    ...(aspect !== undefined ? { aspectRatio: aspect } : {}),
    maxWidth: sizeOf(p.maxWidth) ?? (natural && width === undefined ? natural.w : "100%"),
    ...(sizeOf(p.maxHeight) !== undefined ? { maxHeight: sizeOf(p.maxHeight) } : {}),
    ...(r !== undefined ? { borderRadius: r, overflow: "hidden" } : {}),
    ...(p.border ? { borderWidth: 1, borderColor: colors.border } : {}),
  };
  const image = (
    <Image
      source={{ uri: src }}
      contentFit={p.fit === "contain" ? "contain" : "cover"}
      style={style}
      accessibilityLabel={typeof p.alt === "string" ? p.alt : undefined}
      onLoad={(e) => (e.source.width > 0 && e.source.height > 0 ? setNatural({ w: e.source.width, h: e.source.height }) : undefined)}
    />
  );
  if (!p.zoomable) return image;
  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="imagebutton">
        {image}
      </Pressable>
      <Modal visible={open} animationType="fade" presentationStyle="overFullScreen" transparent onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: "#000" }}>
          <ZoomableImageView uri={src} accessibilityLabel={typeof p.alt === "string" ? p.alt : "Image"} onDismiss={() => setOpen(false)} />
        </View>
      </Modal>
    </>
  );
}

function ViewProgress({ p, inRow }: { p: Record<string, unknown>; inRow: boolean }) {
  const { colors, paint } = useRender();
  const value = typeof p.value === "number" ? Math.max(0, Math.min(1, p.value)) : null;
  const color = paint(p.color) ?? colors.accent;
  const [width, setWidth] = useState(0);
  const offset = useSharedValue(0);
  useEffect(() => {
    if (value !== null || width <= 0) return;
    offset.value = -0.3 * width;
    offset.value = withRepeat(withTiming(width, { duration: 1400, easing: Easing.inOut(Easing.ease) }), -1, false);
    return () => cancelAnimation(offset);
  }, [value, width, offset]);
  const moving = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));
  return (
    <View style={[fillMain(p.width, inRow), { height: 4, borderRadius: 2, overflow: "hidden", backgroundColor: mix(colors.text, 10, "transparent") }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {value === null ? (
        <Animated.View style={[{ width: "30%", height: 4, borderRadius: 2, backgroundColor: color }, moving]} />
      ) : (
        <Animated.View layout={LinearTransition.duration(250)} style={{ width: `${Math.round(value * 1000) / 10}%`, height: 4, borderRadius: 2, backgroundColor: color }} />
      )}
    </View>
  );
}

// ------------------------------------------------------------------ inputs

const BUTTON_H = { small: 32, normal: 40, large: 48 } as const;

function ViewButton({ node, press }: { node: ViewNode; press?: (value?: unknown) => void }) {
  const { colors } = useRender();
  const p = node.p ?? {};
  const label = textOf(node.c);
  const variant = typeof p.variant === "string" ? p.variant : "secondary";
  const size = (p.size === "small" || p.size === "large" ? p.size : "normal") as keyof typeof BUTTON_H;
  const height = BUTTON_H[size];
  const disabled = Boolean(p.disabled) || !press;
  const fg = variant === "primary" ? colors.accentForeground : variant === "danger" ? "#ffffff" : variant === "ghost" ? colors.text : colors.text;
  const bg = variant === "primary" ? colors.accent : variant === "danger" ? colors.danger : variant === "ghost" ? "transparent" : mix(colors.text, 7, colors.background);
  const iconSize = size === "small" ? 14 : 16;
  return (
    <Pressable
      disabled={disabled}
      onPress={() => press?.()}
      accessibilityRole="button"
      accessibilityLabel={label || (typeof p.tooltip === "string" ? p.tooltip : undefined)}
      style={({ pressed }) => [
        {
          height,
          minWidth: height,
          paddingHorizontal: label ? (size === "small" ? 12 : 16) : 0,
          borderRadius: height / 2,
          backgroundColor: bg,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          alignSelf: p.fullWidth ? "stretch" : "flex-start",
        },
        pressed ? { opacity: 0.7 } : null,
        Boolean(p.disabled) ? { opacity: 0.45 } : null,
      ]}
    >
      {typeof p.icon === "string" ? <ViewIcon name={p.icon} size={iconSize} color={fg} /> : null}
      {label ? <Text style={{ fontFamily: fonts.sans.semiBold, fontSize: size === "small" ? 13 : size === "large" ? 16 : 15, color: fg }} numberOfLines={1}>{label}</Text> : null}
      {typeof p.iconRight === "string" ? <ViewIcon name={p.iconRight} size={iconSize} color={fg} /> : null}
    </Pressable>
  );
}

function FieldLabel({ text }: { text: unknown }) {
  const { colors } = useRender();
  if (typeof text !== "string" || !text) return null;
  return <Text style={{ fontFamily: fonts.sans.semiBold, fontSize: 13, lineHeight: 18, color: colors.textMuted }}>{text}</Text>;
}

function ViewTextField({ p, inRow, onChange, onSubmit }: { p: Record<string, unknown>; inRow: boolean; onChange?: (v: unknown) => void; onSubmit?: (v: unknown) => void }) {
  const { colors } = useRender();
  const value = String(p.value ?? "");
  const [text, setText] = useState(value);
  const sent = useRef<string[]>([]);
  useEffect(() => {
    // The program echoes keystrokes back a beat later; adopt only values it set itself.
    if (sent.current.includes(value)) {
      const at = sent.current.indexOf(value);
      sent.current = sent.current.slice(at + 1);
      return;
    }
    sent.current = [];
    setText(value);
  }, [value]);
  const multiline = Boolean(p.multiline);
  const error = typeof p.error === "string" && p.error ? p.error : null;
  const outer = typeof p.grow === "number" ? { flexGrow: p.grow, flexBasis: 0, minWidth: 0, ...(sizeOf(p.width) !== undefined ? { width: sizeOf(p.width) } : {}) } : fillMain(p.width, inRow);
  return (
    <View style={[outer, { gap: 6 }]}>
      <FieldLabel text={p.label} />
      <TextInput
        value={text}
        onChangeText={(next) => {
          setText(next);
          if (!onChange) return;
          sent.current.push(next);
          if (sent.current.length > 32) sent.current.shift();
          onChange(next);
        }}
        onSubmitEditing={
          multiline
            ? undefined
            : () => {
                sent.current = [];
                onSubmit?.(text);
              }
        }
        submitBehavior={multiline ? "newline" : onSubmit ? "submit" : "blurAndSubmit"}
        returnKeyType={!multiline && onSubmit ? "done" : "default"}
        placeholder={typeof p.placeholder === "string" ? p.placeholder : undefined}
        placeholderTextColor={colors.textWeaker}
        multiline={multiline}
        secureTextEntry={Boolean(p.secure)}
        editable={!p.disabled}
        autoFocus={Boolean(p.autoFocus)}
        style={{
          minHeight: 42,
          ...(multiline ? { maxHeight: 160, paddingTop: 10, paddingBottom: 10, textAlignVertical: "top" } : {}),
          paddingHorizontal: 12,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: error ? colors.danger : colors.border,
          backgroundColor: mix(colors.text, 3, colors.background),
          color: colors.text,
          fontFamily: fonts.sans.regular,
          fontSize: 16,
          opacity: p.disabled ? 0.5 : 1,
        }}
      />
      {error ? <Text style={{ fontFamily: fonts.sans.regular, fontSize: 13, color: colors.danger }}>{error}</Text> : null}
    </View>
  );
}

const CHECK_PATH = "M20 6 9 17l-5-5";

function ViewCheckbox({ p, onChange }: { p: Record<string, unknown>; onChange?: (v: unknown) => void }) {
  const { colors } = useRender();
  const checked = Boolean(p.checked);
  const disabled = Boolean(p.disabled);
  return (
    <Pressable
      disabled={disabled}
      onPress={() => onChange?.(!checked)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      hitSlop={6}
      style={{ flexDirection: "row", alignItems: "center", gap: 10, opacity: disabled ? 0.5 : 1, alignSelf: "flex-start" }}
    >
      <View style={{ width: 22, height: 22, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: checked ? colors.accent : "transparent", borderWidth: checked ? 0 : 1.5, borderColor: colors.borderStrong }}>
        {checked ? <CheckMark color={colors.accentForeground} /> : null}
      </View>
      {typeof p.label === "string" ? <Text style={[variantStyle("body").style, { color: colors.text, flexShrink: 1 }]}>{p.label}</Text> : null}
    </Pressable>
  );
}

function CheckMark({ color }: { color: string }) {
  return <ViewIconPath d={CHECK_PATH} size={14} color={color} />;
}

function ViewIconPath({ d, size, color }: { d: string; size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={d} stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

function ViewSwitch({ p, onChange }: { p: Record<string, unknown>; onChange?: (v: unknown) => void }) {
  const { colors } = useRender();
  const control = (
    <Switch
      value={Boolean(p.checked)}
      onValueChange={(v) => onChange?.(v)}
      disabled={Boolean(p.disabled)}
      trackColor={{ true: colors.accent, false: Platform.OS === "android" ? colors.border : undefined }}
      accessibilityLabel={typeof p.label === "string" ? p.label : undefined}
    />
  );
  if (typeof p.label !== "string") return control;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, alignSelf: "stretch", opacity: p.disabled ? 0.5 : 1 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[variantStyle("body").style, { color: colors.text }]}>{p.label}</Text>
        {typeof p.description === "string" ? <Text style={[variantStyle("caption").style, { color: colors.textMuted }]}>{p.description}</Text> : null}
      </View>
      {control}
    </View>
  );
}

function ViewSlider({ p, inRow, onChange }: { p: Record<string, unknown>; inRow: boolean; onChange?: (v: unknown) => void }) {
  const { colors } = useRender();
  const min = typeof p.min === "number" ? p.min : 0;
  const max = typeof p.max === "number" ? p.max : 1;
  const step = typeof p.step === "number" && p.step > 0 ? p.step : (max - min) / 100;
  const value = Math.max(min, Math.min(max, typeof p.value === "number" ? p.value : min));
  const [dragging, setDragging] = useState<number | null>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const width = useRef(0);
  const shown = dragging ?? value;
  const frac = max > min ? (shown - min) / (max - min) : 0;
  const disabled = Boolean(p.disabled);
  const latest = useRef({ min, max, step, onChange });
  latest.current = { min, max, step, onChange };
  const gesture = useMemo(() => {
    const at = (x: number) => {
      const { min: lo, max: hi, step: st } = latest.current;
      const w = width.current;
      if (w <= 0) return lo;
      const raw = lo + Math.max(0, Math.min(1, (x - 12) / Math.max(1, w - 24))) * (hi - lo);
      const snapped = Math.round((raw - lo) / st) * st + lo;
      return Math.max(lo, Math.min(hi, Math.round(snapped * 1e6) / 1e6));
    };
    const move = (x: number) => {
      const next = at(x);
      setDragging(next);
      latest.current.onChange?.(next);
    };
    return Gesture.Pan()
      .runOnJS(true)
      .minDistance(0)
      .activeOffsetX([-4, 4])
      .failOffsetY([-12, 12])
      .onBegin((e) => move(e.x))
      .onUpdate((e) => move(e.x))
      .onFinalize(() => setDragging(null));
  }, []);
  const decimals = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step)));
  return (
    <View style={[fillMain(p.width, inRow), { gap: 4, opacity: disabled ? 0.5 : 1 }]}>
      {typeof p.label === "string" ? (
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <FieldLabel text={p.label} />
          <Text style={{ fontFamily: fonts.sans.medium, fontSize: 13, color: colors.textMuted, fontVariant: ["tabular-nums"] }}>{shown.toFixed(decimals)}</Text>
        </View>
      ) : null}
      <GestureDetector gesture={gesture.enabled(!disabled)}>
        <View
          style={{ height: 32, justifyContent: "center", paddingHorizontal: 12 }}
          onLayout={(e: LayoutChangeEvent) => {
            width.current = e.nativeEvent.layout.width;
            setTrackWidth(e.nativeEvent.layout.width);
          }}
          accessibilityRole="adjustable"
          accessibilityValue={{ min, max, now: shown }}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={(e) => onChange?.(Math.max(min, Math.min(max, value + (e.nativeEvent.actionName === "increment" ? step : -step))))}
        >
          <View style={{ height: 4, borderRadius: 2, backgroundColor: mix(colors.text, 12, "transparent") }}>
            <View style={{ width: `${frac * 100}%`, height: 4, borderRadius: 2, backgroundColor: colors.accent }} />
          </View>
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: frac * Math.max(0, trackWidth - 24),
              top: 4,
              width: 24,
              height: 24,
              borderRadius: 12,
              backgroundColor: "#ffffff",
              boxShadow: "0px 1px 4px rgba(0,0,0,0.25)",
            }}
          />
        </View>
      </GestureDetector>
    </View>
  );
}

function BottomSheet({ open, onClose, title, children, scroll = true }: { open: boolean; onClose: () => void; title?: string; children: ReactNode; scroll?: boolean }) {
  const { colors, dark } = useRender();
  const insets = useSafeAreaInsets();
  const body = scroll ? (
    <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: Math.max(20, insets.bottom + 8), gap: 14 }} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    children
  );
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: dark ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.3)" }]} onPress={onClose} accessibilityLabel="Close" />
        <View style={{ maxHeight: "88%", backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8 }}>
          <View style={{ alignSelf: "center", width: 36, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong, marginBottom: 6 }} />
          <View style={{ flexDirection: "row", alignItems: "center", paddingLeft: 20, paddingRight: 10, minHeight: 44 }}>
            <Text style={{ flex: 1, fontFamily: fonts.sans.semiBold, fontSize: 17, color: colors.text }} numberOfLines={1}>
              {title ?? ""}
            </Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close" style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: mix(colors.text, 7, colors.card) }}>
              <ViewIcon name="x" size={16} color={colors.textMuted} />
            </Pressable>
          </View>
          {body}
        </View>
      </View>
    </Modal>
  );
}

function ViewSheet({ p, onClose, children }: { p: Record<string, unknown>; onClose?: (v?: unknown) => void; children: ReactNode }) {
  return (
    <BottomSheet open={Boolean(p.open)} onClose={() => onClose?.()} title={typeof p.title === "string" ? p.title : undefined}>
      {children}
    </BottomSheet>
  );
}

function ViewSelect({ p, onChange }: { p: Record<string, unknown>; onChange?: (v: unknown) => void }) {
  const { colors } = useRender();
  const [open, setOpen] = useState(false);
  const options = optionList(p.options);
  const value = String(p.value ?? "");
  const current = options.find((o) => o.value === value);
  const disabled = Boolean(p.disabled);
  const width = sizeOf(p.width);
  return (
    <View style={{ gap: 6, ...(width !== undefined ? { width } : { alignSelf: "flex-start", minWidth: 160 }) }}>
      <FieldLabel text={p.label} />
      <Pressable
        disabled={disabled}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={typeof p.label === "string" ? p.label : undefined}
        accessibilityValue={{ text: current?.label ?? "" }}
        style={({ pressed }) => ({
          height: 42,
          paddingHorizontal: 12,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: pressed ? mix(colors.text, 7, colors.background) : mix(colors.text, 3, colors.background),
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          opacity: disabled ? 0.5 : 1,
        })}
      >
        <Text style={{ flex: 1, fontFamily: fonts.sans.regular, fontSize: 16, color: current ? colors.text : colors.textWeaker }} numberOfLines={1}>
          {current?.label ?? (typeof p.placeholder === "string" ? p.placeholder : "")}
        </Text>
        <ViewIcon name="chevrons-up-down" size={16} color={colors.textMuted} />
      </Pressable>
      <BottomSheet open={open} onClose={() => setOpen(false)} title={typeof p.label === "string" ? p.label : typeof p.placeholder === "string" ? p.placeholder : undefined}>
        <View>
          {options.map((o, i) => (
            <Pressable
              key={o.value}
              onPress={() => {
                setOpen(false);
                if (o.value !== value) onChange?.(o.value);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: o.value === value }}
              style={({ pressed }) => ({ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12, borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: colors.border, opacity: pressed ? 0.6 : 1 })}
            >
              <Text style={{ flex: 1, fontFamily: o.value === value ? fonts.sans.semiBold : fonts.sans.regular, fontSize: 16, color: colors.text }}>{o.label}</Text>
              {o.value === value ? <ViewIcon name="check" size={18} color={colors.accent} /> : null}
            </Pressable>
          ))}
        </View>
      </BottomSheet>
    </View>
  );
}

function ViewTabs({ p, onChange }: { p: Record<string, unknown>; onChange?: (v: unknown) => void }) {
  const { colors } = useRender();
  const value = String(p.value ?? "");
  return (
    <View style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, alignSelf: "stretch" }}>
      <SideScroller contentContainerStyle={{ flexDirection: "row", gap: 20 }}>
        {optionList(p.tabs).map((tab) => {
          const on = tab.value === value;
          return (
            <Pressable key={tab.value} onPress={() => (on ? undefined : onChange?.(tab.value))} accessibilityRole="button" accessibilityLabel={tab.label} accessibilityState={{ selected: on }} style={{ paddingTop: 8, paddingBottom: 10, borderBottomWidth: 2, borderBottomColor: on ? colors.accent : "transparent" }}>
              <Text style={{ fontFamily: on ? fonts.sans.semiBold : fonts.sans.medium, fontSize: 15, color: on ? colors.text : colors.textMuted }}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </SideScroller>
    </View>
  );
}

function ViewDisclosure({ p, onToggle, children }: { p: Record<string, unknown>; onToggle?: (v: unknown) => void; children: ReactNode }) {
  const { colors } = useRender();
  const [local, setLocal] = useState(Boolean(p.defaultOpen));
  const controlled = typeof p.open === "boolean";
  const open = controlled ? (p.open as boolean) : local;
  return (
    <View style={{ alignSelf: "stretch" }}>
      <Pressable
        onPress={() => {
          if (!controlled) setLocal(!open);
          onToggle?.(!open);
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 }}
      >
        <View style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }}>
          <ViewIcon name="chevron-right" size={16} color={colors.textMuted} />
        </View>
        <Text style={{ fontFamily: fonts.sans.semiBold, fontSize: 16, color: colors.text, flexShrink: 1 }}>{String(p.title ?? "")}</Text>
      </Pressable>
      {open ? (
        <Animated.View entering={FadeIn.duration(180)} style={{ paddingLeft: 24, paddingTop: 2, paddingBottom: 8, gap: 8 }}>
          {children}
        </Animated.View>
      ) : null}
    </View>
  );
}

function ViewList({ node }: { node: ViewNode }) {
  const { colors } = useRender();
  const p = node.p ?? {};
  const rows = (Array.isArray(p.rows) ? p.rows : []) as ViewChild[][];
  const keys = (Array.isArray(p.rowKeys) ? p.rowKeys : []) as (string | number)[];
  const gap = typeof p.gap === "number" ? p.gap : 0;
  const body = rows.map((row, i) => (
    <View key={String(keys[i] ?? i)} style={{ paddingBottom: i < rows.length - 1 ? gap : 0 }}>
      {p.dividers && i > 0 ? <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginBottom: gap }} /> : null}
      <ViewChildren nodes={row} />
    </View>
  ));
  const height = sizeOf(p.height);
  if (height === undefined && typeof p.grow !== "number") return <View style={{ alignSelf: "stretch" }}>{body}</View>;
  return (
    <ScrollView style={{ alignSelf: "stretch", minHeight: 0, ...(height !== undefined ? { height } : {}), ...(typeof p.grow === "number" ? { flexGrow: p.grow } : {}) }} nestedScrollEnabled removeClippedSubviews>
      {body}
    </ScrollView>
  );
}

// ------------------------------------------------------------------ root

/** The whole tree, with the dispatch context; `modals` is false on a surface hidden behind another one showing the view. */
export function ViewRoot({ tree, dispatch, colors, dark, modals = true }: { tree: ViewChild | null; dispatch: Dispatch; colors: Colors; dark: boolean; modals?: boolean }) {
  const paint = useMemo(() => paintFor(colors), [colors]);
  // A narrow-first view sits in the middle of a wider card or screen (a tablet, landscape).
  const shown = useMemo(() => centreViewContent(tree), [tree]);
  const ctx = useMemo(() => ({ dispatch, colors, paint, dark, modals }), [dispatch, colors, paint, dark, modals]);
  return <RenderCtx.Provider value={ctx}>{shown === null ? null : <ViewNodeView node={shown} />}</RenderCtx.Provider>;
}
