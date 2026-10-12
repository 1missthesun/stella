import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/shared/lib/utils";
import { useT } from "@/shared/i18n";
import { ChipPreviewPortal } from "./ChipPreviewPortal";
import { useHoverPreview } from "./use-hover-preview";
import "./attachment-tiles.css";

export const ATTACHMENT_TILE_SIZE = 64;
const ATTACHMENT_TILE_GAP = 6;

export type AttachmentTileItem = { key: string; node: ReactNode };

const fitCount = (widths: readonly number[], available: number): number => {
  let used = 0;
  for (let index = 0; index < widths.length; index += 1) {
    const next = used + (index > 0 ? ATTACHMENT_TILE_GAP : 0) + widths[index]!;
    const remaining = widths.length - index - 1;
    const reserve = remaining > 0 ? ATTACHMENT_TILE_GAP + ATTACHMENT_TILE_SIZE : 0;
    if (next + reserve > available) return index;
    used = next;
  }
  return widths.length;
};

function OverflowTile({ items }: { items: AttachmentTileItem[] }) {
  const t = useT();
  const { triggerRef, open, previewProps } = useHoverPreview<HTMLButtonElement>();
  const [pinned, setPinned] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!pinned) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (cardRef.current?.contains(target)) return;
      if (target.closest("[role='dialog'], [data-component='image-lightbox-overlay']")) return;
      setPinned(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPinned(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [pinned, triggerRef]);

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className="attachment-tile attachment-tile--more"
        aria-label={t("app.chat.messageRow.showMoreChips", { count: items.length })}
        aria-expanded={pinned || open}
        data-state={pinned || open ? "open" : "closed"}
        onClick={() => setPinned((value) => !value)}
      >
        +{items.length}
      </button>
      <ChipPreviewPortal
        triggerRef={triggerRef}
        open={pinned || open}
        preferredPlacement="top"
        className="attachment-tiles-overflow-card"
        {...previewProps}
      >
        <div className="attachment-tiles-overflow-grid" ref={cardRef}>
          {items.map((item) => (
            <Fragment key={item.key}>{item.node}</Fragment>
          ))}
        </div>
      </ChipPreviewPortal>
    </>
  );
}

/**
 * One row of same-size attachment tiles (images, files, pasted text). When
 * more tiles exist than fit, the last slot becomes a "+N" tile; hovering or
 * clicking it reveals the rest, each keeping its own preview behaviour.
 */
type AttachmentTileRowProps = {
  items: AttachmentTileItem[];
  align: "start" | "end";
  className?: string;
};

export function AttachmentTileRow(props: AttachmentTileRowProps) {
  if (props.items.length === 0) return null;
  return <MeasuredAttachmentTileRow {...props} />;
}

function MeasuredAttachmentTileRow({
  items,
  align,
  className,
}: AttachmentTileRowProps) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [shownCount, setShownCount] = useState(items.length);
  const signature = items.map((item) => item.key).join("|");

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return undefined;
    const measure = () => {
      const wrappers = Array.from(
        row.querySelectorAll<HTMLElement>(":scope > .attachment-tiles__item"),
      );
      const widths = wrappers.map((el) => el.offsetWidth);
      const next = fitCount(widths, row.clientWidth);
      setShownCount((previous) => (previous === next ? previous : next));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    for (const el of row.querySelectorAll<HTMLElement>(":scope > .attachment-tiles__item")) {
      observer.observe(el);
    }
    return () => observer.disconnect();
  }, [signature]);

  const hidden = items.slice(shownCount);

  return (
    <div
      ref={rowRef}
      className={cn("attachment-tiles", `attachment-tiles--${align}`, className)}
    >
      {items.map((item, index) => {
        const offFlow = index >= shownCount;
        return (
          <span
            key={item.key}
            className="attachment-tiles__item"
            data-off-flow={offFlow ? "true" : undefined}
            aria-hidden={offFlow ? true : undefined}
            inert={offFlow ? true : undefined}
          >
            {item.node}
          </span>
        );
      })}
      {hidden.length > 0 ? <OverflowTile items={hidden} /> : null}
    </div>
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

/**
 * Pasted text as a tile: a small preview of its first lines. Hovering or
 * focusing opens the full (bounded) preview in a scrollable card.
 */
export function PastedTextTile({
  text,
  preview,
  label,
  remove,
}: {
  text: string;
  preview: string;
  label: string;
  remove?: ReactNode;
}) {
  const { triggerRef, open, previewProps } = useHoverPreview<HTMLButtonElement>();
  return (
    <span className="attachment-tile-shell composer-chip-shell">
      <button
        type="button"
        ref={triggerRef}
        className="attachment-tile attachment-tile--text"
        aria-label={label}
        title={label}
      >
        <span className="attachment-tile__text">{firstLines(text) || label}</span>
      </button>
      {remove}
      {preview ? (
        <ChipPreviewPortal
          triggerRef={triggerRef}
          open={open}
          preferredPlacement="top"
          className="event-pasted-text-preview-card"
          {...previewProps}
        >
          <div className="event-pasted-text-preview-body">{preview}</div>
        </ChipPreviewPortal>
      ) : null}
    </span>
  );
}
