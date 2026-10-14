import { useEffect, useRef, useState } from "react";
import type { EvidenceCard } from "@stella/contracts/chat-evidence";
import { driveLinkPath } from "@stella/contracts/cloud-world-paths";
import {
  backendClient,
  readBackendAccountEpoch,
  subscribeBackendAccount,
} from "@/platform/backend/backend-client";

const EMPTY: readonly EvidenceCard[] = [];
const resolved = new Map<string, readonly EvidenceCard[]>();
const pending = new Map<string, Promise<readonly EvidenceCard[]>>();

subscribeBackendAccount(() => {
  resolved.clear();
  pending.clear();
});

const requestCards = (
  key: string,
  drivePaths: readonly string[],
): Promise<readonly EvidenceCard[]> => {
  const existing = pending.get(key);
  if (existing) return existing;
  const bridge = window.electronAPI?.chatEvidence;
  if (!bridge?.driveCards) return Promise.resolve(EMPTY);
  const epoch = readBackendAccountEpoch();
  const work = (async () => {
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
            },
          ]
        : [],
    );
    if (files.length === 0) return EMPTY;
    const cards = await bridge.driveCards(files);
    if (epoch === readBackendAccountEpoch()) resolved.set(key, cards);
    return cards;
  })()
    .catch(() => EMPTY)
    .finally(() => {
      pending.delete(key);
    });
  pending.set(key, work);
  return work;
};

export const evidenceCardDrivePath = (card: EvidenceCard): string | null =>
  card.sourcePaths[0] ? driveLinkPath(card.sourcePaths[0]) : null;

export const useDriveEvidenceCards = (
  drivePaths: readonly string[],
): readonly EvidenceCard[] => {
  const key = drivePaths.join("\n");
  const latest = useRef(drivePaths);
  latest.current = drivePaths;
  const [cards, setCards] = useState<readonly EvidenceCard[]>(
    () => resolved.get(key) ?? EMPTY,
  );

  useEffect(() => {
    const paths = latest.current;
    if (paths.length === 0) {
      setCards(EMPTY);
      return;
    }
    const cached = resolved.get(key);
    if (cached) {
      setCards(cached);
      return;
    }
    let live = true;
    void requestCards(key, paths).then((next) => {
      if (live) setCards(next);
    });
    return () => {
      live = false;
    };
  }, [key]);

  return cards;
};
