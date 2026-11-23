import type { MarkdownNode } from "react-native-nitro-markdown";

export type MarkdownTableData = {
  headers: MarkdownNode[];
  rows: MarkdownNode[][];
  alignments: (string | undefined)[];
};

const MIN_COLUMN_WIDTH = 88;
const MAX_COLUMN_WIDTH = 280;
const MAX_WORD_COLUMN_WIDTH = 360;
const APPROX_CHARACTER_WIDTH = 7;
export const CELL_HORIZONTAL_PADDING = 24;
const WIDTH_STEP = 24;

export function extractMarkdownTable(node: MarkdownNode): MarkdownTableData {
  const headers: MarkdownNode[] = [];
  const rows: MarkdownNode[][] = [];
  const alignments: (string | undefined)[] = [];

  for (const section of node.children ?? []) {
    if (section.type === "table_head") {
      for (const row of section.children ?? []) {
        if (row.type !== "table_row") continue;
        for (const cell of row.children ?? []) {
          headers.push(cell);
          alignments.push(cell.align);
        }
      }
      continue;
    }

    if (section.type === "table_body") {
      for (const row of section.children ?? []) {
        if (row.type === "table_row") rows.push(row.children ?? []);
      }
    }
  }

  return { headers, rows, alignments };
}

function markdownNodeText(node: MarkdownNode): string {
  if (node.children?.length) {
    return node.children.map(markdownNodeText).join("");
  }
  return node.content ?? "";
}

export function estimateMarkdownTableColumnWidths(
  data: MarkdownTableData,
): number[] {
  return data.headers.map((header, columnIndex) => {
    let longestText = markdownNodeText(header).trim().length;
    for (const row of data.rows) {
      const cell = row[columnIndex];
      if (cell) {
        longestText = Math.max(
          longestText,
          markdownNodeText(cell).trim().length,
        );
      }
    }

    const estimated =
      longestText * APPROX_CHARACTER_WIDTH + CELL_HORIZONTAL_PADDING;
    const stepped = Math.ceil(estimated / WIDTH_STEP) * WIDTH_STEP;
    return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, stepped));
  });
}

export function fitMarkdownTableColumnWidths(
  widths: number[],
  viewportWidth: number,
): number[] {
  if (widths.length === 0 || viewportWidth <= 0) return widths;
  const totalWidth = widths.reduce((sum, width) => sum + width, 0);
  if (totalWidth >= viewportWidth) return widths;

  const extraPerColumn = (viewportWidth - totalWidth) / widths.length;
  return widths.map((width) => width + extraPerColumn);
}

export function splitMarkdownWords(node: MarkdownNode): MarkdownNode {
  if (node.type === "soft_break") return { ...node, type: "line_break" };
  return {
    ...node,
    ...(node.content != null && { content: node.content.replace(/\s+/g, "\n") }),
    ...(node.children && { children: node.children.map(splitMarkdownWords) }),
  };
}

export function measuredMarkdownTableColumnWidths(
  naturalTextWidths: number[],
  longestWordWidths: number[],
): number[] {
  const lastColumn = naturalTextWidths.length - 1;
  return naturalTextWidths.map((natural, columnIndex) => {
    const padding = columnIndex === lastColumn ? 0 : CELL_HORIZONTAL_PADDING;
    const wrapped = Math.min(natural, MAX_COLUMN_WIDTH - padding);
    const word = Math.min(longestWordWidths[columnIndex] ?? 0, MAX_WORD_COLUMN_WIDTH - padding);
    // Widths arrive rounded to whole points; a point over keeps the text on its lines.
    const text = Math.ceil(Math.max(wrapped, word)) + 1;
    return Math.max(MIN_COLUMN_WIDTH, text + padding);
  });
}
