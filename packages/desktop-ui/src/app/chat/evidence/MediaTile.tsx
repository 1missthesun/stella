import { useCallback, useState } from "react";
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
import { Maximize2 } from "@/ui/icons";
import { VideoFrame } from "./VideoFrame";
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

const StackBody = ({ card }: { card: EvidenceCard }) => {
  const frames = card.frames ?? [];
  const [index, setIndex] = useState(0);
  const current = frames[index];
  const advance = useCallback(() => {
    setIndex((value) => (frames.length === 0 ? 0 : (value + 1) % frames.length));
  }, [frames.length]);
  return (
    <button type="button" className="media-tile__stack" onClick={advance}>
      <span className="media-tile__stack-shadow media-tile__stack-shadow--far" />
      <span className="media-tile__stack-shadow media-tile__stack-shadow--near" />
      {current?.thumbnail ? (
        <img
          className="media-tile__stack-face"
          src={current.thumbnail}
          alt={current.title}
        />
      ) : (
        <span className="media-tile__stack-face media-tile__stack-face--blank" />
      )}
      <span className="media-tile__badge">
        {index + 1}/{frames.length}
      </span>
    </button>
  );
};

const isDriveCard = (card: EvidenceCard): boolean =>
  Boolean(card.sourcePaths[0] && driveLinkPath(card.sourcePaths[0]));

const TileBody = ({ card }: { card: EvidenceCard }) => {
  if (card.kind === "video" && !isDriveCard(card)) {
    return (
      <VideoFrame
        poster={card.thumbnail}
        filePath={card.sourcePaths[0] ?? ""}
        mimeType={card.playbackMimeType}
        durationMs={card.durationMs}
        title={card.title}
      />
    );
  }
  if (card.kind === "audio" && card.peaks) {
    return (
      <WaveformTile
        peaks={card.peaks}
        filePath={card.sourcePaths[0] ?? ""}
        durationLabel={card.subtitle}
      />
    );
  }
  if (card.kind === "stack") return <StackBody card={card} />;
  if (card.thumbnail) {
    return (
      <button
        type="button"
        className="media-tile__raster"
        onClick={() => {
          const target = card.sourcePaths[0];
          if (target) openEvidenceSource(target);
        }}
      >
        <img src={card.thumbnail} alt={card.title} draggable={false} />
      </button>
    );
  }
  return null;
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
    <div className="media-tile__frame">
      {visible ? <TileBody card={card} /> : null}
      <button
        type="button"
        className="media-tile__open"
        aria-label={`Open ${card.title}`}
        onClick={(event) => {
          event.stopPropagation();
          const target = card.sourcePaths[card.sourcePaths.length - 1];
          if (target) openEvidenceSource(target);
        }}
      >
        <Maximize2 size={11} />
      </button>
    </div>
    {VISUAL_KINDS.has(card.kind) ? null : (
      <figcaption className="media-tile__caption" title={card.sourcePaths.join(", ")}>
        {card.title}
      </figcaption>
    )}
  </figure>
);
