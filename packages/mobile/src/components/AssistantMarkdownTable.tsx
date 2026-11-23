import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ComponentType } from "react";
import {
  Platform,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
} from "react-native";
import { Text } from "./Text";
import type {
  MarkdownNode,
  NodeRendererProps,
} from "react-native-nitro-markdown";
import {
  estimateMarkdownTableColumnWidths,
  extractMarkdownTable,
  fitMarkdownTableColumnWidths,
  measuredMarkdownTableColumnWidths,
  splitMarkdownWords,
} from "../lib/markdown-table-layout";
import type { Colors } from "../theme/colors";
import { SelectableMarkdownText, nativeMarkdownSelectionAvailable } from "./SelectableMarkdownText";
import { fonts } from "../theme/fonts";
import { fadeHex } from "../theme/oklch";
import { SideScroller } from "./SideScroller";

type AssistantMarkdownTableProps = {
  node: MarkdownNode;
  Renderer: ComponentType<NodeRendererProps>;
  colors: Colors;
  selectable?: boolean;
  onLinkPress?: (url: string) => unknown;
  onAskStella?: (text: string) => void;
};

function TableCellContent({
  node,
  Renderer,
  textStyle,
  selectable,
  colors,
  onLinkPress,
  onAskStella,
}: {
  colors: Colors;
  node?: MarkdownNode;
  Renderer: ComponentType<NodeRendererProps>;
  textStyle: StyleProp<TextStyle>;
  selectable?: boolean;
  onLinkPress?: (url: string) => unknown;
  onAskStella?: (text: string) => void;
}) {
  if (!node) return null;
  if (selectable && nativeMarkdownSelectionAvailable) return <SelectableMarkdownText onAskStella={onAskStella} node={node} colors={colors} textStyle={textStyle} onLinkPress={onLinkPress} />;
  const children = node.children ?? [];

  return (
    <Text style={textStyle} selectable={selectable}>
      {children.length > 0
        ? children.map((child, index) => (
            <Renderer
              key={
                child.beg != null
                  ? `${child.type}-${child.beg}`
                  : `${child.type}-${index}`
              }
              node={child}
              depth={0}
              inListItem={false}
              parentIsText
            />
          ))
        : (node.content ?? "")}
    </Text>
  );
}

export function AssistantMarkdownTable({
  node,
  Renderer,
  colors,
  selectable,
  onLinkPress,
  onAskStella,
}: AssistantMarkdownTableProps) {
  const [viewportWidth, setViewportWidth] = useState(0);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const data = useMemo(() => extractMarkdownTable(node), [node]);
  const columns = useMemo(
    () =>
      data.headers.map((header, columnIndex) => {
        const cells = [
          { node: header, header: true },
          ...data.rows.map((row) => ({ node: row[columnIndex], header: false })),
        ];
        return {
          natural: cells,
          words: cells.map((cell) => ({
            ...cell,
            node: cell.node && splitMarkdownWords(cell.node),
          })),
        };
      }),
    [data],
  );
  const measureViews = useRef<(View | null)[]>([]);
  const [textWidths, setTextWidths] = useState<{ natural: number[]; words: number[] } | null>(null);
  const readTextWidths = useCallback(() => {
    const widths = measureViews.current
      .slice(0, columns.length * 2)
      .map((view) => view?.offsetWidth);
    if (widths.length < columns.length * 2 || widths.some((width) => width === undefined)) return;
    const natural = widths.filter((_, index) => index % 2 === 0) as number[];
    const words = widths.filter((_, index) => index % 2 === 1) as number[];
    setTextWidths((current) =>
      current &&
      current.natural.every((width, index) => Math.abs(width - natural[index]!) < 0.5) &&
      current.words.every((width, index) => Math.abs(width - words[index]!) < 0.5)
        ? current
        : { natural, words },
    );
  }, [columns.length]);
  useLayoutEffect(readTextWidths, [readTextWidths, columns]);

  const estimatedWidths = useMemo(
    () => estimateMarkdownTableColumnWidths(data),
    [data],
  );
  const contentWidths = useMemo(
    () =>
      textWidths?.natural.length === columns.length
        ? measuredMarkdownTableColumnWidths(textWidths.natural, textWidths.words)
        : estimatedWidths,
    [textWidths, columns.length, estimatedWidths],
  );
  const columnWidths = useMemo(
    () => fitMarkdownTableColumnWidths(contentWidths, viewportWidth),
    [contentWidths, viewportWidth],
  );
  const tableWidth = columnWidths.reduce((sum, width) => sum + width, 0);

  if (data.headers.length === 0) return null;

  const cellAlignment = (columnIndex: number): TextStyle["textAlign"] => {
    const alignment = data.alignments[columnIndex];
    if (alignment === "center" || alignment === "right") return alignment;
    return "left";
  };

  return (
    <View
      style={styles.container}
      onLayout={(event) => setViewportWidth(event.nativeEvent.layout.width)}
    >
      <View
        style={styles.measureLayer}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View style={styles.measureSpace}>
          {columns.flatMap((column, columnIndex) =>
            [column.natural, column.words].map((cells, kind) => (
              <View
                key={`measure-${columnIndex}-${kind}`}
                ref={(view) => {
                  measureViews.current[columnIndex * 2 + kind] = view;
                }}
                style={styles.measureColumn}
                onLayout={readTextWidths}
              >
                {cells.map((cell, cellIndex) => (
                  <View key={cellIndex} style={styles.measureCell}>
                    <TableCellContent
                      node={cell.node}
                      Renderer={Renderer}
                      selectable={selectable}
                      colors={colors}
                      textStyle={cell.header ? styles.headerText : styles.bodyText}
                    />
                  </View>
                ))}
              </View>
            )),
          )}
        </View>
      </View>
      <SideScroller showsIndicator style={styles.scroller}>
        <View style={{ width: tableWidth }}>
          <View style={styles.headerRow}>
            {data.headers.map((cell, columnIndex) => (
              <View
                key={`header-${columnIndex}`}
                style={[
                  styles.cell,
                  styles.headerCell,
                  { width: columnWidths[columnIndex] },
                  columnIndex === data.headers.length - 1 && styles.lastCell,
                ]}
              >
                <TableCellContent
                  node={cell}
                  Renderer={Renderer}
                  selectable={selectable}
                  colors={colors}
                  onLinkPress={onLinkPress}
                  onAskStella={onAskStella}
                  textStyle={[
                    styles.headerText,
                    { textAlign: cellAlignment(columnIndex) },
                  ]}
                />
              </View>
            ))}
          </View>

          {data.rows.map((row, rowIndex) => (
            <View
              key={`row-${rowIndex}`}
              style={[styles.bodyRow, rowIndex === 0 && styles.firstBodyRow]}
            >
              {data.headers.map((_, columnIndex) => (
                <View
                  key={`cell-${rowIndex}-${columnIndex}`}
                  style={[
                    styles.cell,
                    styles.bodyCell,
                    { width: columnWidths[columnIndex] },
                    columnIndex === data.headers.length - 1 && styles.lastCell,
                  ]}
                >
                  <TableCellContent
                    node={row[columnIndex]}
                    Renderer={Renderer}
                    selectable={selectable}
                    colors={colors}
                    onLinkPress={onLinkPress}
                    onAskStella={onAskStella}
                    textStyle={[
                      styles.bodyText,
                      { textAlign: cellAlignment(columnIndex) },
                    ]}
                  />
                </View>
              ))}
            </View>
          ))}
        </View>
      </SideScroller>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    container: {
      alignSelf: "stretch",
      marginVertical: 8,
      width: "100%",
    },
    scroller: {
      width: "100%",
    },
    measureLayer: {
      height: 0,
      left: 0,
      opacity: 0,
      overflow: "hidden",
      position: "absolute",
      top: 0,
      width: 0,
    },
    measureSpace: {
      alignItems: "flex-start",
      width: 4096,
    },
    measureColumn: {
      alignItems: "flex-start",
    },
    measureCell: {
      alignSelf: "flex-start",
    },
    headerRow: {
      borderBottomColor: fadeHex(colors.text, 0.32),
      borderBottomWidth: StyleSheet.hairlineWidth * 2,
      flexDirection: "row",
    },
    bodyRow: {
      borderTopColor: fadeHex(colors.text, 0.12),
      borderTopWidth: StyleSheet.hairlineWidth,
      flexDirection: "row",
    },
    firstBodyRow: {
      borderTopWidth: 0,
    },
    cell: {
      flexShrink: 0,
      paddingLeft: 0,
      paddingRight: 24,
      paddingVertical: 10,
    },
    headerCell: {
      justifyContent: "flex-end",
      paddingBottom: 8,
    },
    bodyCell: {
      justifyContent: "flex-start",
    },
    lastCell: {
      paddingRight: 0,
    },
    headerText: {
      color: colors.textStrong,
      fontFamily: fonts.sans.medium,
      fontSize: 14,
      lineHeight: 20,
      ...(Platform.OS === "android" && { includeFontPadding: false }),
    },
    bodyText: {
      color: colors.text,
      fontFamily: fonts.sans.regular,
      fontSize: 14,
      lineHeight: 20,
      ...(Platform.OS === "android" && { includeFontPadding: false }),
    },
  });
