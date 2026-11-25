import { memo } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { fonts } from "../../theme/fonts";
import { Text } from "../Text";

const DESIGN_WIDTH = 300;
const MAX_LINES = 26;
const MAX_ROWS = 14;
const MAX_COLUMNS = 4;

const INK = "#1b1b1d";
const SOFT_INK = "#55565b";
const RULE = "#e4e5e9";

type Block = {
  kind: "h1" | "h2" | "bullet" | "quote" | "rule" | "gap" | "body";
  text: string;
};

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
      if (blocks.length > 0 && blocks.at(-1)?.kind !== "gap") {
        blocks.push({ kind: "gap", text: "" });
      }
    } else if (heading) {
      blocks.push({
        kind: heading[1]!.length === 1 ? "h1" : "h2",
        text: plain(heading[2]!),
      });
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
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
};

const isFigure = (cell: string): boolean => /^[-+$€£¥]?[\d.,]+%?$/.test(cell.trim());

type Cell = { text: string; figure: boolean };
type Parsed = { blocks: Block[]; rows: Cell[][] };

const MAX_PARSED = 240;
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

const stylesByScale = new Map<number, ReturnType<typeof makeStyles>>();
const scaledStyles = (scale: number) => {
  let styles = stylesByScale.get(scale);
  if (!styles) {
    styles = makeStyles(scale);
    stylesByScale.set(scale, styles);
  }
  return styles;
};

export const TextThumbnail = memo(function TextThumbnail({
  text,
  extension,
  width,
}: {
  text: string;
  extension: string;
  width: number;
}) {
  const styles = scaledStyles(Math.round((width / DESIGN_WIDTH) * 1000) / 1000);
  const prose =
    extension === "md" || extension === "markdown" || extension === "txt";
  const table = extension === "csv" || extension === "tsv";
  const { blocks, rows } = parse(text, extension, prose, table);

  if (table) {
    return (
      <View style={styles.page}>
        {rows.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.tableRow}>
            {row.map((cell, cellIndex) => (
              <Text
                key={cellIndex}
                allowFontScaling={false}
                numberOfLines={1}
                style={[
                  styles.cell,
                  rowIndex === 0 && styles.headCell,
                  cell.figure && styles.figure,
                ]}
              >
                {cell.text}
              </Text>
            ))}
          </View>
        ))}
      </View>
    );
  }

  if (!prose) {
    return (
      <View style={styles.page}>
        <Text
          allowFontScaling={false}
          style={styles.code}
          numberOfLines={MAX_LINES}
          ellipsizeMode="clip"
        >
          {text}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.page}>
      {blocks.map((block, index) => {
        if (block.kind === "gap") return <View key={index} style={styles.gap} />;
        if (block.kind === "rule") return <View key={index} style={styles.rule} />;
        return (
          <Text
            key={index}
            allowFontScaling={false}
            style={styles[block.kind]}
            numberOfLines={block.kind === "body" ? 5 : 3}
          >
            {block.kind === "bullet" ? `•  ${block.text}` : block.text}
          </Text>
        );
      })}
    </View>
  );
});

const makeStyles = (scale: number) =>
  StyleSheet.create({
    page: {
      backgroundColor: "#ffffff",
      flex: 1,
      overflow: "hidden",
      paddingHorizontal: 24 * scale,
      paddingTop: 26 * scale,
    },
    h1: {
      color: INK,
      fontFamily: fonts.sans.bold,
      fontSize: 28 * scale,
      letterSpacing: -0.8 * scale,
      lineHeight: 34 * scale,
      marginBottom: 4 * scale,
    },
    h2: {
      color: INK,
      fontFamily: fonts.sans.bold,
      fontSize: 19 * scale,
      lineHeight: 26 * scale,
    },
    body: {
      color: SOFT_INK,
      fontFamily: fonts.sans.medium,
      fontSize: 15 * scale,
      lineHeight: 22 * scale,
    },
    bullet: {
      color: SOFT_INK,
      fontFamily: fonts.sans.medium,
      fontSize: 15 * scale,
      lineHeight: 23 * scale,
    },
    quote: {
      color: SOFT_INK,
      fontFamily: fonts.sans.medium,
      fontSize: 15 * scale,
      lineHeight: 22 * scale,
      opacity: 0.75,
    },
    gap: { height: 11 * scale },
    rule: {
      backgroundColor: RULE,
      height: StyleSheet.hairlineWidth,
      marginVertical: 8 * scale,
    },
    tableRow: {
      borderBottomColor: RULE,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: "row",
      gap: 8 * scale,
      paddingVertical: 8 * scale,
    },
    cell: {
      color: SOFT_INK,
      flex: 1,
      fontFamily: fonts.sans.medium,
      fontSize: 13.5 * scale,
      lineHeight: 18 * scale,
    },
    headCell: { color: INK, fontFamily: fonts.sans.bold },
    figure: { fontVariant: ["tabular-nums"], textAlign: "right" },
    code: {
      color: "#2d3340",
      fontFamily: Platform.OS === "ios" ? "Menlo" : fonts.mono.regular,
      fontSize: 12.5 * scale,
      lineHeight: 19 * scale,
    },
  });
