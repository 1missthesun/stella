import { useCallback, useState } from "react";
import type { ChatContext } from "@/shared/types/electron";
import { useT } from "@/shared/i18n";
import { layer, radius, useTokens } from "../theme";

export function useScreenshotPreview(chatContext: ChatContext | null) {
  const [index, setIndex] = useState<number | null>(null);
  const screenshot = index !== null ? (chatContext?.regionScreenshots?.[index] ?? null) : null;
  const effectiveIndex = screenshot ? index : null;
  const setPreviewIndex = useCallback((next: number | null) => setIndex(next), []);
  return { screenshot, previewIndex: effectiveIndex, setPreviewIndex };
}

export function ScreenshotPreviewOverlay({ screenshot, index, onClose }: { screenshot: { dataUrl: string }; index: number; onClose: () => void }) {
  const t = useT();
  const tokens = useTokens();
  const label = t("app.chat.screenshotPreview.alt", { index: index + 1 });
  return (
    <col fixed inset={0} raise={layer.preview} center pad={24} fill="rgba(0,0,0,0.72)" onPress={onClose} enter="fade" exit="fade">
      <box role="dialog" label={label} modal={{ clickOutside: true }} onDismiss={onClose} maxW="92%" maxH="92%" onPress={() => {}}>
        <image src={screenshot.dataUrl} label={label} fit="contain" radius={radius.xl} shadows={tokens.shadow.xl} />
      </box>
    </col>
  );
}
