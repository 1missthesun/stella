import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { TableAction } from "../../host/rune-jsx/props";
import { derive, fontSize, layer, mix, type Tokens, useTokens } from "../theme";
import { engine } from "./engine";
import { markdownStyle } from "./Markdown";

const svg = (d: string) => `<path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="${d}"/>`;

const ICON = {
  copy: svg("M2.75 0.5C1.7835 0.5 1 1.2835 1 2.25V9.75C1 10.7165 1.7835 11.5 2.75 11.5H3.75H4.5V10H3.75H2.75C2.61193 10 2.5 9.88807 2.5 9.75V2.25C2.5 2.11193 2.61193 2 2.75 2H8.25C8.38807 2 8.5 2.11193 8.5 2.25V3H10V2.25C10 1.2835 9.2165 0.5 8.25 0.5H2.75ZM7.75 4.5C6.7835 4.5 6 5.2835 6 6.25V13.75C6 14.7165 6.7835 15.5 7.75 15.5H13.25C14.2165 15.5 15 14.7165 15 13.75V6.25C15 5.2835 14.2165 4.5 13.25 4.5H7.75ZM7.5 6.25C7.5 6.11193 7.61193 6 7.75 6H13.25C13.3881 6 13.5 6.11193 13.5 6.25V13.75C13.5 13.8881 13.3881 14 13.25 14H7.75C7.61193 14 7.5 13.8881 7.5 13.75V6.25Z"),
  download: svg("M8.75 1V1.75V8.68934L10.7197 6.71967L11.25 6.18934L12.3107 7.25L11.7803 7.78033L8.70711 10.8536C8.31658 11.2441 7.68342 11.2441 7.29289 10.8536L4.21967 7.78033L3.68934 7.25L4.75 6.18934L5.28033 6.71967L7.25 8.68934V1.75V1H8.75ZM13.5 9.25V13.5H2.5V9.25V8.5H1V9.25V14C1 14.5523 1.44771 15 2 15H14C14.5523 15 15 14.5523 15 14V9.25V8.5H13.5V9.25Z"),
  fullscreen: svg("M1 5.25V6H2.5V5.25V2.5H5.25H6V1H5.25H2C1.44772 1 1 1.44772 1 2V5.25ZM5.25 14.9994H6V13.4994H5.25H2.5V10.7494V9.99939H1V10.7494V13.9994C1 14.5517 1.44772 14.9994 2 14.9994H5.25ZM15 10V10.75V14C15 14.5523 14.5523 15 14 15H10.75H10V13.5H10.75H13.5V10.75V10H15ZM10.75 1H10V2.5H10.75H13.5V5.25V6H15V5.25V2C15 1.44772 14.5523 1 14 1H10.75Z"),
  check: svg("M15.5607 3.99999L15.0303 4.53032L6.23744 13.3232C5.55403 14.0066 4.44599 14.0066 3.76257 13.3232L4.2929 12.7929L3.76257 13.3232L0.969676 10.5303L0.439346 9.99999L1.50001 8.93933L2.03034 9.46966L4.82323 12.2626C4.92086 12.3602 5.07915 12.3602 5.17678 12.2626L13.9697 3.46966L14.5 2.93933L15.5607 3.99999Z"),
  close: svg("M12.4697 13.5303L13 14.0607L14.0607 13L13.5303 12.4697L9.06065 7.99999L13.5303 3.53032L14.0607 2.99999L13 1.93933L12.4697 2.46966L7.99999 6.93933L3.53032 2.46966L2.99999 1.93933L1.93933 2.99999L2.46966 3.53032L6.93933 7.99999L2.46966 12.4697L1.93933 13L2.99999 14.0607L3.53032 13.5303L7.99999 9.06065L12.4697 13.5303Z"),
};

/** Streamdown's `shadow-lg`, the same in every theme. */
const MENU_SHADOWS = [
  { x: 0, y: 10, blur: 15, spread: -3, color: "#0000001a" },
  { x: 0, y: 4, blur: 6, spread: -4, color: "#0000001a" },
];

/** Streamdown's table controls: Copy (14 pt icon), Download and full screen (16 pt). */
export const TABLE_ACTIONS = [
  { id: "copy", label: "Copy table", svg: ICON.copy, view: 16, size: 14 },
  { id: "download", label: "Download table", svg: ICON.download, view: 16, size: 16 },
  { id: "fullscreen", label: "View fullscreen", svg: ICON.fullscreen, view: 16, size: 16 },
];

const COPIED_ACTIONS = TABLE_ACTIONS.map((a) => (a.id === "copy" ? { ...a, svg: ICON.check } : a));
const COPIED_MS = 2000;

/** Streamdown's copied state: the copy icon shows a check for two seconds after a copy. */
function useCopied(): [boolean, () => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const mark = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setCopied(true);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  }, []);
  return [copied, mark];
}

type Table = { rows: string[][]; align: TableAction["align"] };
type Format = "md" | "csv" | "tsv";

const COPY_FORMATS: { id: Format; label: string; title: string }[] = [
  { id: "md", label: "Markdown", title: "Copy table as Markdown" },
  { id: "csv", label: "CSV", title: "Copy table as CSV" },
  { id: "tsv", label: "TSV", title: "Copy table as TSV" },
];

const DOWNLOAD_FORMATS: { id: Format; label: string; title: string }[] = [
  { id: "csv", label: "CSV", title: "Download table as CSV" },
  { id: "md", label: "Markdown", title: "Download table as Markdown" },
];

function csv({ rows }: Table): string {
  const field = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return rows.map((r) => r.map(field).join(",")).join("\n");
}

function tsv({ rows }: Table): string {
  const field = (v: string) => v.replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
  return rows.map((r) => r.map(field).join("\t")).join("\n");
}

const mdCell = (v: string) => v.replace(/[\\|\n&<>]/g, (ch) => ({ "\\": "\\\\", "|": "\\|", "\n": "<br>", "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch] ?? ch);

function markdownTable({ rows }: Table, rule: (i: number) => string = () => "---"): string {
  const [head, ...body] = rows;
  if (!head?.length) return "";
  const line = (cells: string[]) => `| ${head.map((_, i) => mdCell(cells[i] ?? "")).join(" | ")} |`;
  return [line(head), `| ${head.map((_, i) => rule(i)).join(" | ")} |`, ...body.map(line)].join("\n");
}

const htmlText = (v: string) => v.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch] ?? ch);

function html({ rows }: Table): string {
  const [head, ...body] = rows;
  const row = (cells: string[], tag: string) => `<tr>${cells.map((c) => `<${tag}>${htmlText(c)}</${tag}>`).join("")}</tr>`;
  return `<table><thead>${head ? row(head, "th") : ""}</thead><tbody>${body.map((r) => row(r, "td")).join("")}</tbody></table>`;
}

const text = (t: Table, f: Format) => (f === "csv" ? csv(t) : f === "tsv" ? tsv(t) : markdownTable(t));

async function copyTable(t: Table, f: Format) {
  const body = text(t, f);
  if (!(await engine.writeHTML(html(t), body))) await engine.writeText(body);
}

const downloadTable = (t: Table, f: Format) => engine.saveText(f === "csv" ? `﻿${csv(t)}` : markdownTable(t), f === "csv" ? "table.csv" : "table.md");

type Menu = { kind: "copy" | "download"; anchor: string; rect?: TableAction["rect"] };

function FormatMenu({ id, menu, table, onClose, onCopied }: { id: string; menu: Menu; table: Table; onClose: () => void; onCopied: () => void }) {
  const t = useTokens();
  const c = t.c;
  const formats = menu.kind === "copy" ? COPY_FORMATS : DOWNLOAD_FORMATS;
  const choose = (f: Format) => {
    onClose();
    void (menu.kind === "copy" ? copyTable(table, f).then(onCopied) : downloadTable(table, f));
  };
  return (
    <>
      {menu.rect ? <box id={menu.anchor} fixed absolute={{ left: menu.rect.x, top: menu.rect.y }} w={menu.rect.w} h={menu.rect.h} /> : null}
      <col
        id={`${id}-menu`}
        role="menu"
        anchor={{ to: menu.anchor, side: "bottom", align: "end", gap: 4 }}
        raise={layer.menu}
        modal={{ clickOutside: true }}
        onDismiss={onClose}
        focusGroup
        minW={120}
        radius={8}
        border={c.border}
        fill={c.background}
        clip={8}
        shadows={MENU_SHADOWS}
      >
        {formats.map((f) => (
          <box key={f.id} id={`${id}-menu-${f.id}`} role="menuitem" title={f.title} focusable w="full" px={12} py={8} hover={mix(c.muted, 40, "transparent")} onPress={() => choose(f.id)}>
            <text size={fontSize.md} weight={400} lineHeight={20} color={c.foreground}>
              {f.label}
            </text>
          </box>
        ))}
      </col>
    </>
  );
}

function fullscreenStyle(t: Tokens) {
  const c = t.c;
  const cell = { size: fontSize.md, weight: 400, lineHeight: 20, tracking: 0 };
  return {
    ...markdownStyle(t),
    text: c.foreground,
    body: cell,
    table: [c.border, mix(c.muted, 80, "transparent")],
    tableOutline: c.border,
    tableRadius: 0,
    tableRules: c.border,
    tableHeaderRule: c.border,
    tableHeaderText: c.foreground,
    tableHeaderWeight: 600,
    tableCellPadding: [16, 8],
    tableHeaderPad: [16, 8],
    tableFlushLeft: false,
    tableFont: cell,
    tableFullWidth: true,
    tableMargin: [0, 0],
    tableFrame: undefined,
  };
}

function ControlButton({ id, label, icon, size, onPress, round = false }: { id: string; label: string; icon: string; size: number; onPress: () => void; round?: boolean }) {
  const t = useTokens();
  const c = t.c;
  return (
    <box id={id} role="button" label={label} title={label} focusable w={size + 8} h={size + 8} center radius={round ? 6 : undefined} hover={round ? c.muted : undefined} hoverColor={c.foreground} onPress={onPress}>
      <icon svg={icon} view={16} size={size} color={c.mutedForeground} />
    </box>
  );
}

function Fullscreen({ id, table, onClose }: { id: string; table: Table; onClose: () => void }) {
  const t = useTokens();
  const [menu, setMenu] = useState<Menu | null>(null);
  const [copied, markCopied] = useCopied();
  const style = derive(t, "table-fullscreen", fullscreenStyle);
  const align = (i: number) => ({ center: ":---:", end: "---:" })[table.align[i] as "center" | "end"] ?? "---";
  return (
    <col id={id} role="dialog" label="View fullscreen" fixed inset={0} raise={layer.lightbox} fill={t.c.background} modal={{ clickOutside: false }} onDismiss={onClose}>
      <row pad={16} justify="end" align="center" gap={4}>
        <ControlButton id={`${id}-copy`} label="Copy table" icon={copied ? ICON.check : ICON.copy} size={14} onPress={() => setMenu({ kind: "copy", anchor: `${id}-copy` })} />
        <ControlButton id={`${id}-download`} label="Download table" icon={ICON.download} size={16} onPress={() => setMenu({ kind: "download", anchor: `${id}-download` })} />
        <ControlButton id={`${id}-close`} label="Exit fullscreen" icon={ICON.close} size={16} round onPress={onClose} />
      </row>
      <col grow={1} minH={0} scrollY scrollX px={16} pb={16}>
        <markdown id={`${id}-table`} src={markdownTable(table, align)} mdStyle={style} w="full" />
      </col>
      {menu ? <FormatMenu id={`${id}-fs`} menu={menu} table={table} onClose={() => setMenu(null)} onCopied={markCopied} /> : null}
    </col>
  );
}

type TableFrameStyle = { actions: typeof TABLE_ACTIONS; actionsOnHover?: boolean };

/** Streamdown's table controls for a `<markdown>`: pass `onTableAction` to it, its `mdStyle` through `withFrame`, and render `overlay` beside it. */
export function useTableActions(id: string): { onTableAction: (a: TableAction) => void; withFrame: <S extends { tableFrame: TableFrameStyle }>(style: S) => S; overlay: ReactNode } {
  const [state, setState] = useState<{ table: Table; menu: Menu | null; fullscreen: boolean } | null>(null);
  const [copied, markCopied] = useCopied();
  const onTableAction = useCallback(
    (a: TableAction) => {
      const table = { rows: a.rows, align: a.align };
      if (a.action === "fullscreen") return setState({ table, menu: null, fullscreen: true });
      const kind = a.action === "download" ? "download" : "copy";
      if (!a.rect) return void (kind === "copy" ? copyTable(table, "md").then(markCopied) : downloadTable(table, "csv"));
      setState({ table, menu: { kind, anchor: `${id}-table-anchor`, rect: a.rect }, fullscreen: false });
    },
    [id, markCopied],
  );
  const close = () => setState(null);
  const overlay = !state ? null : state.fullscreen ? (
    <Fullscreen id={`${id}-table-fullscreen`} table={state.table} onClose={close} />
  ) : state.menu ? (
    <FormatMenu id={`${id}-table`} menu={state.menu} table={state.table} onClose={close} onCopied={markCopied} />
  ) : null;
  const pinned = !!state?.menu;
  const withFrame = useCallback(
    <S extends { tableFrame: TableFrameStyle }>(style: S): S =>
      copied || pinned ? { ...style, tableFrame: { ...style.tableFrame, actions: copied ? COPIED_ACTIONS : style.tableFrame.actions, actionsOnHover: pinned ? false : style.tableFrame.actionsOnHover } } : style,
    [copied, pinned],
  );
  return { onTableAction, withFrame, overlay };
}
