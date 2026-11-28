import { useEffect, useRef, useState } from "react";
import type { EvidenceCardSet } from "@stella/contracts/chat-evidence";

const EMPTY: EvidenceCardSet = { cards: [], overflowCount: 0 };

const resolved = new Map<string, EvidenceCardSet>();
const pending = new Map<string, Promise<EvidenceCardSet>>();

const requestCards = (key: string, filePaths: string[], conversationId: string | null): Promise<EvidenceCardSet> => {
  const existing = pending.get(key);
  if (existing) return existing;
  const bridge = window.electronAPI?.chatEvidence;
  if (!bridge) return Promise.resolve(EMPTY);
  const work = bridge
    .cards(filePaths, { conversationId })
    .then((set) => {
      resolved.set(key, set);
      return set;
    })
    .catch(() => EMPTY)
    .finally(() => {
      pending.delete(key);
    });
  pending.set(key, work);
  return work;
};

export const useEvidenceCards = (filePaths: string[], conversationId: string | null = null): EvidenceCardSet => {
  const key = `${conversationId ?? ""}\0${filePaths.join("\0")}`;
  const latest = useRef(filePaths);
  latest.current = filePaths;
  const [set, setSet] = useState<EvidenceCardSet>(() => resolved.get(key) ?? EMPTY);

  useEffect(() => {
    const paths = latest.current;
    if (paths.length === 0) {
      setSet(EMPTY);
      return;
    }
    const cached = resolved.get(key);
    if (cached) {
      setSet(cached);
      return;
    }
    let live = true;
    void requestCards(key, paths, conversationId).then((next) => {
      if (live) setSet(next);
    });
    return () => {
      live = false;
    };
  }, [key, conversationId]);

  return set;
};
