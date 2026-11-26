import { createElement, Fragment, useMemo, type ReactNode } from "react";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type { LinkStyle, MarkdownProps } from "../../host/rune-jsx/props";
import { useHost } from "./host";
import { FAMILY, type Css } from "./style";

type Md = { type: string; children?: Md[]; value?: string; depth?: number; ordered?: boolean; start?: number | null; url?: string; alt?: string; lang?: string | null; align?: (string | null)[]; checked?: boolean | null };
type Font = { size?: number; weight?: number; lineHeight?: number; tracking?: number; family?: string; features?: string };
type Style = Record<string, any>;
type Ctx = { s: Style; p: MarkdownProps; codeIndex: { n: number }; tableIndex: { n: number } };

const parser = unified().use(remarkParse).use(remarkGfm);

const px = (v: number | undefined) => (v === undefined ? undefined : `${v}px`);
const pair = (v: unknown, d: [number, number]): [number, number] => (Array.isArray(v) && v.length >= 2 ? [Number(v[0]), Number(v[1])] : d);

function fontCss(f: Font | undefined): Css {
  if (!f) return {};
  const out: Css = {};
  if (f.size) out.fontSize = px(f.size);
  if (f.weight) out.fontWeight = f.weight;
  if (f.lineHeight) out.lineHeight = px(f.lineHeight);
  if (f.tracking !== undefined) out.letterSpacing = px(f.tracking);
  const family = f.family ? FAMILY({ family: f.family }) : undefined;
  if (family) out.fontFamily = family;
  if (f.features) out.fontFeatureSettings = f.features;
  return out;
}

const margin = (v: unknown, d: [number, number]): Css => {
  const [t, b] = pair(v, d);
  return { marginTop: px(t), marginBottom: px(b) };
};

function textOf(n: Md): string {
  if (n.value !== undefined) return n.value;
  return (n.children ?? []).map(textOf).join("");
}

function linkStyleFor(href: string, styles: LinkStyle[] | undefined): LinkStyle | undefined {
  return styles?.find((l) => href.startsWith(l.prefix));
}

function inlines(nodes: Md[] | undefined, c: Ctx): ReactNode[] {
  return (nodes ?? []).map((n, i) => inline(n, c, i));
}

function inline(n: Md, c: Ctx, key: number): ReactNode {
  const { s, p } = c;
  switch (n.type) {
    case "text":
      return n.value;
    case "strong":
      return createElement("strong", { key, style: { fontWeight: s.strongWeight ?? 600 } }, inlines(n.children, c));
    case "emphasis":
      return createElement("em", { key }, inlines(n.children, c));
    case "delete":
      return createElement("del", { key }, inlines(n.children, c));
    case "inlineCode": {
      const [scale, weight] = pair(s.inlineCodeFont, [0.9, 500]);
      const body = (s.body ?? s.bodyFont ?? {}) as Font;
      return createElement("code", {
        key,
        style: {
          fontFamily: "var(--rune-mono)", fontSize: px((body.size ?? 14) * scale), fontWeight: weight,
          background: s.inlineCodeBg, color: s.inlineCodeText, padding: `2px ${s.inlineCodePad ?? 4}px`, borderRadius: "4px",
          boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone",
        },
      }, n.value);
    }
    case "break":
      return createElement("br", { key });
    case "link": {
      const href = n.url ?? "";
      const look = linkStyleFor(href, p.linkStyles);
      const style: Css = { color: look?.color ?? s.link, textDecoration: "none", cursor: "pointer" };
      if (look?.weight) style.fontWeight = look.weight;
      if (look?.bg) {
        style.background = look.bg;
        style.borderRadius = "4px";
        style.padding = `0 ${look.pad ?? 3}px`;
      }
      if (look?.underline) {
        style.textDecoration = "underline";
        style.textDecorationColor = look.underline;
        style.textUnderlineOffset = "2px";
      }
      if (look?.ring) style.boxShadow = `inset 0 0 0 ${look.ring[1]}px ${look.ring[0]}`;
      return createElement("a", {
        key, href, style, className: look?.hover ? "mdl mdlh" : "mdl", title: look?.help,
        "data-hover-color": look?.hover?.color ?? s.linkHover,
        onClick: (e: React.MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          p.onLink?.(href);
        },
        onContextMenu: p.onLinkContextMenu ? (e: React.MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          p.onLinkContextMenu?.({ href, x: e.clientX, y: e.clientY });
        } : undefined,
      }, inlines(n.children, c));
    }
    case "image": {
      const src = p.images?.[n.url ?? ""] ?? n.url ?? "";
      return createElement("img", {
        key, src, alt: n.alt ?? "", loading: "lazy",
        style: { maxWidth: "100%", borderRadius: px(p.imageRadius ?? 0), display: "inline-block", cursor: p.onImage ? "pointer" : undefined, verticalAlign: "middle" },
        onClick: p.onImage ? (e: React.MouseEvent) => { e.stopPropagation(); p.onImage?.({ src: n.url ?? "", alt: n.alt ?? "" }); } : undefined,
      });
    }
    case "html":
      return n.value;
    case "footnoteReference":
      return createElement("sup", { key }, `[${textOf(n)}]`);
    default:
      return n.children ? createElement(Fragment, { key }, inlines(n.children, c)) : n.value ?? null;
  }
}

function codeBlock(n: Md, c: Ctx, key: number): ReactNode {
  const { s, p } = c;
  const index = c.codeIndex.n++;
  const frame = (s.codeFrame ?? {}) as Style;
  const inside = (frame.inside ?? null) as { fill?: string; border?: string; radius?: number; pad?: [number, number, number] } | null;
  const [padX, padTop, padBottom] = inside?.pad ?? [16, 12, 12];
  const language = n.lang ?? null;
  const source = n.value ?? "";
  const actions = (frame.actions ?? []) as { id: string; label?: string; svg?: string; view?: number }[];
  const at = (frame.actionsAt ?? null) as [number, number] | null;
  const fill = inside?.fill ?? s.codeBlockFill ?? (Array.isArray(s.codeBlock) ? s.codeBlock[0] : undefined);
  const border = inside?.border ?? s.codeBlockBorder ?? (Array.isArray(s.codeBlock) ? s.codeBlock[1] : undefined);
  const radius = inside?.radius ?? s.codeBlockRadius;
  const actionRow = actions.length
    ? createElement("div", {
      className: frame.actionsOnHover ? "mdca hov" : "mdca",
      style: { position: "absolute", top: px(at?.[0] ?? padTop), right: px(at?.[1] ?? padX), display: "flex", gap: "2px", color: frame.actionColor, "--mdca-hover": frame.actionHover } as Css,
    }, actions.map((a) => createElement("button", {
      key: a.id, type: "button", className: "mdcb", "aria-label": a.label ?? a.id, title: a.label ?? (a.id === "copy" ? "Copy" : a.id === "download" ? "Download" : a.id),
      onClick: (e: React.MouseEvent) => {
        e.stopPropagation();
        p.onCodeAction?.({ action: a.id, index, language, source });
      },
      dangerouslySetInnerHTML: a.svg ? { __html: `<svg viewBox="0 0 ${a.view ?? 24} ${a.view ?? 24}" width="14" height="14" fill="none">${a.svg}</svg>` } : undefined,
    }, a.svg ? undefined : a.label)))
    : null;
  const label = language && frame.label
    ? createElement("div", { style: { color: frame.label, fontSize: px(frame.labelSize ?? 12), lineHeight: 1.5, marginBottom: px(frame.labelGap ?? 4), paddingRight: "60px", fontFamily: "var(--rune-sans)" } }, language)
    : null;
  const [, codePadY] = pair(s.codeBlockPadding, [0, 0]);
  return createElement("div", {
    key, className: "mdcode",
    style: {
      ...margin(s.codeMargin, [0, 12]), position: "relative", background: fill, borderRadius: px(radius && radius > 0 ? radius : 8),
      boxShadow: border ? `inset 0 0 0 1px ${border}` : undefined, padding: `${padTop}px ${padX}px ${padBottom}px`,
    },
  }, label, createElement("pre", {
    style: { margin: 0, padding: `${codePadY}px 0`, overflowX: "auto", whiteSpace: "pre", ...fontCss({ family: "mono", ...(s.codeBlockFont as Font) }), color: s.codeBlockText, scrollbarWidth: "thin" },
  }, createElement("code", null, source)), actionRow);
}

type TableActionP = { id: string; label?: string; svg?: string; view?: number; size?: number };

function tableActions(n: Md, c: Ctx): ReactNode {
  const { s, p } = c;
  const frame = s.tableFrame as Style | undefined;
  const actions = (frame?.actions ?? []) as TableActionP[];
  if (!frame || !actions.length) return null;
  const index = c.tableIndex.n++;
  const [top, right] = pair(frame.actionsAt, [6, 0]);
  const pad = frame.buttonPad ?? 4;
  const fire = (a: TableActionP, button: HTMLElement | null) => {
    const table = button?.closest(".mdtable")?.querySelector("table");
    const rows = table ? [...table.rows].map((r) => [...r.cells].map((cell) => cell.textContent ?? "")) : [];
    const align = (n.align ?? []).map((x) => (x === "center" ? "center" : x === "right" ? "end" : "start") as "start" | "center" | "end");
    const b = button?.getBoundingClientRect();
    p.onTableAction?.({ action: a.id, index, rows, align, rect: b && b.width ? { x: b.x, y: b.y, w: b.width, h: b.height } : null });
  };
  return createElement("div", {
    className: frame.actionsOnHover === false ? "mdta" : "mdta hov",
    style: { top: px(top), right: px(right), gap: px(frame.gap ?? 4), background: frame.actionsFill, color: frame.actionColor, "--mdca-hover": frame.actionHover } as Css,
  }, actions.map((a) => {
    const size = a.size ?? 14;
    return createElement("button", {
      key: a.id, type: "button", className: "mdtb", "aria-label": a.label ?? a.id, title: a.label ?? a.id,
      style: { width: px(size + 2 * pad), height: px(size + 2 * pad) },
      onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        fire(a, e.currentTarget);
      },
      dangerouslySetInnerHTML: { __html: `<svg viewBox="0 0 ${a.view ?? 16} ${a.view ?? 16}" width="${size}" height="${size}" fill="none">${a.svg ?? ""}</svg>` },
    });
  }));
}

function table(n: Md, c: Ctx, key: number): ReactNode {
  const { s } = c;
  const [cellX, cellY] = pair(s.tableCellPadding, [12, 8]);
  const [headX, headY] = pair(s.tableHeaderPad, [cellX, cellY]);
  const rules = s.tableRules ?? (Array.isArray(s.table) ? s.table[0] : undefined);
  const headerFill = Array.isArray(s.table) ? s.table[1] : undefined;
  const flush = !!s.tableFlushLeft;
  const rows = n.children ?? [];
  const align = n.align ?? [];
  const cell = (row: Md, r: number) => (row.children ?? []).map((cellNode, i) => {
    const header = r === 0;
    const [x, y] = header ? [headX, headY] : [cellX, cellY];
    const last = (row.children?.length ?? 0) - 1;
    const style: Css = {
      textAlign: (align[i] ?? "left") as Css["textAlign"],
      padding: flush ? `${y}px ${i === last ? 0 : 2 * x}px ${y}px 0` : `${y}px ${x}px`,
      borderBottom: header ? `1px solid ${s.tableHeaderRule ?? rules}` : r < rows.length - 1 ? `1px solid ${rules}` : undefined,
      verticalAlign: "top",
    };
    if (header) {
      style.color = s.tableHeaderText;
      style.fontWeight = s.tableHeaderWeight ?? 600;
      if (headerFill) style.background = headerFill;
    }
    return createElement(header ? "th" : "td", { key: i, style }, inlines(cellNode.children, c));
  });
  const actions = tableActions(n, c);
  const scroller = createElement("div", { style: { overflowX: "auto", scrollbarWidth: "thin" } },
    createElement("table", { style: { borderCollapse: "collapse", width: s.tableFullWidth ? "100%" : undefined, ...fontCss(s.tableFont as Font), border: s.tableOutline ? `1px solid ${s.tableOutline}` : undefined } },
      createElement("thead", null, rows[0] ? createElement("tr", null, cell(rows[0], 0)) : null),
      createElement("tbody", null, rows.slice(1).map((row, r) => createElement("tr", { key: r }, cell(row, r + 1))))));
  return createElement("div", { key, className: actions ? "mdtable" : undefined, style: { ...margin(s.tableMargin, [16, 16]), position: actions ? "relative" : undefined } }, scroller, actions);
}

function blocks(nodes: Md[] | undefined, c: Ctx, nested = false): ReactNode[] {
  return (nodes ?? []).map((n, i) => block(n, c, i, nested));
}

function block(n: Md, c: Ctx, key: number, nested: boolean): ReactNode {
  const { s } = c;
  switch (n.type) {
    case "paragraph":
      return createElement("p", { key, style: nested ? { margin: 0 } : margin(s.paragraphMargin, [0, 12]) }, inlines(n.children, c));
    case "heading": {
      const level = Math.min(6, Math.max(1, n.depth ?? 1));
      const fonts = (Array.isArray(s.headings) ? s.headings : s.headingFont ? Object.values(s.headingFont) : []) as Font[];
      const margins = (Array.isArray(s.headingMargins) ? s.headingMargins : s.headingMargin ? Object.values(s.headingMargin) : []) as [number, number][];
      const f = fonts[Math.min(level, fonts.length) - 1];
      return createElement(`h${level}`, { key, style: { ...margin(margins[Math.min(level, margins.length) - 1], [16, 6]), ...fontCss(f), color: s.tableHeaderText ?? undefined } }, inlines(n.children, c));
    }
    case "code":
      return codeBlock(n, c, key);
    case "blockquote": {
      const [rule, width, pad, color] = Array.isArray(s.quote) ? s.quote : [s.quoteRule, 2, 12, undefined];
      return createElement("blockquote", { key, style: { ...margin(s.quoteMargin, [16, 16]), marginLeft: 0, marginRight: 0, boxShadow: `inset ${width}px 0 0 0 ${rule}`, paddingLeft: px(pad + width), color } }, blocks(n.children, c));
    }
    case "list": {
      const [indent, gap] = pair(s.list, [24, 4]);
      const [nestedIndent] = pair(s.listNestedIndent, [indent, indent]);
      const tag = n.ordered ? "ol" : "ul";
      const tight = (n.children ?? []).every((li) => (li.children ?? []).length <= 1 || (li.children ?? []).every((x) => x.type !== "paragraph" || true));
      return createElement(tag, {
        key, start: n.ordered && n.start && n.start !== 1 ? n.start : undefined,
        style: { ...(nested ? { marginTop: "4px", marginBottom: "4px" } : margin(s.listMargin, [16, 16])), paddingLeft: px(nested ? nestedIndent : indent), listStyleType: n.ordered ? "decimal" : nested ? "circle" : "disc", listStylePosition: s.listMarkersOutside === false ? "inside" : "outside", "--md-marker": s.muted } as Css,
      }, (n.children ?? []).map((li, i) => createElement("li", { key: i, style: { marginTop: i ? px(gap) : 0 } },
        li.checked !== null && li.checked !== undefined ? createElement("input", { type: "checkbox", checked: li.checked, readOnly: true, style: { marginRight: "6px" } }) : null,
        blocks(li.children, c, tight))));
    }
    case "thematicBreak":
      return createElement("hr", { key, style: { ...margin(s.ruleMargin, [24, 24]), border: "none", height: 0, borderTop: `1px solid ${s.rule}` } });
    case "table":
      return table(n, c, key);
    case "html":
      return createElement("p", { key, style: margin(s.paragraphMargin, [0, 12]) }, n.value);
    case "definition":
    case "footnoteDefinition":
      return null;
    default:
      return n.children ? createElement("div", { key }, inlines(n.children, c)) : null;
  }
}

/** `<markdown>`: the same mdast as the engine's rune-kit Markdown, drawn as DOM with the `mdStyle` look. */
export function Markdown(p: MarkdownProps) {
  const h = useHost(p, "rmd");
  const s = (p.mdStyle ?? {}) as Style;
  const tree = useMemo(() => {
    try {
      return parser.parse(p.src ?? "") as unknown as Md;
    } catch {
      return { type: "root", children: [{ type: "paragraph", children: [{ type: "text", value: p.src }] }] } as Md;
    }
  }, [p.src]);
  const content = useMemo(() => blocks(tree.children, { s, p, codeIndex: { n: 0 }, tableIndex: { n: 0 } }), [tree, s, p.onLink, p.onCodeAction, p.onTableAction, p.linkStyles, p.images]);
  const st = h.props.style;
  Object.assign(st, fontCss((s.body ?? s.bodyFont) as Font));
  st.color = s.text;
  if (p.selectable) h.props.className += " sel";
  if (s.selection) st["--rsel"] = s.selection;
  st["--md-link-hover"] = s.linkHover;
  st["--md-marker"] = s.muted;
  return h.wrap(createElement("div", h.props, content));
}
