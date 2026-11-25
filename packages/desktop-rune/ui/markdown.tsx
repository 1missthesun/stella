// A small Markdown renderer for chat messages: headings, paragraphs, lists, quotes, fenced code,
// and inline **bold**, *italic* and `code`, drawn with Rune text runs.

import type { Tokens } from "./poc-theme";

type Run = { t: string; w?: number; c?: string; m?: boolean; bg?: string; i?: boolean };

function inline(src: string, t: Tokens, base?: Partial<Run>): Run[] {
  const runs: Run[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let last = 0;
  for (const m of src.matchAll(re)) {
    if (m.index! > last) runs.push({ t: src.slice(last, m.index), ...base });
    const tok = m[0];
    if (tok.startsWith("**")) runs.push({ t: tok.slice(2, -2), w: 600, c: t.textStrong, ...base });
    else if (tok.startsWith("`")) runs.push({ t: tok.slice(1, -1), m: true, bg: t.codeInline, ...base });
    else runs.push({ t: tok.slice(1, -1), i: true, ...base });
    last = m.index! + tok.length;
  }
  if (last < src.length) runs.push({ t: src.slice(last), ...base });
  return runs;
}

type Block =
  | { k: "p"; text: string }
  | { k: "h"; level: number; text: string }
  | { k: "li"; text: string; n?: number }
  | { k: "quote"; text: string }
  | { k: "code"; lang: string; text: string };

function blocks(src: string): Block[] {
  const out: Block[] = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const body: string[] = [];
      while (++i < lines.length && !lines[i].startsWith("```")) body.push(lines[i]);
      out.push({ k: "code", lang, text: body.join("\n") });
    } else if (/^#{1,3} /.test(line)) {
      const level = line.indexOf(" ");
      out.push({ k: "h", level, text: line.slice(level + 1) });
    } else if (/^[-*] /.test(line)) out.push({ k: "li", text: line.slice(2) });
    else if (/^\d+\. /.test(line)) out.push({ k: "li", text: line.replace(/^\d+\. /, ""), n: parseInt(line) });
    else if (line.startsWith("> ")) out.push({ k: "quote", text: line.slice(2) });
    else if (line.trim()) {
      const prev = out[out.length - 1];
      if (prev?.k === "p" && lines[i - 1]?.trim()) prev.text += " " + line;
      else out.push({ k: "p", text: line });
    }
  }
  return out;
}

type Group = Block | { k: "list"; items: Extract<Block, { k: "li" }>[] };
function group(bs: Block[]): Group[] {
  const out: Group[] = [];
  for (const b of bs) {
    const last = out[out.length - 1];
    if (b.k === "li" && last?.k === "list") last.items.push(b);
    else if (b.k === "li") out.push({ k: "list", items: [b] });
    else out.push(b);
  }
  return out;
}

export function Markdown({ id, src, t }: { id: string; src: string; t: Tokens }) {
  const bs = group(blocks(src));
  return (
    <col gap={10} w="full">
      {bs.map((b, i) => {
        const key = `${id}-b${i}`;
        switch (b.k) {
          case "h":
            return <text key={key} size={b.level === 1 ? 19 : b.level === 2 ? 16 : 14.5} weight={620} color={t.textStrong} lineHeight={b.level === 1 ? 26 : 22} mt={i ? 6 : 0} selectable>{b.text}</text>;
          case "list":
            return (
              <col key={key} w="full" gap={4}>
                {b.items.map((li, j) => (
                  <row key={j} gap={8} w="full" pl={4}>
                    <text size={14.5} lineHeight={22} color={t.textWeaker} w={16}>{li.n ? `${li.n}.` : "•"}</text>
                    <text spans={inline(li.text, t)} size={14.5} lineHeight={22} color={t.text} grow={1} shrink selectable />
                  </row>
                ))}
              </col>
            );
          case "quote":
            return <text key={key} spans={inline(b.text, t)} size={14.5} lineHeight={22} color={t.textWeak} pl={12} selectable />;
          case "code":
            return (
              <col key={key} w="full" fill={t.code} radius={10} border={t.borderWeak}>
                <row px={14} pt={9} pb={2} justify="between" align="center">
                  <text size={11.5} color={t.textWeaker} weight={500}>{b.lang || "text"}</text>
                  <box id={`${key}-copy`} px={8} py={3} radius={6} hover={t.hover} press={t.press} onPress={() => {}}>
                    <text size={11.5} color={t.textWeak}>Copy</text>
                  </box>
                </row>
                <text px={14} pb={12} pt={4} mono size={12.5} lineHeight={19} color={t.text} selectable>{b.text}</text>
              </col>
            );
          default:
            return <text key={key} spans={inline(b.text, t)} size={14.5} lineHeight={22} color={t.text} w="full" selectable />;
        }
      })}
    </col>
  );
}
