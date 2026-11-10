import type { Dispatch, SetStateAction } from "react";
import type { ChatContext } from "@/shared/types/electron";
import {
  ComposerActivityContextSection,
  ComposerAppSelectionContextSection,
  ComposerAttachmentTilesSection,
  ComposerSelectedTextContextSection,
  ComposerWindowContextSection,
} from "./ComposerContextSections";

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
