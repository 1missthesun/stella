import { useCallback, useEffect, useState } from "react";
import { hasFields, isArrayOf } from "@stella/contracts/value-guards";
import { uiState } from "@/platform/ui-state";
import { getEmojiSpriteSheetCount } from "./sprite-map";

const ACTIVE_EMOJI_PACK_KEY = "stella:emoji-pack:active";

export type ActiveEmojiPack = {
  packId: string;
  sheetUrls: string[];
};

export const hasCompleteEmojiSpritePack = (
  pack: ActiveEmojiPack | null,
): pack is ActiveEmojiPack =>
  (pack?.sheetUrls.length ?? 0) >= getEmojiSpriteSheetCount();

const isFilledString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isActiveEmojiPack = (value: unknown): value is ActiveEmojiPack =>
  hasFields(value, {
    packId: isFilledString,
    sheetUrls: isArrayOf(isFilledString, 1),
  });

export const readActiveEmojiPack = (): ActiveEmojiPack | null => {
  try {
    const raw = uiState.getItem(ACTIVE_EMOJI_PACK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isActiveEmojiPack(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const writeActiveEmojiPack = (pack: ActiveEmojiPack | null): void => {
  if (pack) {
    uiState.setItem(ACTIVE_EMOJI_PACK_KEY, JSON.stringify(pack));
  } else {
    uiState.removeItem(ACTIVE_EMOJI_PACK_KEY);
  }
  window.dispatchEvent(new Event("stella-active-emoji-pack-change"));
};

export const useActiveEmojiPack = (): [
  ActiveEmojiPack | null,
  (pack: ActiveEmojiPack | null) => void,
] => {
  const [pack, setPack] = useState<ActiveEmojiPack | null>(() =>
    readActiveEmojiPack(),
  );
  useEffect(() => {
    const sync = () => setPack(readActiveEmojiPack());
    const stopExternal = uiState.onExternalChange((key) => {
      if (key === ACTIVE_EMOJI_PACK_KEY) sync();
    });
    window.addEventListener("stella-active-emoji-pack-change", sync);
    return () => {
      stopExternal();
      window.removeEventListener("stella-active-emoji-pack-change", sync);
    };
  }, []);
  const update = useCallback((next: ActiveEmojiPack | null) => {
    writeActiveEmojiPack(next);
    setPack(next);
  }, []);
  return [pack, update];
};
