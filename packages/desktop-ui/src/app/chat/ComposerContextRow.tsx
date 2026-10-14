import { useCallback, useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ChatContext } from "@/shared/types/electron";
import { getElectronApi } from "@/platform/electron/electron";
import {
  ComposerActivityContextSection,
  ComposerAppSelectionContextSection,
  ComposerAttachmentTilesSection,
  ComposerSelectedTextContextSection,
  ComposerWindowContextSection,
} from "./ComposerContextSections";
import {
  appChipToChatContext,
  tabChipToChatContext,
  useAutoContextChips,
  type SuggestionSlot,
} from "@/features/chat/hooks/use-auto-context-chips";

type ComposerContextRowProps = {
  variant?: "full" | "compact";
  chatContext: ChatContext | null;
  selectedText: string | null;
  setChatContext: Dispatch<SetStateAction<ChatContext | null>>;
  setSelectedText: Dispatch<SetStateAction<string | null>>;
  onPreviewScreenshot?: (index: number) => void;
};

export function ComposerContextRow({
  variant = "full",
  chatContext,
  selectedText,
  setChatContext,
  setSelectedText,
}: ComposerContextRowProps) {
  return (
    <div className="composer-context-actions">
      <ComposerAttachmentTilesSection
        variant={variant}
        chatContext={chatContext}
        setChatContext={setChatContext}
      />
      <ComposerSelectedTextContextSection
        variant={variant}
        selectedText={selectedText}
        setSelectedText={setSelectedText}
        setChatContext={setChatContext}
      />
      <ComposerAppSelectionContextSection
        variant={variant}
        chatContext={chatContext}
        setChatContext={setChatContext}
      />
      <ComposerActivityContextSection
        variant={variant}
        chatContext={chatContext}
        setChatContext={setChatContext}
      />
      <ComposerWindowContextSection
        variant={variant}
        chatContext={chatContext}
        setChatContext={setChatContext}
      />
    </div>
  );
}

export type ComposerContextSuggestion = SuggestionSlot;

export function useComposerContextSuggestions(
  active: boolean,
  chatContext: ChatContext | null,
  setChatContext: Dispatch<SetStateAction<ChatContext | null>>,
): {
  suggestions: ComposerContextSuggestion[];
  selectSuggestion: (suggestion: ComposerContextSuggestion) => void;
} {
  const { lanes, dismissSlot } = useAutoContextChips(active);
  const attachedAppName =
    chatContext?.window?.app?.toLowerCase().trim() ?? null;
  const attachedUrl = chatContext?.browserUrl ?? null;

  const suggestions = useMemo(
    () =>
      lanes.flatMap((lane) => {
        const slot = lane.current;
        if (!slot) return [];
        const attached =
          slot.chip.kind === "tab"
            ? Boolean(attachedUrl && attachedUrl === slot.chip.url)
            : Boolean(
                attachedAppName &&
                  slot.chip.name.toLowerCase().trim() === attachedAppName,
              );
        return attached ? [] : [slot];
      }),
    [attachedAppName, attachedUrl, lanes],
  );

  const selectSuggestion = useCallback(
    (slot: ComposerContextSuggestion) => {
      if (slot.chip.kind === "tab") {
        setChatContext(tabChipToChatContext(slot.chip));
        captureAppWindowAsync(
          { appName: slot.chip.browser, pid: null },
          setChatContext,
        );
      } else {
        setChatContext(appChipToChatContext(slot.chip));
        captureAppWindowAsync(
          {
            appName: slot.chip.name,
            pid: slot.chip.pid > 0 ? slot.chip.pid : null,
          },
          setChatContext,
        );
      }
      dismissSlot(slot.key);
    },
    [dismissSlot, setChatContext],
  );

  return { suggestions, selectSuggestion };
}

const captureAppWindowAsync = (
  target: { appName: string; pid: number | null },
  setChatContext: Dispatch<SetStateAction<ChatContext | null>>,
): void => {
  const api = getElectronApi();
  const captureFn = api?.home?.captureAppWindow;
  if (!captureFn) {
    setChatContext((prev) =>
      prev ? { ...prev, capturePending: false } : prev,
    );
    return;
  }

  const { appName, pid } = target;

  void (async () => {
    try {
      const result = await captureFn({ appName, pid });
      const capture = result?.capture ?? null;
      setChatContext((prev) => {
        if (!prev?.window) return prev;
        if (prev.window.app !== appName) return prev;
        if (prev.capturePending !== true) return prev;
        if (!capture) {
          return { ...prev, capturePending: false };
        }
        return {
          ...prev,
          window: {
            ...prev.window,
            title: capture.title || prev.window.title,
          },
          windowScreenshot: capture.screenshot,
          windowAxTree: capture.axTree ?? prev.windowAxTree ?? null,
          capturePending: false,
        };
      });
    } catch (error) {
      console.warn("[home] captureAppWindow failed", error);
      setChatContext((prev) =>
        prev ? { ...prev, capturePending: false } : prev,
      );
    }
  })();
};

