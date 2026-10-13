import {
  EVIDENCE_TILE_WIDTH,
  type EvidenceCard,
} from "@stella/contracts/chat-evidence";
import {
  cloudWorldDriveName,
  driveLinkPath,
} from "@stella/contracts/cloud-world-paths";
import { cloudDriveEntry } from "@/features/workspace-display/derive-conversation-files";
import { openDisplayPayloadTab } from "@/features/workspace-display/open-payload";
import { buildPayloadFromBarePath } from "@/features/chat/lib/derive-turn-resource";
import { WaveformTile } from "./WaveformTile";

const VISUAL_KINDS: ReadonlySet<EvidenceCard["kind"]> = new Set([
  "image",
  "stack",
  "video",
]);

export const openEvidenceSource = (filePath: string) => {
  const drivePath = driveLinkPath(filePath);
  if (drivePath) {
    const entry = cloudDriveEntry(
      {
        path: drivePath,
        name: cloudWorldDriveName(drivePath),
        sizeBytes: 0,
        contentType: "application/octet-stream",
      },
      Date.now(),
    );
    openDisplayPayloadTab({ ...entry.payload, cloudDrivePath: drivePath });
    return;
  }
  const payload = buildPayloadFromBarePath(filePath, Date.now());
  if (payload) openDisplayPayloadTab(payload);
};

const openCardSource = (card: EvidenceCard) => {
  const target = card.sourcePaths[card.sourcePaths.length - 1];
  if (target) openEvidenceSource(target);
};

const TileBody = ({ card }: { card: EvidenceCard }) => {
  if (card.kind === "audio" && card.peaks) {
    return <WaveformTile peaks={card.peaks} durationLabel={card.subtitle} />;
  }
  return (
    <>
      {card.thumbnail ? (
        <img
          className="media-tile__image"
          src={card.thumbnail}
          alt=""
          draggable={false}
        />
      ) : (
        <span className="media-tile__image" />
      )}
      {card.kind === "video" && card.durationMs && card.subtitle ? (
        <span className="media-tile__badge" aria-hidden="true">
          {card.subtitle}
        </span>
      ) : null}
    </>
  );
};

export const MediaTile = ({
  card,
  visible,
}: {
  card: EvidenceCard;
  visible: boolean;
}) => (
  <figure
    className="media-tile"
    data-kind={card.kind}
    style={{ width: `${EVIDENCE_TILE_WIDTH[card.kind]}px` }}
  >
    <button
      type="button"
      className="media-tile__frame"
      aria-label={`Open ${card.title}`}
      onClick={(event) => {
        event.stopPropagation();
        openCardSource(card);
      }}
    >
      {visible ? <TileBody card={card} /> : null}
    </button>
    {VISUAL_KINDS.has(card.kind) ? null : (
      <figcaption className="media-tile__caption" title={card.sourcePaths.join(", ")}>
        {card.title}
      </figcaption>
    )}
  </figure>
);
