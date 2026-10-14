import { useCallback } from "react";
import { useT } from "@/shared/i18n";

const mountedCards = new Map<string, HTMLElement>();
const mountListeners = new Set<() => void>();
let pendingCardKey: string | null = null;

export const requestSettingsCard = (cardKey: string): void => {
  pendingCardKey = cardKey;
};

export const clearPendingSettingsCard = (): void => {
  pendingCardKey = null;
};

export const revealPendingSettingsCard = (): boolean => {
  const heading = pendingCardKey ? mountedCards.get(pendingCardKey) : null;
  if (!heading) return false;
  pendingCardKey = null;
  const card = heading.closest<HTMLElement>(".settings-card") ?? heading;
  card.scrollIntoView({ behavior: "smooth", block: "start" });
  card.setAttribute("data-search-target", "true");
  card.addEventListener(
    "animationend",
    () => card.removeAttribute("data-search-target"),
    { once: true },
  );
  return true;
};

export const subscribeSettingsCardMounts = (
  listener: () => void,
): (() => void) => {
  mountListeners.add(listener);
  return () => {
    mountListeners.delete(listener);
  };
};

export function SettingsCardTitle({ titleKey }: { titleKey: string }) {
  const t = useT();
  const register = useCallback(
    (heading: HTMLHeadingElement | null) => {
      if (!heading) return;
      mountedCards.set(titleKey, heading);
      for (const listener of mountListeners) listener();
      return () => {
        if (mountedCards.get(titleKey) === heading) {
          mountedCards.delete(titleKey);
        }
      };
    },
    [titleKey],
  );
  return (
    <h3 ref={register} className="settings-card-title">
      {t(titleKey)}
    </h3>
  );
}
