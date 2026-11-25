import { derive, font, fontSize, mix, radius, type Tokens, useTokens } from "../theme";

type Font = { size: number; weight: number; lineHeight: number; tracking?: number; family?: string };

/** Chat text metrics (`--chat-text-*` in desktop-ui's full-shell and compact conversation CSS). */
export type ChatText = { size: number; weight: number; strongWeight: number; lineHeight: number; color?: string };

export const CHAT_TEXT: ChatText = { size: fontSize.lg, weight: 400, strongWeight: 500, lineHeight: 1.5 };
export const CHAT_TEXT_COMPACT: ChatText = { ...CHAT_TEXT, size: fontSize.base };

const GITHUB = {
  light: { keyword: "#d73a49", string: "#032f62", number: "#005cc5", comment: "#6a737d", type: "#6f42c1", function: "#6f42c1", property: "#005cc5", inserted: "#22863a", deleted: "#b31d28" },
  dark: { keyword: "#f97583", string: "#9ecbff", number: "#79b8ff", comment: "#6a737d", type: "#b392f0", function: "#b392f0", property: "#79b8ff", inserted: "#85e89d", deleted: "#fdaeb7" },
};

/**
 * desktop-ui's `.markdown` look (app/chat/markdown.css with the `.event-item.assistant` overrides in
 * full-shell.chat.css) as the engine Markdown's `mdStyle`: rune-kit `MarkdownStyle` builder → arguments.
 */
export function markdownStyle(t: Tokens, chat: ChatText = CHAT_TEXT) {
  const c = t.c;
  const text = chat.color ?? c.chatAssistantBubbleText;
  const lh = (size: number, k: number) => Math.round(size * k * 100) / 100;
  const body: Font = { size: chat.size, weight: chat.weight, lineHeight: lh(chat.size, chat.lineHeight), tracking: 0 };
  const heading = (size: number): Font => ({ size, weight: 600, lineHeight: lh(size, 1.3) });
  const code: Font = { size: fontSize.sm, weight: 400, lineHeight: lh(fontSize.sm, 1.5), family: font.mono };
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
    codeBlockFill: c.surfaceInset,
    codeBlockBorder: c.borderWeak,
    codeBlockPadding: [12, 10],
    codeBlockRadius: radius.md,
    codeBlockFont: code,
    codeBlockText: text,
    quoteRule: c.borderWeak,
    quote: [c.borderWeak, 2, 12, c.textWeak],
    rule: c.borderWeak,
    body,
    headings: [heading(26), heading(21), heading(18), heading(16)],
    strongWeight: chat.strongWeight,
    list: [24, 4],
    listNestedIndent: [16, 16],
    listMarkersOutside: true,
    paragraphMargin: [0, 12],
    headingMargins: [[16, 6.4], [16, 6.4], [16, 6.4], [16, 6.4]],
    codeMargin: [0, 12],
    listMargin: [4, 12],
    quoteMargin: [16, 16],
    ruleMargin: [24, 24],
    imageMargin: [16, 16],
    table: [rule, "#00000000"],
    tableOutline: null,
    tableRules: rule,
    tableHeaderRule: mix(text, 32, "transparent"),
    tableHeaderText: c.textStrong,
    tableHeaderWeight: chat.strongWeight,
    tableCellPadding: [24, 10],
    tableHeaderPad: [24, 8],
    tableFlushLeft: true,
    tableFont: body,
    selection: mix(c.primary, 30, "transparent"),
    syntax: t.dark ? GITHUB.dark : GITHUB.light,
  };
}

export type MarkdownProps = {
  id: string;
  text: string;
  streaming?: boolean;
  chat?: ChatText;
  onLink?: (url: string) => void;
};

const openExternal = (url: string) => (globalThis as { electronAPI?: { system?: { openExternal?: (u: string) => void } } }).electronAPI?.system?.openExternal?.(url);

/**
 * Chat Markdown (desktop-ui's Streamdown `Markdown`) drawn by the engine: streaming-safe parse,
 * syntax-highlighted code blocks with copy, tables, quotes, images, selectable across the message.
 */
export function Markdown({ id, text, streaming = false, chat = CHAT_TEXT, onLink = openExternal }: MarkdownProps) {
  const t = useTokens();
  const style = derive(t, `markdown:${chat.size}:${chat.color ?? ""}`, (t) => markdownStyle(t, chat));
  return <markdown id={id} src={text} streaming={streaming} mdStyle={style} onLink={onLink} w="full" />;
}
