import {
  evidenceSourceKind,
  formatByteSize,
  humanTitleFor,
  plainKindLabel,
  playbackMimeTypeFor,
  type EvidenceSourceKind,
} from "@stella/contracts/chat-evidence-naming";
import type { EvidenceCard } from "@stella/contracts/chat-evidence";

export type EvidenceSource = {
  filePath: string;
  kind: EvidenceSourceKind;
  order: number;
};

export const EVIDENCE_MEDIA_CAP = 8;
export const EVIDENCE_PILL_CAP = 8;

const PATH_SEPARATORS = /[\\/]/;

export const evidenceBasename = (filePath: string): string => {
  const cleaned = filePath.trim().split(/[?#]/)[0] ?? filePath.trim();
  const parts = cleaned.split(PATH_SEPARATORS);
  return parts[parts.length - 1] ?? cleaned;
};

export const describeEvidenceSources = (
  filePaths: readonly string[],
): EvidenceSource[] => {
  const seen = new Set<string>();
  const sources: EvidenceSource[] = [];
  for (const candidate of filePaths) {
    const filePath = candidate.trim();
    if (!filePath || seen.has(filePath)) continue;
    seen.add(filePath);
    sources.push({
      filePath,
      kind: evidenceSourceKind(filePath, false),
      order: sources.length,
    });
  }
  return sources;
};

export const evidenceTitleFor = (source: EvidenceSource): string =>
  humanTitleFor(source.filePath, source.kind);

export const pillCardFor = (
  source: EvidenceSource,
  byteSize?: number,
): EvidenceCard => ({
  id: `pill:${source.filePath}`,
  kind: source.kind === "bundle" ? "bundle" : "plain",
  title: evidenceTitleFor(source),
  subtitle: byteSize
    ? `${plainKindLabel(source.filePath)} · ${formatByteSize(byteSize)}`
    : plainKindLabel(source.filePath),
  sourcePaths: [source.filePath],
  extensionLabel: plainKindLabel(source.filePath),
  ...(byteSize ? { byteSize } : {}),
});

export const evidencePlaybackMimeType = (filePath: string): string | undefined =>
  playbackMimeTypeFor(filePath);
