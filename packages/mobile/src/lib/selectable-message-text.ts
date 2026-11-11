import {
  getTextContent,
  parseMarkdown,
  type MarkdownNode,
} from "react-native-nitro-markdown";

const PARSER_OPTIONS = { gfm: true, math: false, html: false } as const;

const BLOCK_TYPES = new Set<MarkdownNode["type"]>([
  "paragraph",
  "heading",
  "code_block",
  "blockquote",
  "list",
  "table",
  "horizontal_rule",
  "math_block",
  "html_block",
]);

function inlineText(node: MarkdownNode): string {
  switch (node.type) {
    case "text":
    case "code_inline":
    case "math_inline":
    case "html_inline":
      return node.content ?? "";
    case "soft_break":
      return " ";
    case "line_break":
      return "\n";
    case "image":
      return node.alt ?? "";
    default:
      return (node.children ?? []).map(inlineText).join("");
  }
}

function blocksText(nodes: readonly MarkdownNode[], indent: string): string {
  const blocks: string[] = [];
  let inline = "";
  const flushInline = () => {
    const trimmed = inline.trim();
    if (trimmed) blocks.push(indent + trimmed);
    inline = "";
  };
  for (const node of nodes) {
    if (BLOCK_TYPES.has(node.type)) {
      flushInline();
      const text = blockText(node, indent);
      if (text.trim()) blocks.push(text);
    } else {
      inline += inlineText(node);
    }
  }
  flushInline();
  return blocks.join("\n\n");
}

function listText(node: MarkdownNode, indent: string): string {
  const start = node.start ?? 1;
  return (node.children ?? [])
    .map((item, index) => {
      const marker =
        item.type === "task_list_item"
          ? item.checked
            ? "☑ "
            : "☐ "
          : node.ordered
            ? `${start + index}. `
            : "• ";
      const body = blocksText(item.children ?? [], `${indent}  `)
        .replace(/\n\n+/g, "\n")
        .trimStart();
      return `${indent}${marker}${body}`;
    })
    .join("\n");
}

function tableText(node: MarkdownNode, indent: string): string {
  const rows: string[] = [];
  const visit = (child: MarkdownNode) => {
    if (child.type === "table_row") {
      rows.push(
        indent +
          (child.children ?? [])
            .map((cell) => inlineText(cell).trim())
            .join("  |  "),
      );
      return;
    }
    child.children?.forEach(visit);
  };
  node.children?.forEach(visit);
  return rows.join("\n");
}

function blockText(node: MarkdownNode, indent: string): string {
  switch (node.type) {
    case "paragraph":
    case "heading":
      return indent + inlineText(node).trim();
    case "code_block":
    case "math_block":
    case "html_block":
      return getTextContent(node)
        .replace(/\n+$/, "")
        .split("\n")
        .map((line) => indent + line)
        .join("\n");
    case "blockquote":
      return blocksText(node.children ?? [], indent);
    case "list":
      return listText(node, indent);
    case "table":
      return tableText(node, indent);
    case "horizontal_rule":
      return "";
    default:
      return blocksText(node.children ?? [], indent);
  }
}

/**
 * The words of a markdown reply as plain text a text view can select: one
 * paragraph per block, list markers kept, table rows on their own lines with
 * cells separated, and code verbatim.
 */
export function selectableMarkdownText(markdown: string): string {
  const root = parseMarkdown(markdown, PARSER_OPTIONS);
  const text = blocksText(root.children ?? [], "").trim();
  return text || markdown.trim();
}
