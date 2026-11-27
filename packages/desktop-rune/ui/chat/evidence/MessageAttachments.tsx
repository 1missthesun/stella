import { useMemo, useState } from "react";
import { viewAtom } from "@/platform/view-state/view-state";
import { EVIDENCE_TILE_WIDTH, isEvidenceMediaKind, type EvidenceCard } from "@stella/contracts/chat-evidence";
import { useEvidenceCards } from "@/features/chat/hooks/use-evidence-cards";
import { useT } from "@/shared/i18n";
import { derive, fontSize, mixOklch, radius, useTokens } from "../../theme";
import { MEDIA_TILE_HEIGHT, MediaTile } from "./MediaTile";
import { AttachmentPill } from "./AttachmentPill";

const TILE_GAP = 10;
const MORE_TILE_WIDTH = 76;
const EXPANDED_TILE_CAP = 48;
const REMEMBERED_EXPANSIONS = 200;

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

const fittingCount = (cards: readonly EvidenceCard[], width: number): number => {
  if (width <= 0) return cards.length;
  let used = 0;
  for (let index = 0; index < cards.length; index += 1) {
    const next = used + (index > 0 ? TILE_GAP : 0) + EVIDENCE_TILE_WIDTH[cards[index]!.kind];
    const reserve = cards.length - index - 1 > 0 ? TILE_GAP + MORE_TILE_WIDTH : 0;
    if (next + reserve > width) return index;
    used = next;
  }
  return cards.length;
};

const chosenExpansion = viewAtom<Record<string, boolean>>("chat.attachmentsExpanded", {});
const chooseExpansion = (key: string, expanded: boolean) => {
  chosenExpansion.set((chosen) => Object.fromEntries([...Object.entries(chosen).filter(([known]) => known !== key), [key, expanded] as const].slice(-REMEMBERED_EXPANSIONS)));
};
const useExpanded = (key: string | undefined, fallback: boolean): boolean => {
  const chosen = chosenExpansion.use();
  return (key ? chosen[key] : undefined) ?? fallback;
};

function ToggleTile({ label, text, expanded, onPress }: { label: string; text: string; expanded: boolean; onPress: () => void }) {
  const tokens = useTokens();
  const look = derive(tokens, "attachment-strip:more", (k) => ({ hover: mixOklch(k.c.foreground, 8, k.c.surfaceInset) }));
  return (
    <box
      role="button"
      focusable
      label={label}
      title={label}
      expanded={expanded}
      shrink={false}
      w={expanded ? undefined : MORE_TILE_WIDTH}
      minW={MORE_TILE_WIDTH}
      h={MEDIA_TILE_HEIGHT}
      px={expanded ? 14 + 1 : 1}
      center
      radius={radius.lg}
      fill={tokens.c.surfaceInset}
      hoverFill={look.hover}
      border={tokens.c.panelSurfaceBorder}
      cursor="pointer"
      focusRing={{ color: tokens.c.ring, width: 2, offset: 0 }}
      onPress={onPress}
    >
      <text
        size={expanded ? fontSize.sm : fontSize.lg}
        weight={expanded ? 500 : 600}
        features="'tnum' 1"
        color={expanded ? tokens.c.textMuted : tokens.c.textStrong}
      >
        {text}
      </text>
    </box>
  );
}

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
  expansionKey?: string;
  expandedByDefault?: boolean;
}) => {
  const t = useT();
  const tokens = useTokens();
  const expanded = useExpanded(expansionKey, expandedByDefault);
  const [showEverything, setShowEverything] = useState(false);
  const [rowWidth, setRowWidth] = useState(0);
  const { cards, overflowCount } = useEvidenceCards(filePaths);

  const { media, documents } = useMemo(() => {
    const media: EvidenceCard[] = [];
    const documents: EvidenceCard[] = [];
    for (const card of expandStacks(cards)) {
      if (isEvidenceMediaKind(card.kind) && card.kind !== "audio") media.push(card);
      else if (card.kind === "audio" && card.peaks) media.push(card);
      else if (card.kind === "page" && card.thumbnail) media.push(card);
      else documents.push(card);
    }
    media.push(...driveCards);
    return { media, documents };
  }, [cards, driveCards]);

  const rowCount = fittingCount(media, rowWidth);
  const collapsible = rowCount < media.length;
  const wrapped = expanded && collapsible;
  const cappedCount = showEverything || media.length <= EXPANDED_TILE_CAP ? media.length : EXPANDED_TILE_CAP;
  const shownCount = wrapped ? cappedCount : rowCount;
  const shown = media.slice(0, shownCount);
  const hiddenCount = media.length - shownCount;
  const setExpanded = (next: boolean) => {
    if (expansionKey) chooseExpansion(expansionKey, next);
    if (!next) setShowEverything(false);
  };

  if (part === "media") {
    if (media.length === 0) return null;
    return (
      <col w="full" minW={0} mt={6}>
        <row w="full" minW={0} gap={TILE_GAP} wrap={wrapped} clip={wrapped ? undefined : 0} onSize={(r) => setRowWidth(Math.floor(r.w))}>
          {shown.map((card) => (
            <box key={card.id} shrink={false}>
              <MediaTile card={card} />
            </box>
          ))}
          {!wrapped && hiddenCount > 0 ? (
            <ToggleTile expanded={false} text={`+${hiddenCount}`} label={t("app.chat.attachmentStrip.showMore", { count: hiddenCount })} onPress={() => setExpanded(true)} />
          ) : null}
          {wrapped && hiddenCount > 0 ? (
            <ToggleTile expanded={false} text={`+${hiddenCount}`} label={t("app.chat.attachmentStrip.showAll", { count: media.length })} onPress={() => setShowEverything(true)} />
          ) : null}
          {wrapped ? <ToggleTile expanded text={t("app.chat.attachmentStrip.showLess")} label={t("app.chat.attachmentStrip.showLess")} onPress={() => setExpanded(false)} /> : null}
        </row>
      </col>
    );
  }

  if (documents.length === 0 && overflowCount === 0) return null;
  return (
    <col w="full" minW={0} mt={10} gap={8}>
      <row wrap align="center" gap={6} minW={0}>
        {documents.map((card) => (
          <AttachmentPill key={card.id} card={card} />
        ))}
        {overflowCount > 0 ? (
          <text size={fontSize.xs} color={tokens.c.mutedForeground}>
            {`+${overflowCount} more`}
          </text>
        ) : null}
      </row>
    </col>
  );
};
