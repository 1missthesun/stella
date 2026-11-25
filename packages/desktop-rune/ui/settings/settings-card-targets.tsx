import { useEffect, useSyncExternalStore } from "react";
import { useT } from "@/shared/i18n";
import { T } from "../kit/compat";
import { useSettings } from "./settings.styles";
import { useCardRegistration } from "./parts";

type Mounted = { cardId: string; y: number };

const mountedCards = new Map<string, Mounted>();
const mountListeners = new Set<() => void>();
let pendingCardKey: string | null = null;
let pulse: { key: string; at: number } | null = null;
const pulseListeners = new Set<() => void>();
let panel: { id: string; y: number; scrollY: number } | null = null;

export const requestSettingsCard = (cardKey: string): void => {
  pendingCardKey = cardKey;
};

export const clearPendingSettingsCard = (): void => {
  pendingCardKey = null;
};

/** The scroll box cards are revealed in (`.settings-panel`) and where it is. */
export const setSettingsScrollPanel = (next: { id: string; y: number; scrollY: number } | null) => {
  panel = next;
};

/** Scrolls the pending card's top to the panel's top (`scrollIntoView({block: "start"})`) and pulses it. */
export const revealPendingSettingsCard = (): boolean => {
  const card = pendingCardKey ? mountedCards.get(pendingCardKey) : null;
  if (!card || !panel || !pendingCardKey) return false;
  const key = pendingCardKey;
  pendingCardKey = null;
  void stella.engine.scroll.to(panel.id, Math.max(0, panel.scrollY + card.y - panel.y), { spring: 0.45 });
  pulse = { key, at: Date.now() };
  for (const l of pulseListeners) l();
  return true;
};

export const subscribeSettingsCardMounts = (listener: () => void): (() => void) => {
  mountListeners.add(listener);
  return () => {
    mountListeners.delete(listener);
  };
};

const subscribePulse = (l: () => void) => {
  pulseListeners.add(l);
  return () => pulseListeners.delete(l);
};

/** The card key a search jump is pulsing now, for `SettingsCard`'s highlight. */
export const usePulsingCard = () => useSyncExternalStore(subscribePulse, () => pulse);

export function SettingsCardTitle({ titleKey }: { titleKey: string }) {
  const t = useT();
  const s = useSettings();
  const card = useCardRegistration();
  useEffect(() => {
    if (!card) return;
    card.setTitleKey(titleKey);
    return () => card.setTitleKey(null);
  }, [card, titleKey]);
  return (
    <T role="heading" w="full" {...s.settingsCardTitle} {...(card?.inHeader ? { mb: 0 } : null)} {...(card?.account ? s.settingsTabContentAccount_settingsCardTitle : null)}>
      {t(titleKey)}
    </T>
  );
}

/** Where a card with this title is (window y), as its card reports it. */
export function noteCardPlace(titleKey: string, cardId: string, y: number) {
  const known = mountedCards.get(titleKey);
  mountedCards.set(titleKey, { cardId, y });
  if (!known) for (const l of mountListeners) l();
}

export function forgetCardPlace(titleKey: string, cardId: string) {
  if (mountedCards.get(titleKey)?.cardId === cardId) mountedCards.delete(titleKey);
}
