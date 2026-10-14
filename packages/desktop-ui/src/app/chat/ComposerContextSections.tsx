import type { Dispatch, SetStateAction } from "react";
import type { ChatContext } from "@/shared/types/electron";
import {
  ActivityContextChip,
  AppSelectionChips,
  FileContextChip,
  PastedTextChip,
  PendingCaptureChip,
  ScreenshotContextChip,
  SelectedTextChip,
  WindowContextChip,
} from "./ComposerContextChips";
import { getComposerAppSelections } from "@/features/chat/composer-context";
import { AttachmentTileRow, type AttachmentTileItem } from "./AttachmentTiles";
import "./composer-context.css";

type ComposerContextVariant = "full" | "compact";

type SetChatContext = Dispatch<SetStateAction<ChatContext | null>>;
type SetSelectedText = Dispatch<SetStateAction<string | null>>;

type SharedContextProps = {
  variant: ComposerContextVariant;
  chatContext: ChatContext | null;
  setChatContext: SetChatContext;
};

type SelectedTextContextSectionProps = {
  variant: ComposerContextVariant;
  selectedText: string | null;
  setSelectedText: SetSelectedText;
  setChatContext: SetChatContext;
};

const pillVariantClassNames = {
  full: {
    containerClassName: null,
    chipClassName: undefined,
  },
  compact: {
    containerClassName: null,
    chipClassName: "context-pill--compact",
  },
} as const;

export function ComposerWindowContextSection({
  variant,
  chatContext,
  setChatContext,
}: SharedContextProps) {
  if (!chatContext?.window) {
    return null;
  }

  const sharedProps = {
    chatWindow: chatContext.window,
    chatWindowScreenshot: chatContext.windowScreenshot,
    capturePending: chatContext.capturePending,
    setChatContext,
    className:
      "chat-composer-context-chip chat-composer-context-chip--window composer-context-chip composer-context-chip--window",
    toggleClassName: "composer-context-window-toggle",
    textClassName: "chat-composer-context-window composer-context-window",
    textFormatter: (chatWindow: NonNullable<ChatContext["window"]>) =>
      chatWindow.title
        ? `${chatWindow.app} — ${chatWindow.title}`
        : chatWindow.app,
  } as const;

  if (variant === "compact") {
    return <WindowContextChip {...sharedProps} />;
  }

  return <WindowContextChip {...sharedProps} />;
}

export function ComposerAttachmentTilesSection({
  chatContext,
  setChatContext,
}: SharedContextProps) {
  const items: AttachmentTileItem[] = [];
  (chatContext?.regionScreenshots ?? []).forEach((screenshot, index) => {
    items.push({
      key: `screenshot-${index}`,
      node: (
        <ScreenshotContextChip
          screenshot={screenshot}
          index={index}
          setChatContext={setChatContext}
        />
      ),
    });
  });
  if (chatContext?.capturePending && !chatContext.window) {
    items.push({
      key: "capture-pending",
      node: (
        <PendingCaptureChip
          className="attachment-tile attachment-tile--pending"
          innerClassName="chat-composer-context-pending-inner attachment-tile__pending-inner"
        />
      ),
    });
  }
  (chatContext?.files ?? []).forEach((file, index) => {
    items.push({
      key: `file-${index}-${file.name}`,
      node: (
        <FileContextChip
          file={file}
          index={index}
          setChatContext={setChatContext}
        />
      ),
    });
  });
  (chatContext?.pastedTexts ?? []).forEach((text, index) => {
    items.push({
      key: `pasted-${index}`,
      node: (
        <PastedTextChip
          text={text}
          index={index}
          setChatContext={setChatContext}
        />
      ),
    });
  });
  return <AttachmentTileRow items={items} align="start" />;
}

export function ComposerAppSelectionContextSection({
  variant,
  chatContext,
  setChatContext,
}: SharedContextProps) {
  const appSelections = getComposerAppSelections(chatContext);
  if (appSelections.length === 0) {
    return null;
  }

  const classes = pillVariantClassNames[variant];
  const content = (
    <AppSelectionChips
      appSelections={appSelections}
      setChatContext={setChatContext}
      className={classes.chipClassName}
    />
  );

  if (!classes.containerClassName) return content;
  return <div className={classes.containerClassName}>{content}</div>;
}

export function ComposerActivityContextSection({
  variant,
  chatContext,
  setChatContext,
}: SharedContextProps) {
  if (!chatContext?.activity) {
    return null;
  }

  const classes = pillVariantClassNames[variant];
  const content = (
    <ActivityContextChip
      activity={chatContext.activity}
      setChatContext={setChatContext}
      className={classes.chipClassName}
    />
  );

  if (!classes.containerClassName) return content;
  return <div className={classes.containerClassName}>{content}</div>;
}

export function ComposerSelectedTextContextSection({
  variant,
  selectedText,
  setSelectedText,
  setChatContext,
}: SelectedTextContextSectionProps) {
  if (!selectedText) {
    return null;
  }

  const classes = pillVariantClassNames[variant];
  const content = (
    <SelectedTextChip
      selectedText={selectedText}
      setSelectedText={setSelectedText}
      setChatContext={setChatContext}
      className={classes.chipClassName}
    />
  );

  if (!classes.containerClassName) {
    return content;
  }

  return <div className={classes.containerClassName}>{content}</div>;
}
