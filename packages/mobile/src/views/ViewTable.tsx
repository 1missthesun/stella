import { useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View, type ViewStyle } from "react-native";
import type { ViewChild, ViewNode } from "@stella/views/protocol";
import { estimateTextWidth, formatValue } from "@stella/views/format";
import { SideScroller } from "../components/SideScroller";
import { Text } from "../components/Text";
import type { Colors } from "../theme/colors";
import { fonts } from "../theme/fonts";
import { ViewIcon } from "./ViewIcon";
import { mix, sizeOf, type Paint } from "./view-style";

type Column = { key: string; title: string; align?: "start" | "center" | "end"; width?: number | string; format?: string; currency?: string; sortable?: boolean };


const cellText = (row: Record<string, unknown>, column: Column) => formatValue(row[column.key], column.format, { currency: column.currency });

export function ViewTable({ node, colors, paint, onRowPress, renderSlot }: { node: ViewNode; colors: Colors; paint: Paint; onRowPress?: (v: unknown) => void; renderSlot: (nodes: ViewChild[]) => ReactNode }) {
  const p = node.p ?? {};
  const columns = useMemo(() => (Array.isArray(p.columns) ? p.columns : []) as Column[], [p.columns]);
  const rows = useMemo(() => (Array.isArray(p.rows) ? p.rows : []) as Record<string, unknown>[], [p.rows]);
  const cells = (Array.isArray(p.cells) ? p.cells : null) as (ViewChild[] | null)[][] | null;
  const initial = p.sort && typeof p.sort === "object" ? (p.sort as { key: string; direction: "asc" | "desc" }) : null;
  const [sort, setSort] = useState(initial);
  const [room, setRoom] = useState(0);

  const order = useMemo(() => {
    const index = rows.map((_, i) => i);
    if (!sort) return index;
    const dir = sort.direction === "desc" ? -1 : 1;
    return index.sort((a, b) => {
      const x = rows[a]?.[sort.key];
      const y = rows[b]?.[sort.key];
      if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
      return String(x ?? "").localeCompare(String(y ?? ""), undefined, { numeric: true }) * dir;
    });
  }, [rows, sort]);

  // Columns fit their longest value; fr columns, or else the first text column, share what is left of the width.
  const widths = useMemo(() => {
    const fit = columns.map((column) => {
      if (typeof column.width === "number") return column.width;
      let widest = estimateTextWidth(column.title, 13) + (column.sortable ? 18 : 0);
      for (const row of rows.slice(0, 200)) widest = Math.max(widest, estimateTextWidth(cellText(row, column), 15));
      return Math.min(320, Math.max(48, Math.ceil(widest) + 28));
    });
    const fr = columns.map((column) => (typeof column.width === "string" && column.width.endsWith("fr") ? Number.parseFloat(column.width) || 1 : 0));
    const anyFr = fr.some((share) => share > 0);
    const flexible = anyFr ? -1 : Math.max(0, columns.findIndex((column) => column.width === undefined && column.align !== "end" && rows.every((row) => typeof row[column.key] !== "number")));
    const fixed = fit.reduce((sum, w, i) => sum + (fr[i]! > 0 ? 48 : w), 0);
    const spare = Math.max(0, room - fixed);
    const shares = anyFr ? fr.reduce((a, b) => a + b, 0) : 1;
    return fit.map((w, i) => (anyFr ? (fr[i]! > 0 ? 48 + (spare * fr[i]!) / shares : w) : i === flexible ? w + spare : w));
  }, [columns, rows, room]);

  const stripe = mix(colors.text, 3, "transparent");
  const justify = (a?: string): ViewStyle["justifyContent"] => (a === "end" ? "flex-end" : a === "center" ? "center" : "flex-start");

  const header = (
    <View style={{ flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, backgroundColor: colors.background }}>
      {columns.map((column, c) => {
        const active = sort?.key === column.key;
        const press = column.sortable ? () => setSort(active ? (sort!.direction === "asc" ? { key: column.key, direction: "desc" } : null) : { key: column.key, direction: "asc" }) : undefined;
        return (
          <Pressable key={column.key} disabled={!press} onPress={press} style={{ width: widths[c], paddingHorizontal: 12, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 4, justifyContent: justify(column.align) }}>
            <Text style={{ fontFamily: fonts.sans.semiBold, fontSize: 13, color: colors.textMuted }} numberOfLines={1}>
              {column.title}
            </Text>
            {active ? (
              <View style={{ transform: [{ rotate: sort!.direction === "asc" ? "180deg" : "0deg" }] }}>
                <ViewIcon name="chevron-down" size={12} color={colors.textMuted} />
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );

  const body = order.map((r, position) => {
    const row = rows[r] ?? {};
    return (
      <Pressable
        key={String(row.id ?? r)}
        disabled={!onRowPress}
        onPress={() => onRowPress?.(r)}
        style={({ pressed }) => [
          { flexDirection: "row" },
          p.striped && position % 2 === 1 ? { backgroundColor: stripe } : null,
          position < order.length - 1 ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: mix(colors.border, 60, "transparent") } : null,
          pressed ? { backgroundColor: mix(colors.text, 7, "transparent") } : null,
        ]}
      >
        {columns.map((column, c) => {
          const custom = cells?.[r]?.[c];
          return (
            <View key={column.key} style={{ width: widths[c], paddingHorizontal: 12, paddingVertical: 9, flexDirection: "row", alignItems: "center", justifyContent: justify(column.align) }}>
              {custom ? (
                renderSlot(custom)
              ) : (
                <Text style={{ fontFamily: fonts.sans.regular, fontSize: 15, lineHeight: 21, color: paint("text"), ...(column.align === "end" || typeof row[column.key] === "number" ? { fontVariant: ["tabular-nums"] as const } : {}) }} numberOfLines={2}>
                  {cellText(row, column)}
                </Text>
              )}
            </View>
          );
        })}
      </Pressable>
    );
  });

  const maxHeight = sizeOf(p.maxHeight);
  return (
    <View style={{ alignSelf: "stretch", borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: "hidden" }} onLayout={(e) => setRoom(Math.floor(e.nativeEvent.layout.width))}>
      <SideScroller>
        <View>
          {header}
          {maxHeight !== undefined ? (
            <ScrollView style={{ maxHeight }} nestedScrollEnabled>
              {body}
            </ScrollView>
          ) : (
            body
          )}
        </View>
      </SideScroller>
    </View>
  );
}
