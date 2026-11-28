import { memo } from "react";
import { rt } from "../../rn";

// packages/mobile's files/TextThumbnail: a text file's opening drawn as a page, laid out for a
// 300 pt page and scaled to the sheet. Markdown and plain text read as prose, CSV and TSV as a
// ruled table, anything else as code.

const DESIGN_WIDTH = 300;
const MAX_LINES = 26;
const MAX_ROWS = 14;
const MAX_COLUMNS = 4;
const MAX_PARSED = 240;

const INK = "#1b1b1d";
const SOFT_INK = "#55565b";
const RULE = "#e4e5e9";
const CODE_INK = "#2d3340";

type Block = { kind: "h1" | "h2" | "bullet" | "quote" | "rule" | "gap" | "body"; text: string };
type Cell = { text: string; figure: boolean };
type Parsed = { blocks: Block[]; rows: Cell[][] };

const plain = (text: string): string =>
  text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]{1,3}/g, "")
    .trim();

const markdownBlocks = (text: string): Block[] => {
  const blocks: Block[] = [];
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, "");
  for (const raw of body.split(/\r?\n/)) {
    if (blocks.length >= MAX_LINES) break;
    const line = raw.trim();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (!line) {
      if (blocks.length > 0 && blocks.at(-1)?.kind !== "gap") blocks.push({ kind: "gap", text: "" });
    } else if (heading) {
      blocks.push({ kind: heading[1]!.length === 1 ? "h1" : "h2", text: plain(heading[2]!) });
    } else if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(line)) {
      blocks.push({ kind: "rule", text: "" });
    } else if (bullet) {
      blocks.push({ kind: "bullet", text: plain(bullet[1]!) });
    } else if (line.startsWith(">")) {
      blocks.push({ kind: "quote", text: plain(line.replace(/^>+\s*/, "")) });
    } else {
      blocks.push({ kind: "body", text: plain(line) });
    }
  }
  return blocks;
};

const splitDelimited = (line: string, delimiter: string): string[] => {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      cells.push(cell);
      cell = "";
    } else cell += char;
  }
  cells.push(cell);
  return cells;
};

const isFigure = (cell: string): boolean => /^[-+$€£¥]?[\d.,]+%?$/.test(cell.trim());

const parsedByText = new Map<string, Parsed>();

const parse = (text: string, extension: string, prose: boolean, table: boolean): Parsed => {
  const key = `${extension}\u0000${text}`;
  const known = parsedByText.get(key);
  if (known) return known;
  const parsed: Parsed = {
    blocks: prose ? markdownBlocks(text) : [],
    rows: table
      ? text
          .trim()
          .split(/\r?\n/)
          .slice(0, MAX_ROWS)
          .map((line) =>
            splitDelimited(line, extension === "tsv" ? "\t" : ",")
              .slice(0, MAX_COLUMNS)
              .map((cell) => ({ text: cell, figure: isFigure(cell) })),
          )
      : [],
  };
  parsedByText.set(key, parsed);
  if (parsedByText.size > MAX_PARSED) {
    const oldest = parsedByText.keys().next().value;
    if (oldest !== undefined) parsedByText.delete(oldest);
  }
  return parsed;
};

const looksByScale = new Map<number, ReturnType<typeof makeLooks>>();
const makeLooks = (s: number) => ({
  h1: rt(28 * s, 700, -0.8 * s, 34 * s),
  h2: rt(19 * s, 700, 0, 26 * s),
  body: rt(15 * s, 500, 0, 22 * s),
  bullet: rt(15 * s, 500, 0, 23 * s),
  cell: rt(13.5 * s, 500, 0, 18 * s),
  head: rt(13.5 * s, 700, 0, 18 * s),
  code: { ...rt(12.5 * s, 400, 0, 19 * s), family: "system-mono" },
});
const looksFor = (scale: number) => {
  let looks = looksByScale.get(scale);
  if (!looks) looksByScale.set(scale, (looks = makeLooks(scale)));
  return looks;
};

export const TextThumbnail = memo(function TextThumbnail({ text, extension, width }: { text: string; extension: string; width: number }) {
  const s = Math.round((width / DESIGN_WIDTH) * 1000) / 1000;
  const l = looksFor(s);
  const prose = extension === "md" || extension === "markdown" || extension === "txt";
  const table = extension === "csv" || extension === "tsv";
  const { blocks, rows } = parse(text, extension, prose, table);
  const page = { w: "full", h: "full", fill: "#ffffff", px: 24 * s, pt: 26 * s, inert: true } as const;

  if (table) {
    return (
      <col {...page}>
        {rows.map((cells, r) => (
          <row key={r} gap={8 * s} py={8 * s} borderSides={[0, 0, 0.5, 0]} border={RULE}>
            {cells.map((cell, i) => (
              <text key={i} {...(r === 0 ? l.head : l.cell)} color={r === 0 ? INK : SOFT_INK} grow={1} basis={0} minW={0} maxLines={1} textAlign={cell.figure ? "end" : undefined} features={cell.figure ? "'tnum' 1" : undefined}>
                {cell.text}
              </text>
            ))}
          </row>
        ))}
      </col>
    );
  }

  if (!prose) {
    return (
      <col {...page}>
        <text {...l.code} color={CODE_INK} maxLines={MAX_LINES}>
          {text}
        </text>
      </col>
    );
  }

  return (
    <col {...page}>
      {blocks.map((block, i) => {
        if (block.kind === "gap") return <box key={i} h={11 * s} />;
        if (block.kind === "rule") return <box key={i} h={0.5} my={8 * s} fill={RULE} />;
        const heading = block.kind === "h1" || block.kind === "h2";
        return (
          <text key={i} {...(block.kind === "quote" ? l.body : l[block.kind])} color={heading ? INK : SOFT_INK} opacity={block.kind === "quote" ? 0.75 : undefined} mb={block.kind === "h1" ? 4 * s : undefined} maxLines={block.kind === "body" ? 5 : 3}>
            {block.kind === "bullet" ? `•  ${block.text}` : block.text}
          </text>
        );
      })}
    </col>
  );
});
