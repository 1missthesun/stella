// How a surface places a view whose content is narrower than the surface: views are written
// narrow-first (one column, `maxWidth` around 640), and a chat card or the panel can be wider, so
// the column sits in the middle rather than against the left edge. A view that fills the width is
// left as it is. Pure, shared by every renderer.
import type { ViewChild, ViewNode } from "./protocol";

/** The prop a renderer reads to centre a node in its parent's width (set only by `centreViewContent`). */
export const VIEW_CENTRE_PROP = "$centre";

const isNode = (child: ViewChild | null | undefined): child is ViewNode => typeof child === "object" && child !== null;

/** A width that leaves room beside it: points, "fit", or a percentage under 100. */
const narrows = (value: unknown): boolean =>
  typeof value === "number" || value === "fit" || (typeof value === "string" && /^\d+(\.\d+)?%$/u.test(value) && parseFloat(value) < 100);

const limitsWidth = (node: ViewNode): boolean => narrows(node.p?.maxWidth) || narrows(node.p?.width);

/** A plain vertical wrapper (no width of its own, nothing beside its one child) the content column sits in. */
const isWrapper = (node: ViewNode): boolean => {
  if (node.t !== "Column" && !(node.t === "Scroll" && !node.p?.horizontal)) return false;
  const align = node.p?.align;
  if (align !== undefined && align !== "stretch" && align !== "center") return false;
  return (node.c ?? []).filter((child) => !(typeof child === "string" && !child.trim())).length === 1;
};

const LAYOUT_TYPES = new Set(["Column", "Row", "Grid", "Stack", "Scroll", "Pressable"]);
const MAX_DEPTH = 4;

const centred = new WeakMap<ViewNode, ViewChild>();

/**
 * The tree with its content column marked to sit centred: the root, or the first node down a chain
 * of plain wrappers (a Column or Scroll holding just it), that limits its own width. The marked node
 * keeps its width rule (and fills up to its `maxWidth` when it has no width), and every other node
 * is the same object as before, so renderers' memoised subtrees stay as they are.
 */
export function centreViewContent(tree: ViewChild | null): ViewChild | null {
  if (!isNode(tree)) return tree;
  const cached = centred.get(tree);
  if (cached) return cached;
  const mark = (node: ViewNode, depth: number): ViewNode | null => {
    if (!LAYOUT_TYPES.has(node.t)) return null;
    if (limitsWidth(node)) {
      const p = node.p ?? {};
      return { ...node, p: { ...p, ...(p.width === undefined ? { width: "full" } : {}), [VIEW_CENTRE_PROP]: true } };
    }
    if (depth >= MAX_DEPTH || !isWrapper(node)) return null;
    const children = node.c ?? [];
    const at = children.findIndex(isNode);
    const inner = at >= 0 ? mark(children[at] as ViewNode, depth + 1) : null;
    if (!inner) return null;
    const c = children.slice();
    c[at] = inner;
    return { ...node, c };
  };
  const out = mark(tree, 0) ?? tree;
  centred.set(tree, out);
  return out;
}
