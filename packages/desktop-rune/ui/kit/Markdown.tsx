import { useMemo } from "react";
import { derive, font, fontSize, mix, radiusUnset, type Tokens, useTokens } from "../theme";
import { engine } from "./engine";
import { Icons } from "./icons";
import { TABLE_ACTIONS, useTableActions } from "./table-actions";

type Font = { size: number; weight: number; lineHeight: number; tracking?: number; family?: string };

/** Chat text metrics (`--chat-text-*` in desktop-ui's full-shell and compact conversation CSS). */
export type ChatText = { size: number; weight: number; strongWeight: number; lineHeight: number; color?: string };

const LINE_NUMBER_SIZE = 13;

export const CHAT_TEXT: ChatText = { size: fontSize.lg, weight: 400, strongWeight: 500, lineHeight: 1.5 };
export const CHAT_TEXT_COMPACT: ChatText = { ...CHAT_TEXT, size: fontSize.base };

const plainSyntax = (color: string) => Object.fromEntries(Object.keys(GITHUB.light).concat("punctuation", "operator").map((k) => [k, color]));

const GITHUB = {
  light: { keyword: "#d73a49", string: "#032f62", number: "#005cc5", comment: "#6a737d", type: "#6f42c1", function: "#6f42c1", property: "#005cc5", inserted: "#22863a", deleted: "#b31d28" },
  dark: { keyword: "#f97583", string: "#9ecbff", number: "#79b8ff", comment: "#6a737d", type: "#b392f0", function: "#b392f0", property: "#79b8ff", inserted: "#85e89d", deleted: "#fdaeb7" },
};

/**
 * desktop-ui's `.markdown` look (app/chat/markdown.css with the `.event-item.assistant` overrides in
 * full-shell.chat.css) as the engine Markdown's `mdStyle`: rune-kit `MarkdownStyle` builder → arguments.
 */
export function markdownStyle(t: Tokens, chat: ChatText = CHAT_TEXT, highlight = false) {
  const c = t.c;
  const text = chat.color ?? c.chatAssistantBubbleText;
  const lh = (size: number, k: number) => Math.round(size * k * 100) / 100;
  const body: Font = { size: chat.size, weight: chat.weight, lineHeight: lh(chat.size, chat.lineHeight), tracking: 0 };
  const heading = (size: number): Font => ({ size, weight: 600, lineHeight: lh(size, 1.3) });
  // Streamdown's 13px line-number box, on the body's text-sm 20/14 line height, sets each code line's height.
  const code: Font = { size: fontSize.sm, weight: 400, lineHeight: lh(LINE_NUMBER_SIZE, 20 / 14), family: font.mono };
  const rule = mix(text, 12, "transparent");
  return {
    dark: t.dark,
    text,
    muted: c.textWeak,
    link: c.textInteractive,
    linkUnderline: "#00000000",
    linkHover: c.textInteractive,
    inlineCodeBg: c.surfaceInset,
    inlineCodeText: c.textStrong,
    inlineCodeFont: [fontSize.sm / chat.size, 500],
    inlineCodePad: 4,
    codeBlockFill: "#00000000",
    codeBlockBorder: "#00000000",
    codeBlockPadding: [0, 0],
    codeBlockRadius: radiusUnset,
    codeBlockFont: code,
    codeBlockText: text,
    codeLineNumbers: { font: { size: LINE_NUMBER_SIZE, weight: 400, family: font.mono }, color: mix(c.mutedForeground, 50, "transparent"), width: 24, gap: 16 },
    scrollWide: true,
    wideFade: 0,
    quoteRule: c.borderWeak,
    quote: [c.borderWeak, 2, 12, c.textWeak],
    rule: c.borderWeak,
    body,
    headings: [heading(26), heading(21), heading(18), heading(16)],
    strongWeight: chat.strongWeight,
    list: [24, 4 + 2 * 4],
    listNestedIndent: [16, 16],
    listMarkersOutside: true,
    paragraphMargin: [0, 12],
    headingMargins: [[16, 6.4], [16, 6.4], [16, 6.4], [16, 6.4]],
    codeMargin: [0, 12],
    listMargin: [4, 12],
    listPadding: [4, 4],
    quoteMargin: [16, 16],
    ruleMargin: [24, 24],
    imageMargin: [16, 16],
    table: [rule, "#00000000"],
    tableOutline: null,
    tableRules: rule,
    tableHeaderRule: mix(text, 32, "transparent"),
    tableHeaderRuleWidth: 1,
    tableHeaderText: c.textStrong,
    tableHeaderWeight: chat.strongWeight,
    tableCellPadding: [24, 10],
    tableHeaderPadEdges: [24, 10, 8],
    tableFlushLeft: true,
    tableEndRule: false,
    tableCellsFlushLeft: true,
    tableFlushRight: true,
    tableFont: { ...body, lineHeight: lh(chat.size, 20 / 14) },
    tableFullWidth: true,
    selection: mix(c.primary, 30, "transparent"),
    syntax: highlight ? (t.dark ? GITHUB.dark : GITHUB.light) : plainSyntax(text),
    codeFrame: {
      label: c.textWeak,
      labelSize: fontSize.sm,
      labelHeight: 16,
      labelFamily: font.mono,
      labelInset: 3.5,
      labelGap: 4.5,
      actions: CODE_ACTIONS,
      actionColor: c.textWeak,
      actionHover: c.textStrong,
      actionsOnHover: true,
      actionsAt: [6, 6],
      // Electron's 1px border plus 10/12 padding, and the code body's own transparent 1px border, less the code frame's 0.5 layout border.
      inside: { fill: c.surfaceInset, border: c.borderWeak, radius: 8, pad: [13.5, 11, 11.5], padRight: 13.5 },
    },
    tableFrame: { actions: TABLE_ACTIONS, actionColor: c.mutedForeground, actionHover: c.foreground, actionsOnHover: true, actionsAt: [6, 0], actionsFill: c.background, gap: 4, buttonPad: 4 },
  };
}

const CODE_ACTIONS = [
  { id: "copy", svg: Icons.stella.Copy.body, view: Icons.stella.Copy.view },
  { id: "download", svg: Icons.stella.Download.body, view: Icons.stella.Download.view },
];

const EXTENSIONS: Record<string, string> = { typescript: "ts", javascript: "js", python: "py", bash: "sh", shell: "sh", zsh: "sh", rust: "rs", markdown: "md", text: "txt", plaintext: "txt", yaml: "yml", ruby: "rb", golang: "go", kotlin: "kt", csharp: "cs" };

export async function codeAction(a: { action: string; language: string | null; source: string }) {
  if (a.action === "copy") await engine.writeText(a.source);
  else if (a.action === "download") {
    const lang = a.language?.toLowerCase() ?? "txt";
    await engine.saveText(a.source, `code.${EXTENSIONS[lang] ?? lang}`);
  }
}

export type MarkdownProps = {
  id: string;
  text: string;
  streaming?: boolean;
  chat?: ChatText;
  /** Colour code by token kind. Off matches today's chat, whose Streamdown has no code plugin. */
  highlight?: boolean;
  onLink?: (url: string) => void;
};

const openExternal = (url: string) => (globalThis as { electronAPI?: { system?: { openExternal?: (u: string) => void } } }).electronAPI?.system?.openExternal?.(url);

/**
 * Chat Markdown (desktop-ui's Streamdown `Markdown`) drawn by the engine: streaming-safe parse,
 * syntax-highlighted code blocks with copy and download on hover, tables, quotes, images, selectable across the message.
 */
export function Markdown({ id, text, streaming = false, chat = CHAT_TEXT, highlight = false, onLink = openExternal }: MarkdownProps) {
  const t = useTokens();
  const style = derive(t, `markdown:${chat.size}:${chat.color ?? ""}:${highlight}`, (t) => markdownStyle(t, chat, highlight));
  const tables = useTableActions(id);
  const withActions = useMemo(() => tables.withFrame(style), [style, tables.withFrame]);
  return (
    <>
      <markdown id={id} src={text} streaming={streaming} selectable mdStyle={withActions} onLink={onLink} onCodeAction={codeAction} onTableAction={tables.onTableAction} w="full" />
      {tables.overlay}
    </>
  );
}
