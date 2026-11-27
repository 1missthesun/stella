import { useCallback, useEffect, useMemo, useState } from "react";
import { useMaterializedMediaPayload, useMaterializedMediaPayloadSnapshot } from "@/app/media/media-materializer-state";
import type { DisplayPayload } from "@stella/contracts/desktop/display-payload";
import type { MediaJob } from "@stella/contracts/backend/media";
import { useDisplayFileBlobs } from "@/shared/hooks/use-display-file-data";
import { openDisplayPayloadTab } from "@/features/workspace-display/open-payload";
import { imageGenerationFailureKey } from "@/app/media/media-error-copy";
import { InlineGeneratedImageCardWithJob } from "@/app/chat/InlineGeneratedImageCardWithJob";
import { fileMenu } from "@/platform/context-menu";
import { contextMenu } from "../context-menu";
import { useT } from "@/shared/i18n";
import { derive, fontSize, mixOklch, radius, useTokens } from "../../theme";
import { panelSurface } from "../surfaces";
import { GeneratingGlow } from "./GeneratingGlow";
import { encodedImageSize } from "../../../host/electron/encoded-image-size";

export type InlineGeneratedImagePayload = Extract<DisplayPayload, { kind: "media" }>;

type StripTileSpec = { key: string; payload: InlineGeneratedImagePayload; imageIndex: number; materializeJob: boolean };

const STRIP_TILE_W = 168;
const STRIP_TILE_H = 180;
const STRIP_GAP = 6;
const SINGLE_MAX_W = 320;

const filenameOf = (filePath: string): string => filePath.split(/[\\/]/).pop() ?? filePath;

export type MediaJobLookup = MediaJob | null;

export const requestedSizeFromInput = (input: Record<string, unknown> | undefined): { width: number; height: number } | null => {
  const imageSize = input?.image_size;
  if (!imageSize || typeof imageSize !== "object") return null;
  const record = imageSize as Record<string, unknown>;
  const width = typeof record.width === "number" && Number.isFinite(record.width) ? Math.floor(record.width) : null;
  const height = typeof record.height === "number" && Number.isFinite(record.height) ? Math.floor(record.height) : null;
  return width !== null && height !== null && width > 0 && height > 0 ? { width, height } : null;
};

const ratioFromAspectRatio = (aspectRatio: string | undefined): number | null => {
  if (!aspectRatio) return null;
  const match = aspectRatio.trim().match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return width / height;
};

const previewAspectRatio = (payload: InlineGeneratedImagePayload, job: MediaJobLookup | undefined): number => {
  const requestedSize = payload.requestedSize ?? requestedSizeFromInput(job?.input);
  if (requestedSize) return requestedSize.width / requestedSize.height;
  return ratioFromAspectRatio(payload.aspectRatio) ?? 4 / 3;
};

const HEADER_BYTES = 512 * 1024;

const useNaturalAspect = (blob: Blob | null): number | null => {
  const [aspect, setAspect] = useState<{ blob: Blob; value: number | null } | null>(null);
  useEffect(() => {
    if (!blob) return;
    let cancelled = false;
    void blob
      .slice(0, HEADER_BYTES)
      .arrayBuffer()
      .then((buffer) => {
        const size = encodedImageSize(new Uint8Array(buffer));
        if (!cancelled) setAspect({ blob, value: size && size.height > 0 ? size.width / size.height : null });
      });
    return () => {
      cancelled = true;
    };
  }, [blob]);
  return blob && aspect?.blob === blob ? aspect.value : null;
};

const resolveImageCount = (payload: InlineGeneratedImagePayload, materializedPayload: DisplayPayload | null): number => {
  const materializedPaths = materializedPayload?.kind === "media" && materializedPayload.asset.kind === "image" ? materializedPayload.asset.filePaths : [];
  const payloadPaths = payload.asset.kind === "image" ? payload.asset.filePaths : [];
  return Math.max(materializedPaths.length, payloadPaths.length, payload.numImages ?? 1, 1);
};

const buildStripTiles = (payloads: InlineGeneratedImagePayload[], materializedByJobId: ReadonlyMap<string, DisplayPayload>): StripTileSpec[] => {
  const tiles: StripTileSpec[] = [];
  let materializeAssigned = false;
  for (const payload of payloads) {
    const materializedPayload = payload.jobId ? (materializedByJobId.get(payload.jobId) ?? null) : null;
    const hasResolvedAssets = payload.asset.kind === "image" && payload.asset.filePaths.length > 0;
    const imageCount = resolveImageCount(payload, materializedPayload);
    for (let imageIndex = 0; imageIndex < imageCount; imageIndex += 1) {
      const needsMaterialize = !materializeAssigned && Boolean(payload.jobId) && !materializedPayload && !hasResolvedAssets;
      tiles.push({ key: `${payload.jobId ?? payload.createdAt}-${imageIndex}`, payload, imageIndex, materializeJob: needsMaterialize });
      if (needsMaterialize) materializeAssigned = true;
    }
  }
  return tiles;
};

const countLoadedStripTiles = (tiles: StripTileSpec[], materializedByJobId: ReadonlyMap<string, DisplayPayload>): number => {
  let loaded = 0;
  for (const tile of tiles) {
    const materializedPayload = tile.payload.jobId ? (materializedByJobId.get(tile.payload.jobId) ?? null) : null;
    const payloadPath = tile.payload.asset.kind === "image" ? tile.payload.asset.filePaths[tile.imageIndex] : undefined;
    const materializedPath = materializedPayload?.kind === "media" && materializedPayload.asset.kind === "image" ? materializedPayload.asset.filePaths[tile.imageIndex] : undefined;
    if (payloadPath || materializedPath) loaded += 1;
  }
  return loaded;
};

export const InlineGeneratedImageStrip = ({ payloads, conversationId }: { payloads: InlineGeneratedImagePayload[]; conversationId?: string | null }) => {
  const t = useT();
  const tokens = useTokens();
  const materializedByJobId = useMaterializedMediaPayloadSnapshot();
  const tiles = useMemo(() => buildStripTiles(payloads, materializedByJobId), [materializedByJobId, payloads]);
  if (tiles.length === 0) return null;
  const isStrip = tiles.length > 1;
  const isStripPending = isStrip && countLoadedStripTiles(tiles, materializedByJobId) === 0;
  const cards = tiles.map((tile) => (
    <InlineGeneratedImageCard
      key={tile.key}
      payload={tile.payload}
      conversationId={conversationId}
      imageIndex={tile.imageIndex}
      materializeJob={tile.materializeJob}
      layout={isStrip ? "strip" : "single"}
      sharedStripPending={isStripPending}
    />
  ));
  if (!isStrip) {
    return (
      <row wrap gap={8} mt={10} maxW="full">
        {cards}
      </row>
    );
  }
  if (isStripPending) {
    return (
      <box mt={10} maxW="full" w={tiles.length * STRIP_TILE_W + (tiles.length - 1) * STRIP_GAP} radius={12} clip={12} role="group" label={t("app.chat.generatedImage.stripLabel")}>
        <GeneratingGlow />
        <row gap={STRIP_GAP} pb={4} inert>
          {cards}
        </row>
        <box absolute={{ left: 0, top: 0, right: 0, bottom: 0 }} center inert>
          <text size={fontSize.base} color={tokens.c.textWeak}>
            {t("app.chat.generatedImage.generating")}
          </text>
        </box>
      </box>
    );
  }
  return (
    <box mt={10} maxW="full" scrollX role="group" label={t("app.chat.generatedImage.stripLabel")}>
      <row gap={STRIP_GAP} pb={4}>
        {cards}
      </row>
    </box>
  );
};

export type InlineGeneratedImageCardProps = {
  payload: InlineGeneratedImagePayload;
  imageIndex?: number;
  materializeJob?: boolean;
  layout?: "single" | "strip";
  sharedStripPending?: boolean;
  conversationId?: string | null;
};

const needsRemoteJobLookup = ({ payload, materializeJob = true }: InlineGeneratedImageCardProps): boolean =>
  Boolean(payload.jobId && materializeJob && payload.asset.kind === "image" && payload.asset.filePaths.length === 0);

export const InlineGeneratedImageCard = (props: InlineGeneratedImageCardProps) =>
  needsRemoteJobLookup(props) ? <InlineGeneratedImageCardWithJob {...props} /> : <InlineGeneratedImageCardLocal {...props} />;

const InlineGeneratedImageCardLocal = (props: InlineGeneratedImageCardProps) => {
  const materializedPayload = useMaterializedMediaPayload(props.payload.jobId);
  return <InlineGeneratedImageCardFrame {...props} job={undefined} materializedPayload={materializedPayload} />;
};

export const InlineGeneratedImageCardFrame = ({
  payload,
  imageIndex = 0,
  layout = "single",
  sharedStripPending = false,
  conversationId,
  job,
  materializedPayload,
}: InlineGeneratedImageCardProps & { job: MediaJobLookup | undefined; materializedPayload: DisplayPayload | null }) => {
  const t = useT();
  const tokens = useTokens();
  const effectivePayload = useMemo(() => {
    const merged =
      materializedPayload?.kind === "media" && materializedPayload.asset.kind === "image"
        ? ({ ...materializedPayload, presentation: payload.presentation, ...(payload.numImages ? { numImages: payload.numImages } : {}) } as const)
        : payload;
    if (merged.asset.kind !== "image") return merged;
    const payloadPath = payload.asset.kind === "image" ? payload.asset.filePaths[imageIndex] : undefined;
    const path = merged.asset.filePaths[imageIndex] ?? payloadPath ?? null;
    return { ...merged, asset: { kind: "image" as const, filePaths: path ? [path] : [] }, imageIndex };
  }, [imageIndex, materializedPayload, payload]);

  const isImage = effectivePayload.asset.kind === "image";
  const filePaths = isImage ? effectivePayload.asset.filePaths : [];
  const { files, error, loading } = useDisplayFileBlobs(filePaths, t("app.chat.generatedImage.hostRequired"), conversationId);
  const primaryFile = files[0] ?? null;
  const primaryPath = filePaths[0];
  const jobFailed = job?.status === "failed" || job?.status === "canceled";
  const naturalAspect = useNaturalAspect(layout === "strip" ? null : (primaryFile?.blob ?? null));
  const aspect = (primaryFile ? naturalAspect : null) ?? previewAspectRatio(effectivePayload, job);
  const open = useCallback(() => {
    if (!isImage || filePaths.length === 0) return;
    openDisplayPayloadTab(effectivePayload);
  }, [effectivePayload, filePaths.length, isImage]);
  if (!isImage) return null;

  const strip = layout === "strip";
  const placeholderLabel = error
    ? t("app.chat.generatedImage.loadFailed")
    : jobFailed
      ? t(imageGenerationFailureKey(job?.error))
      : loading || filePaths.length === 0
        ? t("app.chat.generatedImage.generatingImage")
        : t("app.chat.generatedImage.image");
  const surface = panelSurface(tokens);
  const look = derive(tokens, "inline-generated-image-card", (k) => ({
    hover: mixOklch(k.c.foreground, 5, "transparent"),
    failedBorder: mixOklch(k.c.destructive, 32, k.c.border),
    failedHoverBorder: mixOklch(k.c.destructive, 38, k.c.border),
    failedFill: mixOklch(k.c.destructive, 7, k.c.card),
    failedFrame: mixOklch(k.c.destructive, 6, k.c.card),
    failedText: mixOklch(k.c.foreground, 62, k.c.destructive),
  }));
  const frameH = strip ? STRIP_TILE_H : undefined;
  const chrome = primaryFile
    ? {}
    : sharedStripPending
      ? { border: tokens.c.border, fill: tokens.c.surfaceInset }
      : jobFailed
        ? { border: look.failedBorder, hoverBorder: look.failedHoverBorder, fill: look.failedFill }
        : { border: surface.border, hoverBorder: tokens.c.borderStrong, gradient: surface.gradient, shadows: surface.shadows, hoverFill: look.hover };
  return (
    <box
      role="button"
      focusable={!sharedStripPending}
      label={sharedStripPending ? undefined : (strip && !primaryFile) || jobFailed ? placeholderLabel : (effectivePayload.prompt ?? (primaryPath ? filenameOf(primaryPath) : undefined))}
      title={jobFailed ? t("app.chat.generatedImage.generationFailed") : t("app.chat.generatedImage.openInPanel")}
      shrink={false}
      w={strip ? STRIP_TILE_W : "full"}
      maxW={strip ? undefined : SINGLE_MAX_W}
      radius={radius["2xl"]}
      clip={radius["2xl"]}
      cursor="default"
      focusRing={{ color: tokens.c.ring, width: 2, offset: 0 }}
      onPress={open}
      onContextMenu={contextMenu(primaryPath ? fileMenu(primaryPath, { open, image: true }) : () => null, { claims: ["image"] })}
      {...chrome}
    >
      {primaryFile ? (
        <image src={primaryFile.url} w="full" h={frameH} aspect={frameH ? undefined : aspect} fit="cover" radius={12} />
      ) : (
        <box w="full" h={frameH} aspect={frameH ? undefined : aspect} fill={jobFailed ? look.failedFrame : sharedStripPending ? undefined : tokens.c.surfaceInset} center clip={0}>
          {jobFailed || sharedStripPending ? null : <GeneratingGlow />}
          {sharedStripPending || strip ? null : (
            <text size={fontSize.base} weight={jobFailed ? 500 : 400} color={jobFailed ? look.failedText : tokens.c.textWeak}>
              {placeholderLabel}
            </text>
          )}
        </box>
      )}
    </box>
  );
};
