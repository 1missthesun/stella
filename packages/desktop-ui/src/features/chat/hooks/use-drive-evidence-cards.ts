import { useEffect, useState } from "react";
import type { EvidenceCard } from "@stella/contracts/chat-evidence";
import { driveLinkPath, driveLinkTarget } from "@stella/contracts/cloud-world-paths";
import { humanTitleFor } from "@stella/contracts/chat-evidence-naming";
import { isHtmlPagePath } from "@stella/contracts/page-preview";
import type { DriveFileVersion } from "@stella/contracts/drive-file-versions";
import {
  backendClient,
  readBackendAccountEpoch,
  subscribeBackendAccount,
} from "@/platform/backend/backend-client";
import { useDriveFileVersions } from "@/features/cloud/drive-file-versions";

const EMPTY: readonly EvidenceCard[] = [];

type Resolved = {
  versions: readonly (string | null)[];
  cards: readonly EvidenceCard[];
  expiresAt?: number;
};

const PREVIEW_URL_MARGIN_MS = 60_000;

const isFresh = (entry: Resolved): boolean =>
  entry.expiresAt === undefined || entry.expiresAt - PREVIEW_URL_MARGIN_MS > Date.now();

const hostRendersCards = (): boolean => Boolean(window.electronAPI?.chatEvidence?.driveCards);

const requestPagePreviews = async (drivePaths: readonly string[]): Promise<Resolved> => {
  const previews = await Promise.all(
    drivePaths.map((path) =>
      backendClient.call("drive.pagePreview", { path }).catch(() => null),
    ),
  );
  const cards = previews.flatMap((preview): EvidenceCard[] =>
    preview
      ? [
          {
            id: `page:${preview.path}:${preview.version}`,
            kind: "page",
            title: humanTitleFor(preview.path, "page"),
            sourcePaths: [driveLinkTarget(preview.path)],
            thumbnail: preview.url,
          },
        ]
      : [],
  );
  const expiries = previews.flatMap((preview) => (preview ? [preview.expiresAt] : []));
  return {
    versions: previews.map((preview) => preview?.version ?? null),
    cards: cards.length === 0 ? EMPTY : cards,
    ...(expiries.length > 0 ? { expiresAt: Math.min(...expiries) } : {}),
  };
};

const resolved = new Map<string, Resolved>();
const pending = new Map<string, Promise<Resolved | null>>();

subscribeBackendAccount(() => {
  resolved.clear();
  pending.clear();
});

const versionsMatch = (
  known: readonly DriveFileVersion[],
  shown: readonly (string | null)[],
): boolean =>
  known.every((version, index) => version === undefined || version === shown[index]);

const requestCards = (key: string): Promise<Resolved | null> => {
  const existing = pending.get(key);
  if (existing) return existing;
  const drivePaths = key.split("\n");
  const bridge = window.electronAPI?.chatEvidence;
  const epoch = readBackendAccountEpoch();
  const work = (async (): Promise<Resolved> => {
    if (!bridge?.driveCards) {
      const next = await requestPagePreviews(drivePaths);
      if (epoch === readBackendAccountEpoch()) resolved.set(key, next);
      return next;
    }
    const located = await Promise.all(
      drivePaths.map((path) =>
        backendClient.call("drive.fileUrl", { path }).catch(() => null),
      ),
    );
    const files = located.flatMap((file) =>
      file
        ? [
            {
              drivePath: file.path,
              url: file.url,
              sizeBytes: file.sizeBytes,
              contentType: file.contentType,
              version: file.version,
            },
          ]
        : [],
    );
    const next: Resolved = {
      versions: located.map((file) => file?.version ?? null),
      cards: files.length === 0 ? EMPTY : await bridge.driveCards(files),
    };
    if (epoch === readBackendAccountEpoch()) resolved.set(key, next);
    return next;
  })()
    .catch(() => null)
    .finally(() => {
      pending.delete(key);
    });
  pending.set(key, work);
  return work;
};

const loadCards = async (
  key: string,
  versions: readonly DriveFileVersion[],
): Promise<Resolved | null> => {
  const inFlight = pending.get(key);
  if (inFlight) {
    const settled = await inFlight;
    if (settled && isFresh(settled) && versionsMatch(versions, settled.versions)) return settled;
  }
  return await requestCards(key);
};

export const evidenceCardDrivePath = (card: EvidenceCard): string | null =>
  card.sourcePaths[0] ? driveLinkPath(card.sourcePaths[0]) : null;

export const useDriveEvidenceCards = (
  requestedPaths: readonly string[],
): readonly EvidenceCard[] => {
  const drivePaths = hostRendersCards()
    ? requestedPaths
    : requestedPaths.filter((path) => isHtmlPagePath(path));
  const key = drivePaths.join("\n");
  const versions = useDriveFileVersions(drivePaths);
  const [cards, setCards] = useState<readonly EvidenceCard[]>(
    () => resolved.get(key)?.cards ?? EMPTY,
  );

  useEffect(() => {
    if (!key) {
      setCards(EMPTY);
      return;
    }
    const cached = resolved.get(key);
    if (cached) setCards(cached.cards);
    if (cached && isFresh(cached) && versionsMatch(versions, cached.versions)) return;
    let live = true;
    void loadCards(key, versions).then((next) => {
      if (live && next) setCards(next.cards);
    });
    return () => {
      live = false;
    };
  }, [key, versions]);

  return cards;
};
