import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

type Node = { type: string; value?: string; children?: Node[]; spread?: boolean };

const parser = unified().use(remarkParse).use(remarkGfm);

type Piece = { text: string } | { breaks: number };

const inline = (node: Node): string => {
  switch (node.type) {
    case "text":
    case "inlineCode":
      return node.value ?? "";
    case "break":
      return "\n";
    case "image":
    case "html":
    case "footnoteReference":
      return "";
    default:
      return (node.children ?? []).map(inline).join("");
  }
};

/**
 * The text a browser's `innerText` gives for chat Markdown as Streamdown draws it: paragraphs
 * apart by a blank line, other blocks by a line break, table cells by tabs, no Markdown syntax.
 */
export function markdownPlainText(source: string): string {
  const pieces: Piece[] = [];
  const block = (breaks: number, text?: string) => {
    pieces.push({ breaks });
    if (text !== undefined) pieces.push({ text });
    pieces.push({ breaks });
  };
  const walk = (node: Node) => {
    switch (node.type) {
      case "paragraph":
        block(2, inline(node));
        return;
      case "heading":
        block(1, inline(node));
        return;
      case "code":
        block(1, node.value ?? "");
        return;
      case "thematicBreak":
        block(1);
        return;
      case "table":
        block(1, (node.children ?? []).map((row) => (row.children ?? []).map(inline).join("\t")).join("\n"));
        return;
      case "list":
        pieces.push({ breaks: 1 });
        for (const item of node.children ?? []) {
          pieces.push({ breaks: 1 });
          for (const child of item.children ?? []) {
            if (child.type === "paragraph" && !node.spread && !item.spread) pieces.push({ breaks: 1 }, { text: inline(child) }, { breaks: 1 });
            else walk(child);
          }
          pieces.push({ breaks: 1 });
        }
        pieces.push({ breaks: 1 });
        return;
      case "html":
        return;
      default:
        for (const child of node.children ?? []) walk(child);
    }
  };
  walk(parser.parse(source) as Node);
  let out = "";
  let pending = 0;
  for (const piece of pieces) {
    if ("breaks" in piece) {
      pending = Math.max(pending, piece.breaks);
      continue;
    }
    if (out && pending) out += "\n".repeat(pending);
    out += piece.text;
    pending = 0;
  }
  return out;
}
