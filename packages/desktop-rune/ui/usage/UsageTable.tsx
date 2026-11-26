import { useState, type ReactNode } from "react";
import { T, useTextBase } from "../kit/compat";
import { useUsage } from "./usage.styles";

export type UsageColumn = { head: string; end?: boolean; cells: ReactNode[] };

/**
 * desktop-ui's `.usage-table`: an auto-layout, border-collapsed HTML table at 100% width. Columns take their
 * content width and share any extra width in proportion to it; past the panel's width the table scrolls.
 */
export function UsageTable({ columns, rows, rowContentH, measureKey }: { columns: UsageColumn[]; rows: number; rowContentH: number; measureKey: string }) {
  const s = useUsage();
  const lh = useTextBase().lh;
  const [measured, setMeasured] = useState<{ key: string; widths: (number | undefined)[] }>({ key: measureKey, widths: [] });
  const widths = measured.key === measureKey ? measured.widths : [];
  const headH = (s.usageTableHead.size as number) * lh + 20.5;
  const rowH = (last: boolean) => rowContentH + (last ? 20.5 : 21);
  const measure = (index: number, w: number) => {
    if (widths[index] !== undefined) return;
    setMeasured((prev) => {
      const base = prev.key === measureKey ? prev.widths : [];
      if (base[index] !== undefined) return prev;
      const next = [...base];
      next[index] = w;
      return { key: measureKey, widths: next };
    });
  };
  return (
    <col {...s.usageTableScroll}>
      <row minW="full" align="start">
        <col absolute={{ left: 0, top: 0, right: 0 }}>
          <row w="full" h={headH} {...s.usageTableLine} />
          {Array.from({ length: rows }, (_, i) => (
            <row key={i} w="full" h={rowH(i === rows - 1)} {...(i === rows - 1 ? null : s.usageTableLine)} {...s.usageTableRowHover} />
          ))}
        </col>
        {columns.map((column, index) => {
          const natural = widths[index];
          const edge = { ...(index === 0 ? { pl: 0 } : null), ...(index === columns.length - 1 ? { pr: 0 } : null) };
          return (
            <col key={column.head} w={natural} grow={natural ?? 0} shrink={false} onLayout={(r) => measure(index, r.w)} align={column.end ? "end" : "start"}>
              <col h={headH} {...s.usageTableHead} {...edge} align={column.end ? "end" : "start"}>
                <T {...s.usageTableHead} px={0}>{column.head}</T>
              </col>
              {column.cells.map((cell, row) => (
                <col key={row} h={rowH(row === rows - 1)} {...s.usageTableCell} {...edge} align={column.end ? "end" : "start"}>
                  {cell}
                </col>
              ))}
            </col>
          );
        })}
      </row>
    </col>
  );
}

/** A table cell's plain text: the table's tabular figures. */
export function UsageCellText({ children, ...style }: { children: ReactNode } & Parameters<typeof T>[0]) {
  const s = useUsage();
  return (
    <T size={s.usageTableCell.size} features={s.usageTableCell.features} nowrap {...style}>
      {children}
    </T>
  );
}

/** desktop-ui's `.usage-panel` with its heading: a title, and an optional description, over the panel's content. */
export function UsagePanel({ title, description, afterSummary = false, children }: { title: string; description?: string; afterSummary?: boolean; children: ReactNode }) {
  const s = useUsage();
  return (
    <col {...s.usagePanel} {...(afterSummary ? s.usagePanelAfterSummary : null)}>
      <row {...s.usagePanelHeading}>
        <col shrink minW={0}>
          <T role="heading" {...s.usagePanelTitle}>{title}</T>
          {description ? <T {...s.usagePanelDescription}>{description}</T> : null}
        </col>
      </row>
      {children}
    </col>
  );
}
