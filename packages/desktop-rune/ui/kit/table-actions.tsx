import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { TableAction } from "../../host/rune-jsx/props";
import { derive, fontSize, layer, mix, type Tokens, useTokens } from "../theme";
import { systemFontFamily } from "../theme/system-font";
import { engine } from "./engine";
import { markdownStyle } from "./Markdown";
import { STREAMDOWN_ICON as ICON } from "./streamdown-icons";

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
  const cell = { size: fontSize.md, weight: 400, lineHeight: 20, tracking: 0, family: systemFontFamily() };
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
    tableHeaderPadEdges: [16, 8, 8],
    tableHeaderRuleWidth: 0,
    tableRuleWidth: 1,
    tableOutlineWidth: 1,
    tableFlushLeft: false,
    tableCellsFlushLeft: false,
    tableFlushRight: false,
    tableFont: cell,
    tableFullWidth: true,
    tableMargin: [0, 0],
    tableFrame: undefined,
  };
}

/** Streamdown wraps the copy and download buttons in a `relative` div whose line box runs 3 below the inline button. */
const MENU_BUTTON_LINE_BOX = 3;

function ControlButton({ id, label, icon, size, onPress, round = false }: { id: string; label: string; icon: string; size: number; onPress: () => void; round?: boolean }) {
  const t = useTokens();
  const c = t.c;
  const button = (
    <box id={id} role="button" label={label} title={label} focusable w={size + 8} h={size + 8} center radius={round ? 6 : undefined} hover={round ? c.muted : undefined} hoverColor={c.foreground} onPress={onPress}>
      <icon svg={icon} view={16} size={size} color={c.mutedForeground} />
    </box>
  );
  return round ? button : <col h={size + 8 + MENU_BUTTON_LINE_BOX}>{button}</col>;
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
