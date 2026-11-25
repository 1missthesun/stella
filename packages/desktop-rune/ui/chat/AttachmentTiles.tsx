import { Fragment, useId, useState, type ReactNode } from "react";
import { useT } from "@/shared/i18n";
import { derive, fontSize, mixOklch, useTokens, type Tokens } from "../theme";
import { ChipShell } from "./ComposerContextChips";
import { ChipPreview, useHoverPreview } from "./HoverPreview";
import { previewCard } from "./surfaces";

export const TILE_SIZE = 64;
export const ATTACHMENT_TILE_SIZE = TILE_SIZE;
const TILE_GAP = 6;

export type AttachmentTileItem = { key: string; node: ReactNode };

/** `.attachment-tile`: the 64pt muted tile every attachment sits in, brighter on hover. */
export const tileLook = (t: Tokens) =>
  derive(t, "attachment-tile", (k) => ({
    border: k.c.border,
    fill: k.c.muted,
    hoverBorder: k.c.borderStrong,
    hoverFill: mixOklch(k.c.foreground, 6, k.c.muted),
  }));

const fitCount = (widths: readonly number[], available: number): number => {
  let used = 0;
  for (let index = 0; index < widths.length; index += 1) {
    const next = used + (index > 0 ? TILE_GAP : 0) + widths[index]!;
    const remaining = widths.length - index - 1;
    const reserve = remaining > 0 ? TILE_GAP + TILE_SIZE : 0;
    if (next + reserve > available) return index;
    used = next;
  }
  return widths.length;
};

function OverflowTile({ items }: { items: AttachmentTileItem[] }) {
  const t = useT();
  const tokens = useTokens();
  const look = tileLook(tokens);
  const id = useId();
  const hover = useHoverPreview();
  const [pinned, setPinned] = useState(false);
  const open = pinned || hover.open;
  return (
    <>
      <box
        id={`tiles-more:${id}`}
        role="button"
        focusable
        label={t("app.chat.messageRow.showMoreChips", { count: items.length })}
        expanded={open}
        w={TILE_SIZE}
        h={TILE_SIZE}
        center
        radius={12}
        border={open ? look.hoverBorder : look.border}
        fill={open ? look.hoverFill : look.fill}
        hoverBorder={look.hoverBorder}
        hoverFill={look.hoverFill}
        cursor="pointer"
        onHover={hover.onHover}
        onPress={() => setPinned((value) => !value)}
      >
        <text size={fontSize.base} weight={600} lineHeight={fontSize.base * 1.45} features="'tnum' 1" color={tokens.c.textStrong}>
          {`+${items.length}`}
        </text>
      </box>
      <ChipPreview
        anchor={`tiles-more:${id}`}
        open={open}
        interactive
        onHover={hover.onHover}
        pad={8 + 1}
        radius={14}
        modal={pinned ? { clickOutside: true } : undefined}
        onDismiss={() => setPinned(false)}
        {...previewCard(tokens)}
      >
        <row wrap gap={TILE_GAP} maxW={TILE_SIZE * 5 + TILE_GAP * 4} pt={4}>
          {items.map((item) => (
            <Fragment key={item.key}>{item.node}</Fragment>
          ))}
        </row>
      </ChipPreview>
    </>
  );
}

type AttachmentTileRowProps = { items: AttachmentTileItem[]; align: "start" | "end"; maxW?: `${number}%` };

/** desktop-ui's `AttachmentTileRow`: tiles in one line; what doesn't fit folds into a +N tile with a hover card. */
export function AttachmentTileRow({ items, align, maxW }: AttachmentTileRowProps) {
  const [rowW, setRowW] = useState(0);
  const [widths, setWidths] = useState<Record<string, number>>({});
  if (items.length === 0) return null;
  const measured = items.map((item) => widths[item.key] ?? TILE_SIZE);
  const shownCount = rowW > 0 ? fitCount(measured, rowW) : items.length;
  const hidden = items.slice(shownCount);
  return (
    <row w="full" maxW={maxW} selfAlign={align === "end" ? "end" : "start"} justify={align} align="end" gap={TILE_GAP} pt={4} minW={0} onLayout={(r) => setRowW(Math.round(r.w))}>
      {items.map((item, index) => {
        const offFlow = index >= shownCount;
        return (
          <box
            key={item.key}
            shrink={false}
            absolute={offFlow ? { left: 0, top: 0 } : undefined}
            hidden={offFlow}
            inert={offFlow}
            onLayout={(r) => setWidths((prev) => (prev[item.key] === Math.round(r.w) ? prev : { ...prev, [item.key]: Math.round(r.w) }))}
          >
            {item.node}
          </box>
        );
      })}
      {hidden.length > 0 ? <OverflowTile items={hidden} /> : null}
    </row>
  );
}

const firstLines = (text: string): string =>
  text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 3)
    .join("\n")
    .slice(0, 160);

export function PastedTextTile({ text, preview, label, removeLabel, onRemove }: { text: string; preview: string; label: string; removeLabel?: string; onRemove?: () => void }) {
  const tokens = useTokens();
  const look = tileLook(tokens);
  const id = useId();
  const hover = useHoverPreview();
  return (
    <ChipShell removeLabel={removeLabel} onRemove={onRemove}>
      <col
        id={`pasted:${id}`}
        role="button"
        focusable
        label={label}
        title={label}
        w={TILE_SIZE}
        h={TILE_SIZE}
        pt={6 + 1}
        px={7 + 1}
        radius={12}
        clip={12}
        border={look.border}
        fill={look.fill}
        hoverBorder={look.hoverBorder}
        hoverFill={look.hoverFill}
        onHover={hover.onHover}
        onFocus={hover.onFocus}
      >
        <text size={9} lineHeight={11.7} color={tokens.c.textWeak} maxLines={4} truncate="end">
          {firstLines(text) || label}
        </text>
      </col>
      {preview ? (
        <ChipPreview anchor={`pasted:${id}`} open={hover.open} interactive onHover={hover.onHover} w={460} maxW="100%" maxH={220} py={12 + 1} px={14 + 1} radius={12} {...previewCard(tokens)}>
          <col scrollY minH={0}>
            <text size={fontSize.sm} lineHeight={18} tracking={fontSize.sm * 0.01} color={tokens.c.textStrong} selectable>
              {preview}
            </text>
          </col>
        </ChipPreview>
      ) : null}
    </ChipShell>
  );
}

