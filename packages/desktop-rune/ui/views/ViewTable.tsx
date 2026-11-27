// A view's `<Table>`: columns sized to their content (or `fr` shares of the free width), a sticky
// header, sorting on sortable columns, striping, and rows that press.
import { useMemo, useState, type ReactNode } from "react";
import type { ViewChild, ViewNode } from "@stella/views/protocol";
import { estimateTextWidth, formatValue } from "@stella/views/format";
import { Icon, Icons } from "../kit";
import { font, fontSize, look, mix, useTokens } from "../theme";
import type { Paint } from "./ViewRenderer";

type Column = { key: string; title: string; align?: "start" | "center" | "end"; width?: number | string; format?: string; currency?: string; sortable?: boolean };

const BODY = look(fontSize.base, 400, { lh: 1.45 });
const HEAD = look(fontSize.sm, font.emphasisWeight, { lh: 1.4 });

const cellText = (row: Record<string, unknown>, column: Column) => formatValue(row[column.key], column.format, { currency: column.currency });

export function ViewTable({ id, node, paint, onRowPress, renderSlot }: { id: string; node: ViewNode; paint: Paint; onRowPress?: (v: unknown) => void; renderSlot: (nodes: ViewChild[], key: string) => ReactNode }) {
  const t = useTokens();
  const p = node.p ?? {};
  const columns = (Array.isArray(p.columns) ? p.columns : []) as Column[];
  const rows = (Array.isArray(p.rows) ? p.rows : []) as Record<string, unknown>[];
  const cells = (Array.isArray(p.cells) ? p.cells : null) as (ViewChild[] | null)[][] | null;
  const initial = p.sort && typeof p.sort === "object" ? (p.sort as { key: string; direction: "asc" | "desc" }) : null;
  const [sort, setSort] = useState(initial);

  const order = useMemo(() => {
    const index = rows.map((_, i) => i);
    if (!sort) return index;
    const dir = sort.direction === "desc" ? -1 : 1;
    return index.sort((a, b) => {
      const x = rows[a]?.[sort.key];
      const y = rows[b]?.[sort.key];
      if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
      return String(x ?? "").localeCompare(String(y ?? ""), undefined, { numeric: true }) * dir;
    });
  }, [rows, sort]);

  // Auto columns fit their longest value; the first text column (or the first column) takes the spare width.
  const widths = useMemo(() => {
    const anyFr = columns.some((column) => typeof column.width === "string" && column.width.endsWith("fr"));
    const flexible = anyFr ? -1 : Math.max(0, columns.findIndex((column) => column.width === undefined && column.align !== "end" && rows.every((row) => typeof row[column.key] !== "number")));
    return columns.map((column, index): { w?: number; basis?: number; grow?: number } => {
      if (typeof column.width === "number") return { w: column.width };
      if (typeof column.width === "string" && column.width.endsWith("fr")) return { basis: 0, grow: Number.parseFloat(column.width) || 1 };
      let widest = estimateTextWidth(column.title, fontSize.sm) + (column.sortable ? 18 : 0);
      for (const row of rows.slice(0, 200)) widest = Math.max(widest, estimateTextWidth(cellText(row, column), fontSize.base));
      const fit = Math.min(320, Math.max(48, Math.ceil(widest) + 28));
      return index === flexible ? { basis: fit, grow: 1 } : { w: fit };
    });
  }, [columns, rows]);
  const stripe = mix(t.c.foreground, 3, "transparent");
  const headFill = t.c.background;
  const justify = (a?: string) => (a === "end" ? "end" : a === "center" ? "center" : "start");

  const header = (
    <row {...(p.maxHeight !== undefined ? { sticky: "top" as const, fill: headFill } : {})} borderSides={[0, 0, 1, 0]} border={t.c.border} w="full" minW="fit">
      {columns.map((column, c) => {
        const active = sort?.key === column.key;
        const press = column.sortable
          ? () => setSort(active ? (sort!.direction === "asc" ? { key: column.key, direction: "desc" } : null) : { key: column.key, direction: "asc" })
          : undefined;
        return (
          <row key={column.key} {...widths[c]} shrink={false} px={12} py={8} gap={4} justify={justify(column.align)} {...(press ? { onPress: press, cursor: "pointer", hoverFill: mix(t.c.foreground, 4, "transparent") } : {})}>
            <text {...HEAD} color={t.c.textWeak} nowrap>
              {column.title}
            </text>
            {active ? (
              <box rotate={sort!.direction === "asc" ? Math.PI : 0}>
                <Icon icon={Icons.stella.ChevronDown} size={12} color={t.c.textWeak} />
              </box>
            ) : null}
          </row>
        );
      })}
    </row>
  );

  return (
    <col id={id} w="full" scrollX {...(p.maxHeight !== undefined ? { maxH: p.maxHeight as number, scrollY: true } : {})} radius={8} border={t.c.border} borderWidth={1} clip={8}>
      <col minW="full" w="fit">
      {header}
      {order.map((r, position) => {
        const row = rows[r] ?? {};
        return (
          <row
            key={String(row.id ?? r)}
            w="full"
            minW="fit"
            {...(p.striped && position % 2 === 1 ? { fill: stripe } : {})}
            {...(position < order.length - 1 ? { borderSides: [0, 0, 1, 0], border: mix(t.c.border, 60, "transparent") } : {})}
            {...(onRowPress ? { onPress: () => onRowPress(r), cursor: "pointer", hoverFill: mix(t.c.foreground, 4, "transparent"), pressFill: mix(t.c.foreground, 7, "transparent") } : {})}
          >
            {columns.map((column, c) => {
              const custom = cells?.[r]?.[c];
              return (
                <row key={column.key} {...widths[c]} shrink={false} px={12} py={8} justify={justify(column.align)} align="center">
                  {custom ? (
                    renderSlot(custom, `c${r}.${c}`)
                  ) : (
                    <text {...BODY} color={paint("text")} {...(column.align === "end" || typeof row[column.key] === "number" ? { features: "'tnum' 1" } : {})} maxLines={2} truncate>
                      {cellText(row, column)}
                    </text>
                  )}
                </row>
              );
            })}
          </row>
        );
      })}
      </col>
    </col>
  );
}
