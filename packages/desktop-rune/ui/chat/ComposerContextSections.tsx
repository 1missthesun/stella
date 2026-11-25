import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { ChatContext } from "@/shared/types/electron";
import { getComposerAppSelections } from "@/features/chat/composer-context";
import { ActivityContextChip, AppSelectionChips, CompactContextPills, FileContextChip, PastedTextChip, PendingCaptureTile, ScreenshotContextChip, SelectedTextChip, ShowCaptureChip, WindowContextChip } from "./ComposerContextChips";
import { AttachmentTileRow, type AttachmentTileItem } from "./AttachmentTiles";

type ComposerContextVariant = "full" | "compact";
type SetChatContext = Dispatch<SetStateAction<ChatContext | null>>;
type SharedContextProps = { variant: ComposerContextVariant; chatContext: ChatContext | null; setChatContext: SetChatContext };

const windowLabel = (chatWindow: NonNullable<ChatContext["window"]>) => (chatWindow.title ? `${chatWindow.app} — ${chatWindow.title}` : chatWindow.app);

const Pills = ({ variant, children }: { variant: ComposerContextVariant; children: ReactNode }) => <CompactContextPills.Provider value={variant === "compact"}>{children}</CompactContextPills.Provider>;

export function ComposerWindowContextSection({ chatContext, setChatContext }: SharedContextProps) {
  if (!chatContext?.window) return null;
  return <WindowContextChip chatWindow={chatContext.window} chatWindowScreenshot={chatContext.windowScreenshot} capturePending={chatContext.capturePending} setChatContext={setChatContext} textFormatter={windowLabel} />;
}

export function ComposerAttachmentTilesSection({ chatContext, setChatContext }: SharedContextProps) {
  const items: AttachmentTileItem[] = [];
  (chatContext?.showCaptures ?? []).forEach((capture) => {
    items.push({ key: `show-capture-${capture.id}`, node: <ShowCaptureChip capture={capture} setChatContext={setChatContext} /> });
  });
  (chatContext?.regionScreenshots ?? []).forEach((screenshot, index) => {
    items.push({ key: `screenshot-${index}`, node: <ScreenshotContextChip screenshot={screenshot} index={index} setChatContext={setChatContext} /> });
  });
  if (chatContext?.capturePending && !chatContext.window) items.push({ key: "capture-pending", node: <PendingCaptureTile /> });
  (chatContext?.files ?? []).forEach((file, index) => {
    items.push({ key: `file-${index}-${file.name}`, node: <FileContextChip file={file} index={index} setChatContext={setChatContext} /> });
  });
  (chatContext?.pastedTexts ?? []).forEach((text, index) => {
    items.push({ key: `pasted-${index}`, node: <PastedTextChip text={text} index={index} setChatContext={setChatContext} /> });
  });
  return <AttachmentTileRow items={items} align="start" />;
}

export function ComposerAppSelectionContextSection({ variant, chatContext, setChatContext }: SharedContextProps) {
  const appSelections = getComposerAppSelections(chatContext);
  if (appSelections.length === 0) return null;
  return (
    <Pills variant={variant}>
      <AppSelectionChips appSelections={appSelections} setChatContext={setChatContext} />
    </Pills>
  );
}

export function ComposerActivityContextSection({ variant, chatContext, setChatContext }: SharedContextProps) {
  if (!chatContext?.activity) return null;
  return (
    <Pills variant={variant}>
      <ActivityContextChip activity={chatContext.activity} setChatContext={setChatContext} />
    </Pills>
  );
}

export function ComposerSelectedTextContextSection({
  variant,
  selectedText,
  setSelectedText,
  setChatContext,
}: {
  variant: ComposerContextVariant;
  selectedText: string | null;
  setSelectedText: Dispatch<SetStateAction<string | null>>;
  setChatContext: SetChatContext;
}) {
  if (!selectedText) return null;
  return (
    <Pills variant={variant}>
      <SelectedTextChip selectedText={selectedText} setSelectedText={setSelectedText} setChatContext={setChatContext} />
    </Pills>
  );
}
