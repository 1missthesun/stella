import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  EVIDENCE_TILE_WIDTH,
  isEvidenceMediaKind,
  type EvidenceCard,
} from "@stella/contracts/chat-evidence";
import { useEvidenceCards } from "@/features/chat/hooks/use-evidence-cards";
import { useT } from "@/shared/i18n";
import { MediaTile } from "./MediaTile";
import { AttachmentPill } from "./AttachmentPill";
import "./attachment-strip.css";

const useOnscreenTiles = (
  rowRef: React.RefObject<HTMLDivElement | null>,
  count: number,
  wrapped: boolean,
): Set<string> => {
  const [visible, setVisible] = useState<Set<string>>(new Set());
  useEffect(() => {
    const row = rowRef.current;
    if (!row || count === 0 || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        setVisible((previous) => {
          const next = new Set(previous);
          let changed = false;
          for (const entry of entries) {
            const id = (entry.target as HTMLElement).dataset.evidenceTile;
            if (!id) continue;
            if (entry.isIntersecting && !next.has(id)) {
              next.add(id);
              changed = true;
            } else if (!entry.isIntersecting && next.has(id)) {
              next.delete(id);
              changed = true;
            }
          }
          return changed ? next : previous;
        });
      },
      // A wrapped grid scrolls with the chat, so it watches the viewport instead of the row.
      { root: wrapped ? null : row, rootMargin: "200px" },
    );
    for (const tile of row.querySelectorAll<HTMLElement>("[data-evidence-tile]")) {
      observer.observe(tile);
    }
    return () => observer.disconnect();
  }, [rowRef, count, wrapped]);
  return visible;
};

const TILE_GAP = 10;
const MORE_TILE_WIDTH = 76;

const expandStacks = (cards: readonly EvidenceCard[]): EvidenceCard[] =>
  cards.flatMap((card) =>
    card.kind === "stack" && card.frames && card.frames.length > 0
      ? card.frames.map((frame, index) => ({
          id: `${card.id}:${index}`,
          kind: "image" as const,
          title: frame.title,
          sourcePaths: [frame.sourcePath],
          ...(frame.thumbnail ? { thumbnail: frame.thumbnail } : {}),
        }))
      : [card],
  );

const tileWidth = (card: EvidenceCard): number => EVIDENCE_TILE_WIDTH[card.kind];

const fittingCount = (cards: readonly EvidenceCard[], width: number): number => {
  if (width <= 0) return cards.length;
  let used = 0;
  for (let index = 0; index < cards.length; index += 1) {
    const next = used + (index > 0 ? TILE_GAP : 0) + tileWidth(cards[index]!);
    const remaining = cards.length - index - 1;
    const reserve = remaining > 0 ? TILE_GAP + MORE_TILE_WIDTH : 0;
    if (next + reserve > width) return index;
    used = next;
  }
  return cards.length;
};

const useRowWidth = (
  rowRef: React.RefObject<HTMLDivElement | null>,
  mounted: boolean,
): number => {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const row = rowRef.current;
    if (!mounted || !row || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0]?.contentRect.width ?? 0);
      setWidth((previous) => (previous === next ? previous : next));
    });
    observer.observe(row);
    return () => observer.disconnect();
  }, [mounted, rowRef]);
  return width;
};

// Expanded grids stay bounded; past this many tiles a "Show all" step reveals the rest.
const EXPANDED_TILE_CAP = 48;

// A user's own expand/collapse choice per message, kept for the session so it
// survives the row scrolling out of the virtualized list and back.
const chosenExpansion = new Map<string, boolean>();
const expansionListeners = new Set<() => void>();
let expansionVersion = 0;
const subscribeExpansion = (listener: () => void) => {
  expansionListeners.add(listener);
  return () => {
    expansionListeners.delete(listener);
  };
};
const chooseExpansion = (key: string, expanded: boolean) => {
  chosenExpansion.set(key, expanded);
  expansionVersion += 1;
  for (const listener of expansionListeners) listener();
};
const useExpanded = (key: string | undefined, fallback: boolean): boolean => {
  useSyncExternalStore(subscribeExpansion, () => expansionVersion);
  return (key ? chosenExpansion.get(key) : undefined) ?? fallback;
};

const ToggleTile = ({
  label,
  text,
  expanded,
  onClick,
}: {
  label: string;
  text: string;
  expanded: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    className="attachment-strip__more-tile"
    data-kind={expanded ? "less" : "more"}
    aria-label={label}
    aria-expanded={expanded}
    title={label}
    onClick={onClick}
  >
    {text}
  </button>
);

const NO_DRIVE_CARDS: readonly EvidenceCard[] = [];

export const MessageAttachments = ({
  filePaths,
  part,
  driveCards = NO_DRIVE_CARDS,
  expansionKey,
  expandedByDefault = false,
}: {
  filePaths: string[];
  part: "media" | "documents";
  driveCards?: readonly EvidenceCard[];
  /** Identifies the message, so a manual expand/collapse sticks to it. */
  expansionKey?: string;
  /** The latest message with media opens expanded; older ones start as one row. */
  expandedByDefault?: boolean;
}) => {
  const t = useT();
  const rowRef = useRef<HTMLDivElement | null>(null);
  const expanded = useExpanded(expansionKey, expandedByDefault);
  const [showEverything, setShowEverything] = useState(false);
  const { cards, overflowCount } = useEvidenceCards(filePaths);

  const { media, documents } = useMemo(() => {
    const media: EvidenceCard[] = [];
    const documents: EvidenceCard[] = [];
    for (const card of expandStacks(cards)) {
      if (isEvidenceMediaKind(card.kind) && card.kind !== "audio") media.push(card);
      else if (card.kind === "audio" && card.peaks) media.push(card);
      else documents.push(card);
    }
    media.push(...driveCards);
    return { media, documents };
  }, [cards, driveCards]);

  const rowWidth = useRowWidth(rowRef, part === "media" && media.length > 0);
  const rowCount = fittingCount(media, rowWidth);
  const collapsible = rowCount < media.length;
  const wrapped = expanded && collapsible;
  const cappedCount =
    showEverything || media.length <= EXPANDED_TILE_CAP ? media.length : EXPANDED_TILE_CAP;
  const shownCount = wrapped ? cappedCount : rowCount;
  const shown = media.slice(0, shownCount);
  const hiddenCount = media.length - shownCount;
  const visible = useOnscreenTiles(rowRef, part === "media" ? shown.length : 0, wrapped);
  const setExpanded = (next: boolean) => {
    if (expansionKey) chooseExpansion(expansionKey, next);
    if (!next) setShowEverything(false);
  };

  if (part === "media") {
    if (media.length === 0) return null;
    return (
      <div className="attachment-strip attachment-strip--media">
        <div
          className="attachment-strip__media"
          data-expanded={wrapped ? "" : undefined}
          ref={rowRef}
        >
          {shown.map((card) => (
            <div
              key={card.id}
              className="attachment-strip__tile"
              data-evidence-tile={card.id}
            >
              <MediaTile card={card} visible={visible.has(card.id)} />
            </div>
          ))}
          {!wrapped && hiddenCount > 0 ? (
            <ToggleTile
              expanded={false}
              text={`+${hiddenCount}`}
              label={t("app.chat.attachmentStrip.showMore", { count: hiddenCount })}
              onClick={() => setExpanded(true)}
            />
          ) : null}
          {wrapped && hiddenCount > 0 ? (
            <ToggleTile
              expanded={false}
              text={`+${hiddenCount}`}
              label={t("app.chat.attachmentStrip.showAll", { count: media.length })}
              onClick={() => setShowEverything(true)}
            />
          ) : null}
          {wrapped ? (
            <ToggleTile
              expanded
              text={t("app.chat.attachmentStrip.showLess")}
              label={t("app.chat.attachmentStrip.showLess")}
              onClick={() => setExpanded(false)}
            />
          ) : null}
        </div>
      </div>
    );
  }

  if (documents.length === 0 && overflowCount === 0) return null;

  return (
    <div className="attachment-strip">
      <div className="attachment-strip__pills">
        {documents.map((card) => (
          <AttachmentPill key={card.id} card={card} />
        ))}
        {overflowCount > 0 ? (
          <span className="attachment-strip__more">+{overflowCount} more</span>
        ) : null}
      </div>
    </div>
  );
};
