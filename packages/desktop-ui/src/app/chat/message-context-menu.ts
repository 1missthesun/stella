import type { MenuSection } from "@/platform/context-menu";
import { copyText } from "@/platform/context-menu";
import { translateNow as t } from "@/shared/i18n";
import {
  manualReadAloudStatus,
  toggleManualReadAloud,
} from "@/features/voice/services/read-aloud/manual-read-aloud";
import { cloudSendRecovery } from "@/features/cloud/cloud-send-recovery";

type CopyAttachment = {
  path?: string;
  url?: string;
  mimeType?: string;
  kind?: string;
  name?: string;
};

/**
 * A message's own actions, the same ones its hover controls offer: copy it,
 * reply to it, read it aloud, and retry or remove one that didn't send.
 */
export const messageMenu =
  (options: {
    text: string;
    messageKey: string;
    /** The rendered text, when it reads differently from the source. */
    renderedText?: () => string | null;
    copyAttachment?: CopyAttachment | null;
    onReply?: ((text: string) => void) | null;
    readAloud?: boolean;
    sendFailed?: boolean;
  }) =>
  (): MenuSection[] => {
    const source = options.text.trim();
    const rendered = options.renderedText?.()?.trim() || "";
    const sections: MenuSection[] = [];
    const copy: MenuSection = [];
    if (source) {
      copy.push({
        label: t("contextMenu.copyMessage"),
        run: () => copyText(rendered || source),
      });
      if (rendered && rendered !== source) {
        copy.push({
          label: t("contextMenu.copyAsMarkdown"),
          run: () => copyText(source),
        });
      }
    } else if (options.copyAttachment) {
      const attachment = options.copyAttachment;
      copy.push({
        label: t("contextMenu.copyMessage"),
        run: () => window.electronAPI?.media?.copyAttachment?.(attachment),
      });
    }
    if (copy.length > 0) sections.push(copy);
    const act: MenuSection = [];
    if (options.onReply && source) {
      const reply = options.onReply;
      act.push({
        label: t("app.chat.messageActions.reply"),
        run: () => reply(source),
      });
    }
    if (options.readAloud && source) {
      const playing = manualReadAloudStatus(options.messageKey) !== "idle";
      act.push({
        label: playing
          ? t("app.chat.messageActions.stopReading")
          : t("app.chat.messageActions.readAloud"),
        run: () => toggleManualReadAloud(options.messageKey, options.text),
      });
    }
    if (act.length > 0) sections.push(act);
    if (options.sendFailed) {
      sections.push([
        {
          label: t("contextMenu.retrySend"),
          run: () => cloudSendRecovery()?.retry(options.messageKey),
        },
        {
          label: t("contextMenu.removeMessage"),
          run: () => cloudSendRecovery()?.dismiss(options.messageKey),
        },
      ]);
    }
    return sections;
  };
