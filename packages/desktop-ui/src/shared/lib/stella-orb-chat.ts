import type { ChatContext } from "@/shared/types/electron";

export const STELLA_COMPOSE_TEXT_EVENT = "stella:compose-text";

export type StellaComposeTextDetail = {
  text: string;
  chatContext?: ChatContext | null;
  selectedText?: string | null;
};

export function dispatchComposeText(detail: StellaComposeTextDetail) {
  window.dispatchEvent(
    new CustomEvent<StellaComposeTextDetail>(STELLA_COMPOSE_TEXT_EVENT, {
      detail,
    }),
  );
}

export const STELLA_SHOW_HOME_EVENT = "stella:show-home";

export function dispatchShowHome() {
  window.dispatchEvent(new CustomEvent(STELLA_SHOW_HOME_EVENT));
}

