import { EVIDENCE_TILE_WIDTH, type EvidenceCard } from "@stella/contracts/chat-evidence";
import { cloudWorldDriveName, driveLinkPath } from "@stella/contracts/cloud-world-paths";
import { isHtmlPagePath } from "@stella/contracts/page-preview";
import { cloudDriveEntry } from "@/features/workspace-display/derive-conversation-files";
import { openDisplayPayloadTab } from "@/features/workspace-display/open-payload";
import { buildPayloadFromBarePath } from "@/features/chat/lib/derive-turn-resource";
import { displayPayloadForStellaFile } from "@/features/chat/lib/stella-file-links";
import { fileMenu } from "@/platform/context-menu";
import { contextMenu } from "../context-menu";
import { translateNow } from "@/shared/i18n";
import { derive, fontSize, mixOklch, radius, useTokens } from "../../theme";
import { WaveformTile } from "./WaveformTile";

export const MEDIA_TILE_HEIGHT = 132;

const VISUAL_KINDS: ReadonlySet<EvidenceCard["kind"]> = new Set(["image", "stack", "video"]);

export const openEvidenceSource = (filePath: string) => {
  const drivePath = driveLinkPath(filePath);
  if (drivePath) {
    const entry = cloudDriveEntry({ path: drivePath, name: cloudWorldDriveName(drivePath), sizeBytes: 0, contentType: "application/octet-stream" }, Date.now());
    openDisplayPayloadTab({ ...entry.payload, cloudDrivePath: drivePath });
    return;
  }
  const payload = isHtmlPagePath(filePath) ? displayPayloadForStellaFile(filePath, Date.now()) : buildPayloadFromBarePath(filePath, Date.now());
  if (payload) openDisplayPayloadTab(payload);
};

const openCardSource = (card: EvidenceCard) => {
  const target = card.sourcePaths[card.sourcePaths.length - 1];
  if (target) openEvidenceSource(target);
};

export const MediaTile = ({ card }: { card: EvidenceCard }) => {
  const tokens = useTokens();
  const look = derive(tokens, "media-tile", (k) => ({ hover: mixOklch(k.c.foreground, 6, "transparent") }));
  const peaks = card.kind === "audio" ? card.peaks : undefined;
  const width = EVIDENCE_TILE_WIDTH[card.kind];
  const page = card.kind === "page";
  return (
    <col
      w={width}
      gap={5}
      onContextMenu={contextMenu(
        async () => {
          const target = card.sourcePaths[card.sourcePaths.length - 1];
          if (!target) return null;
          const open = () => openCardSource(card);
          if (driveLinkPath(target)) return [[{ label: translateNow("contextMenu.open"), run: open }]];
          return await fileMenu(target, { open, image: card.kind === "image" || card.kind === "stack" })();
        },
        { claims: ["image"] },
      )}
    >
      <box h={MEDIA_TILE_HEIGHT} w="full" clip={radius.lg} radius={radius.lg} fill={page ? "#ffffff" : tokens.c.surfaceInset} hoverGroup>
        <box
          absolute={{ left: 0, top: 0, right: 0, bottom: 0 }}
          role="button"
          focusable
          label={`Open ${card.title}`}
          cursor="pointer"
          hoverFill={look.hover}
          focusRing={{ color: tokens.c.ring, width: 2, offset: -2 }}
          onPress={() => openCardSource(card)}
        >
          {!peaks && card.thumbnail ? (
            <box absolute={{ left: 0, top: 0, right: 0, bottom: 0 }} hoverOpacity={[1, 0.9]} fill="#000000">
              <image src={card.thumbnail} fit="cover" w="full" h="full" />
            </box>
          ) : null}
          {!peaks && card.kind === "video" && card.durationMs && card.subtitle ? (
            <box absolute={{ right: 6, bottom: 6 }} py={1} px={6} radius={radius.full} fill="rgba(0,0,0,0.55)" inert>
              <text size={9.5} features="'tnum' 1" color="rgba(255,255,255,0.92)">
                {card.subtitle}
              </text>
            </box>
          ) : null}
        </box>
        {peaks ? <WaveformTile peaks={peaks} filePath={card.sourcePaths[0] ?? ""} durationLabel={card.subtitle} /> : null}
        <box absolute={{ left: 0, top: 0, right: 0, bottom: 0 }} radius={radius.lg} border={tokens.c.panelSurfaceBorder} inert />
      </box>
      {VISUAL_KINDS.has(card.kind) ? null : (
        <text size={fontSize.xs} lineHeight={fontSize.xs * 1.3} color={tokens.c.mutedForeground} title={card.sourcePaths.join(", ")} nowrap truncate>
          {card.title}
        </text>
      )}
    </col>
  );
};
