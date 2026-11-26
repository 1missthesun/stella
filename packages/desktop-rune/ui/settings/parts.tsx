import { Children, Fragment, cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { mixOklch, useTokens, type Style } from "../theme";
import { T } from "../kit/compat";
import { SettingsCardTitle, forgetCardPlace, noteCardPlace, usePulsingCard } from "./settings-card-targets";
import { useSettings } from "./settings.styles";

type TabContent = { account: boolean; place: (id: string, y: number | null) => void; last: string | null };
const TabContentCtx = createContext<TabContent | null>(null);

/** `.settings-tab-content`: the 720-wide column of cards; every card but the last ends in a divider (`--account`: wider gaps, no row dividers). */
export function SettingsTabContent({ account = false, children, ...style }: Style & { account?: boolean; children?: ReactNode }) {
  const s = useSettings();
  const places = useRef(new Map<string, number>());
  const [last, setLast] = useState<string | null>(null);
  const place = useCallback((id: string, y: number | null) => {
    if (y === null) places.current.delete(id);
    else places.current.set(id, y);
    let best: string | null = null;
    let max = -Infinity;
    for (const [k, v] of places.current) if (v > max) [best, max] = [k, v];
    setLast(best);
  }, []);
  const value = useMemo(() => ({ account, place, last }), [account, place, last]);
  return (
    <col {...s.settingsTabContent} {...(account ? s.settingsTabContentAccount : null)} {...style}>
      <TabContentCtx.Provider value={value}>{children}</TabContentCtx.Provider>
    </col>
  );
}

/** A non-card item of a tab's column that still makes the card above it not the last. */
export function SettingsTabItem({ children, ...style }: Style & { children?: ReactNode }) {
  const tab = useContext(TabContentCtx);
  const id = useId();
  useEffect(() => () => tab?.place(id, null), [tab?.place, id]);
  return (
    <col w="full" {...style} onLayout={(r) => tab?.place(id, r.y)}>
      {children}
    </col>
  );
}

type CardRegistration = { setTitleKey: (key: string | null) => void; inHeader: boolean; account: boolean };
const CardCtx = createContext<CardRegistration | null>(null);
export const useCardRegistration = () => useContext(CardCtx);

type RowSlot = { first?: boolean; divided?: boolean; last?: boolean };

const isDivLike = (el: ReactElement) => el.type === SettingsRow || el.type === SettingsCardHeader || el.type === "row" || el.type === "col" || el.type === "box";

function flatten(children: ReactNode): ReactNode[] {
  const out: ReactNode[] = [];
  Children.forEach(children, (c) => {
    if (isValidElement(c) && c.type === Fragment) out.push(...flatten((c.props as { children?: ReactNode }).children));
    else if (c !== null && c !== undefined && typeof c !== "boolean") out.push(c);
  });
  return out;
}

/** `.settings-card`: lays its rows out as CSS does (`.settings-row + .settings-row` divider, `:first-of-type` 4pt top, `:last-child` no bottom). */
export function SettingsCard({ children, ...style }: Style & { children?: ReactNode; "data-testid"?: string }) {
  const s = useSettings();
  const t = useTokens();
  const tab = useContext(TabContentCtx);
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const cardId = `settings-card-${id}`;
  const [titleKey, setTitleKey] = useState<string | null>(null);
  const hostedYs = useRef(new Map<number, Map<string, number>>());
  const [hosted, setHosted] = useState<ReadonlyMap<number, readonly string[]>>(() => new Map());
  const hostRow = useCallback((index: number, rowId: string, y: number | null) => {
    const ys = hostedYs.current.get(index) ?? new Map<string, number>();
    if (y === null) ys.delete(rowId);
    else ys.set(rowId, y);
    hostedYs.current.set(index, ys);
    const order = [...ys.entries()].sort((p, q) => p[1] - q[1]).map(([id]) => id);
    setHosted((prev) => {
      const was = prev.get(index) ?? [];
      if (was.length === order.length && was.every((id, k) => id === order[k])) return prev;
      const next = new Map(prev);
      if (order.length) next.set(index, order);
      else next.delete(index);
      return next;
    });
  }, []);
  const [lit, setLit] = useState(false);
  const pulse = usePulsingCard();
  const y = useRef<number | null>(null);
  useEffect(() => {
    if (!pulse || pulse.key !== titleKey) return;
    setLit(true);
    const off = setTimeout(() => setLit(false), 320);
    return () => clearTimeout(off);
  }, [pulse, titleKey]);
  useEffect(() => () => tab?.place(cardId, null), [tab?.place, cardId]);
  useEffect(() => {
    if (!titleKey) return;
    if (y.current !== null) noteCardPlace(titleKey, cardId, y.current);
    return () => forgetCardPlace(titleKey, cardId);
  }, [titleKey, cardId]);
  const reg = useMemo(() => ({ setTitleKey, inHeader: false, account: tab?.account ?? false }), [tab?.account]);
  const kids = flatten(children);
  const kindOf = (child: ReactNode, i: number): "row" | "host" | "absent" | "div" | "other" => {
    if (!isValidElement(child)) return "other";
    if (child.type === SettingsRow) return "row";
    if (isRowHost(child)) return hosted.has(i) ? "host" : "absent";
    return isDivLike(child) ? "div" : "other";
  };
  const kinds = kids.map(kindOf);
  let lastIndex = kinds.length - 1;
  while (lastIndex > 0 && kinds[lastIndex] === "absent") lastIndex--;
  let seenDiv = false;
  let prevRow = false;
  const nextRowSlot = (last: boolean): RowSlot => {
    const slot = { first: !seenDiv, divided: prevRow && !tab?.account, last };
    seenDiv = true;
    prevRow = true;
    return slot;
  };
  const laid = kids.map((child, i) => {
    const kind = kinds[i];
    if (kind === "absent" || kind === "host") {
      const rows = hosted.get(i) ?? [];
      const slots = new Map(rows.map((id, k) => [id, nextRowSlot(i === lastIndex && k === rows.length - 1)] as const));
      return <RowSlotCtx.Provider key={keyOf(child, i)} value={{ index: i, slots, hostRow }}>{child}</RowSlotCtx.Provider>;
    }
    if (kind === "row") return cloneElement(child as ReactElement<RowSlot>, nextRowSlot(i === lastIndex));
    if (kind === "div") seenDiv = true;
    prevRow = false;
    return child;
  });
  const isLast = tab ? tab.last === cardId : false;
  const divider = tab && !isLast ? { pb: 28 + 1, border: mixOklch(t.c.foreground, 6, "transparent"), borderSides: [0, 0, 1, 0] as [number, number, number, number] } : tab ? { pb: 0 } : null;
  return (
    <col
      id={cardId}
      w="full"
      {...s.settingsCard}
      {...divider}
      fill={lit ? mixOklch(t.c.interactive, 14, "transparent") : undefined}
      shadows={lit ? [{ x: 0, y: 0, blur: 0, spread: 6, color: mixOklch(t.c.interactive, 8, "transparent") }] : undefined}
      radius={lit || pulse?.key === titleKey ? 10 : 0}
      motion={{ dur: lit ? 0.3 : 1.3 }}
      {...style}
      onLayout={(r) => {
        y.current = r.y;
        tab?.place(cardId, r.y);
        if (titleKey) noteCardPlace(titleKey, cardId, r.y);
      }}
    >
      <CardCtx.Provider value={reg}>{laid}</CardCtx.Provider>
    </col>
  );
}

/** `.settings-card-header`: the title row (title loses its bottom margin) with a control at the end. */
export function SettingsCardHeader({ children, ...style }: Style & { children?: ReactNode }) {
  const s = useSettings();
  const card = useContext(CardCtx);
  const reg = useMemo(() => (card ? { ...card, inHeader: true } : null), [card]);
  return (
    <row w="full" {...s.settingsCardHeader} {...style}>
      <CardCtx.Provider value={reg}>{children}</CardCtx.Provider>
    </row>
  );
}

type RowSlotHost = { index: number; slots: ReadonlyMap<string, RowSlot>; hostRow: (index: number, rowId: string, y: number | null) => void };
const RowSlotCtx = createContext<RowSlotHost | null>(null);

/** A component child that may render `SettingsRow`s (or nothing); the rows it mounts take their slots in layout order. */
const isRowHost = (el: ReactElement) =>
  typeof el.type !== "string" && el.type !== Fragment && el.type !== T && el.type !== SettingsCardTitle && el.type !== SettingsCardHeader && el.type !== SettingsCardDesc && el.type !== SettingsCard && el.type !== SettingsTabItem;
const keyOf = (child: ReactNode, i: number) => (isValidElement(child) && child.key != null ? child.key : `row-host-${i}`);

/** `.settings-row`: info on the left, control on the right; its card decides dividers and edge padding. */
export function SettingsRow({ children, first: firstProp, divided: dividedProp, last: lastProp, ...style }: Style & RowSlot & { children?: ReactNode }) {
  const s = useSettings();
  const host = useContext(RowSlotCtx);
  const rowId = useId();
  useEffect(() => {
    if (!host) return;
    return () => host.hostRow(host.index, rowId, null);
  }, [host?.hostRow, host?.index, rowId]);
  const hostSlot = host?.slots.get(rowId);
  const first = firstProp ?? hostSlot?.first;
  const divided = dividedProp ?? hostSlot?.divided;
  const last = lastProp ?? hostSlot?.last;
  const t = useTokens();
  return (
    <row
      w="full"
      {...s.settingsRow}
      pt={(first ? 4 : 12) + (divided ? 1 : 0)}
      pb={last ? 0 : 12}
      {...(divided ? { border: mixOklch(t.c.foreground, 7, "transparent"), borderSides: [1, 0, 0, 0] as [number, number, number, number] } : null)}
      {...style}
      onLayout={host ? (r) => host.hostRow(host.index, rowId, r.y) : undefined}
    >
      {children}
    </row>
  );
}

/** `.settings-card-desc`, `--error` in the destructive colour. */
export function SettingsCardDesc({ error = false, children, ...style }: Style & { error?: boolean; children?: ReactNode }) {
  const s = useSettings();
  return (
    <T w="full" {...s.settingsCardDesc} {...(error ? s.settingsCardDescError : null)} role={error ? "alert" : undefined} {...style}>
      {children}
    </T>
  );
}
