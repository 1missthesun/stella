import { useEffect, useState } from "react";
import type { EvidenceCard } from "@stella/contracts/chat-evidence";
import { driveLinkPath } from "@stella/contracts/cloud-world-paths";
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
  if (!bridge?.driveCards) return Promise.resolve(null);
  const epoch = readBackendAccountEpoch();
  const work = (async (): Promise<Resolved> => {
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
    if (settled && versionsMatch(versions, settled.versions)) return settled;
  }
  return await requestCards(key);
};

export const evidenceCardDrivePath = (card: EvidenceCard): string | null =>
  card.sourcePaths[0] ? driveLinkPath(card.sourcePaths[0]) : null;

/**
 * Cards for the Drive files a message links. They are cached by path and
 * shown at once, and rebuilt when the Drive reports a different version of
 * any of those files, so a file replaced under the same name shows its new
 * content wherever it is linked.
 */
export const useDriveEvidenceCards = (
  drivePaths: readonly string[],
): readonly EvidenceCard[] => {
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
    if (cached && versionsMatch(versions, cached.versions)) return;
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
