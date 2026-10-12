import {
  useState,
  type Dispatch,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
  type SetStateAction,
} from "react";
import { fileDisplayName } from "@stella/contracts/file-display-name";
import type { ChatContext, ChatContextFile } from "@/shared/types/electron";
import { cn } from "@/shared/lib/utils";
import { useT } from "@/shared/i18n";
import {
  AppWindowMac,
  Archive,
  ClipboardList,
  ClipboardPaste,
  Code,
  Crop,
  File,
  FileSpreadsheet,
  FileText,
  Music,
  TextQuote,
  Video,
  X,
} from "@/ui/icons";
import { ChipPreviewPortal } from "./ChipPreviewPortal";
import { PastedTextTile } from "./AttachmentTiles";
import { useHoverPreview } from "./use-hover-preview";
import { ImageLightbox } from "@/ui/image-lightbox";
import { getElectronApi } from "@/platform/electron/electron";
import {
  describePastedText,
  PASTED_TEXT_PREVIEW_MAX_CHARS,
  toPastedTextDescriptor,
} from "@/features/chat/lib/paste-context";
import {
  clearComposerActivityContext,
  clearComposerSelectedTextContext,
  clearComposerWindowContext,
  removeComposerAppSelectionContext,
  removeComposerFileContext,
  removeComposerPastedTextContext,
  removeComposerScreenshotContext,
  truncateChipLabel,
} from "@/features/chat/composer-context";
import "./composer-context.css";

type SetChatContext = Dispatch<SetStateAction<ChatContext | null>>;

/* ------------------------------------------------------------------ */
/*  Shared chip affordances                                           */
/* ------------------------------------------------------------------ */

/**
 * Small × pinned to the chip's top-right corner. Removal is deliberately
 * separated from the chip body — the body is the preview click target —
 * so the handlers stop propagation to keep the two from triggering each
 * other. Subtle until the chip is hovered or focused (CSS), but always
 * reachable via Tab.
 */
function ChipRemoveButton({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <button
      type="button"
      className="composer-chip-remove"
      aria-label={label}
      title={label}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onRemove();
      }}
    >
      <X size={10} strokeWidth={2.25} />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Canonical context pill                                            */
/* ------------------------------------------------------------------ */

export type ContextPillKind =
  | "window"
  | "app-selection"
  | "activity"
  | "pasted-text"
  | "selected-text";

const CONTEXT_PILL_ICONS = {
  window: AppWindowMac,
  "app-selection": Crop,
  activity: ClipboardList,
  "pasted-text": ClipboardPaste,
  "selected-text": TextQuote,
} as const;

type ContextPillProps = HTMLAttributes<HTMLElement> & {
  kind: ContextPillKind;
  label: ReactNode;
  /** Render as a button when the pill body is itself a click/hover target. */
  as?: "span" | "button";
  pillRef?: Ref<HTMLElement>;
  "data-has-preview"?: string;
};

/**
 * Canonical attached-context pill: leading type glyph + label with the
 * primary-tinted treatment. The single source of chip visuals for BOTH
 * the composer (pre-send) and the sent user message row, so the two
 * surfaces cannot drift apart. Wrappers add surface behavior: the
 * composer contributes the × remove control and hover previews; the
 * sent row contributes hovercards and the "+N" overflow.
 */
export function ContextPill({
  kind,
  label,
  as = "span",
  pillRef,
  className,
  children,
  ...rest
}: ContextPillProps) {
  const Icon = CONTEXT_PILL_ICONS[kind];
  const body = (
    <>
      <Icon
        className="context-pill__icon"
        size={13}
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <span className="context-pill__label">{label}</span>
      {children}
    </>
  );
  const pillClassName = cn("context-pill", `context-pill--${kind}`, className);
  if (as === "button") {
    return (
      <button
        type="button"
        ref={pillRef as Ref<HTMLButtonElement>}
        className={pillClassName}
        {...rest}
      >
        {body}
      </button>
    );
  }
  return (
    <span
      ref={pillRef as Ref<HTMLSpanElement>}
      className={pillClassName}
      {...rest}
    >
      {body}
    </span>
  );
}

type WindowContextChipProps = {
  chatWindow: NonNullable<ChatContext["window"]>;
  chatWindowScreenshot?: ChatContext["windowScreenshot"];
  /**
   * When true, the chip is showing eagerly-attached metadata while the
   * screenshot capture is still in flight. Renders a subtle pulse so the
   * user knows we're working on it.
   */
  capturePending?: boolean;
  setChatContext: SetChatContext;
  className?: string;
  toggleClassName?: string;
  textClassName?: string;
  textFormatter?: (chatWindow: NonNullable<ChatContext["window"]>) => string;
};

export function WindowContextChip({
  chatWindow,
  chatWindowScreenshot,
  capturePending = false,
  setChatContext,
  className,
  toggleClassName,
  textClassName,
  textFormatter,
}: WindowContextChipProps) {
  const t = useT();
  const baseLabel = textFormatter
    ? textFormatter(chatWindow)
    : `${chatWindow.app}${chatWindow.title ? ` - ${chatWindow.title}` : ""}`;
  const displayLabel = truncateChipLabel(baseLabel);
  const hasScreenshot = Boolean(chatWindowScreenshot?.dataUrl);
  const { triggerRef, open } = useHoverPreview<HTMLDivElement>();
  const [previewOpen, setPreviewOpen] = useState(false);

  return (
    <div
      ref={triggerRef}
      className={cn("composer-chip-shell", hasScreenshot && className)}
      data-included="true"
      data-capture-pending={capturePending ? "true" : undefined}
      data-with-thumb={hasScreenshot ? "true" : undefined}
    >
      {hasScreenshot ? (
        <button
          type="button"
          className={cn(
            toggleClassName,
            "chat-composer-context-window-card composer-chip-previewable",
          )}
          title={
            capturePending
              ? t("app.chat.contextChips.windowCapturing", { label: baseLabel })
              : t("app.chat.contextChips.windowClickToEnlarge", {
                  label: baseLabel,
                })
          }
          onClick={() => {
            setPreviewOpen(true);
          }}
        >
          <img
            src={chatWindowScreenshot!.dataUrl}
            alt=""
            className="chat-composer-context-window-thumb"
          />
          <span className={cn(textClassName)}>{displayLabel}</span>
        </button>
      ) : (
        <ContextPill
          as="button"
          kind="window"
          label={displayLabel}
          title={
            capturePending
              ? t("app.chat.contextChips.windowCapturing", { label: baseLabel })
              : baseLabel
          }
        />
      )}
      <ChipRemoveButton
        label={t("app.chat.contextChips.removeWindow", { app: chatWindow.app })}
        onRemove={() => clearComposerWindowContext(setChatContext)}
      />
      {hasScreenshot && (
        <ChipPreviewPortal
          triggerRef={triggerRef}
          open={open && !previewOpen}
          className="composer-context-preview composer-context-preview--portal"
        >
          <img
            src={chatWindowScreenshot!.dataUrl}
            alt={t("app.chat.contextChips.windowPreviewAlt")}
            className="composer-context-preview-img"
          />
        </ChipPreviewPortal>
      )}
      {hasScreenshot && (
        <ImageLightbox
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          src={chatWindowScreenshot!.dataUrl}
          alt={t("app.chat.contextChips.windowScreenshotAlt", {
            label: baseLabel,
          })}
        />
      )}
    </div>
  );
}

type SelectedTextChipProps = {
  selectedText: string;
  setSelectedText: Dispatch<SetStateAction<string | null>>;
  setChatContext: SetChatContext;
  className?: string;
};

export function SelectedTextChip({
  selectedText,
  setSelectedText,
  setChatContext,
  className,
}: SelectedTextChipProps) {
  const t = useT();
  const displayText = truncateChipLabel(selectedText, 36);
  return (
    <span className="composer-chip-shell">
      <ContextPill
        as="button"
        kind="selected-text"
        label={<>&quot;{displayText}&quot;</>}
        title={`"${selectedText}"`}
        className={className}
      />
      <ChipRemoveButton
        label={t("app.chat.contextChips.removeSelectedText")}
        onRemove={() =>
          clearComposerSelectedTextContext(setSelectedText, setChatContext)
        }
      />
    </span>
  );
}

type AppSelectionChipProps = {
  appSelection: NonNullable<ChatContext["appSelection"]>;
  /** Position in the composer's selection list; drives per-chip removal. */
  index?: number;
  setChatContext: SetChatContext;
  className?: string;
};

export function AppSelectionChip({
  appSelection,
  index = 0,
  setChatContext,
  className,
}: AppSelectionChipProps) {
  const t = useT();
  const label =
    appSelection.label || t("app.chat.contextChips.selectedAreaFallback");
  const source = appSelection.source;
  const sourceSuffix = source?.filePath
    ? `\n${source.componentName ? `${source.componentName} — ` : ""}${source.filePath}${
        typeof source.lineNumber === "number" ? `:${source.lineNumber}` : ""
      }`
    : "";
  return (
    <span className="composer-chip-shell">
      <ContextPill
        as="button"
        kind="app-selection"
        label={truncateChipLabel(label)}
        title={`${label}${sourceSuffix}`}
        className={className}
      />
      <ChipRemoveButton
        label={t("app.chat.contextChips.removeSelectedArea", { label })}
        onRemove={() => removeComposerAppSelectionContext(index, setChatContext)}
      />
    </span>
  );
}

type AppSelectionChipsProps = {
  appSelections: NonNullable<ChatContext["appSelection"]>[];
  setChatContext: SetChatContext;
  className?: string;
};

/**
 * Selected-area chips accumulate like attachments — one chip per
 * selection, each with its own remove ×.
 */
export function AppSelectionChips({
  appSelections,
  setChatContext,
  className,
}: AppSelectionChipsProps) {
  return (
    <>
      {appSelections.map((appSelection, index) => (
        <AppSelectionChip
          key={index}
          appSelection={appSelection}
          index={index}
          setChatContext={setChatContext}
          className={className}
        />
      ))}
    </>
  );
}

type ActivityContextChipProps = {
  activity: NonNullable<ChatContext["activity"]>;
  setChatContext: SetChatContext;
  className?: string;
};

export function ActivityContextChip({
  activity,
  setChatContext,
  className,
}: ActivityContextChipProps) {
  const t = useT();
  const label = activity.label || t("app.chat.contextChips.activityFallback");
  const displayLabel = truncateChipLabel(label, 28);
  return (
    <span className="composer-chip-shell">
      <ContextPill
        as="button"
        kind="activity"
        label={displayLabel}
        title={label}
        className={className}
      />
      <ChipRemoveButton
        label={t("app.chat.contextChips.removeActivity")}
        onRemove={() => clearComposerActivityContext(setChatContext)}
      />
    </span>
  );
}

type PendingCaptureChipProps = {
  className?: string;
  innerClassName?: string;
};

export function PendingCaptureChip({
  className,
  innerClassName,
}: PendingCaptureChipProps) {
  return (
    <div className={cn(className)}>
      <div className={cn(innerClassName)} />
    </div>
  );
}

type ImageAttachmentChipProps = {
  thumbnailUrl: string;
  fullImageUrl: string;
  alt: string;
  title: string;
  chipClassName?: string;
  imageClassName?: string;
  removeLabel?: string;
  onRemove?: () => void;
};

/**
 * Canonical compact image-attachment chip used before and after send.
 * Owns its full class list — callers may add hooks via `chipClassName`
 * but the card/thumb geometry lives here so the composer and the sent
 * message row render identical thumbnails. Composer callers add removal;
 * sent-message callers keep the same visual body and lightbox behavior
 * without exposing a remove affordance.
 */
export function ImageAttachmentChip({
  thumbnailUrl,
  fullImageUrl,
  alt,
  title,
  chipClassName,
  imageClassName,
  removeLabel,
  onRemove,
}: ImageAttachmentChipProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  return (
    <span className="attachment-tile-shell composer-chip-shell">
      <button
        type="button"
        className={cn("attachment-tile attachment-tile--image", chipClassName)}
        title={title}
        onClick={() => setPreviewOpen(true)}
      >
        <img
          src={thumbnailUrl}
          className={cn("attachment-tile__image", imageClassName)}
          alt={alt}
        />
      </button>
      {onRemove && removeLabel ? (
        <ChipRemoveButton label={removeLabel} onRemove={onRemove} />
      ) : null}
      <ImageLightbox
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        src={fullImageUrl}
        alt={alt}
      />
    </span>
  );
}

export function ScreenshotContextChip({
  screenshot,
  index,
  setChatContext,
}: {
  screenshot: NonNullable<ChatContext["regionScreenshots"]>[number];
  index: number;
  setChatContext: SetChatContext;
}) {
  const t = useT();
  return (
    <ImageAttachmentChip
      thumbnailUrl={screenshot.previewUrl ?? screenshot.dataUrl}
      fullImageUrl={screenshot.dataUrl}
      alt={t("app.chat.contextChips.screenshotAlt", { index: index + 1 })}
      title={t("app.chat.contextChips.screenshotEnlargeTitle")}
      removeLabel={t("app.chat.contextChips.removeScreenshot", {
        index: index + 1,
      })}
      onRemove={() => removeComposerScreenshotContext(index, setChatContext)}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  File attachment chips                                             */
/* ------------------------------------------------------------------ */

function resolveFileCategory(
  mimeType: string,
  name: string,
): "pdf" | "document" | "spreadsheet" | "code" | "archive" | "audio" | "video" | "file" {
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  if (
    mimeType.includes("zip") || mimeType.includes("tar") ||
    mimeType.includes("gzip") || mimeType.includes("rar") || mimeType.includes("7z")
  ) return "archive";
  if (
    mimeType.includes("spreadsheet") || mimeType.includes("csv") ||
    /\.(?:xlsx?|csv|tsv|ods)$/i.test(name)
  ) return "spreadsheet";
  if (
    mimeType.includes("document") || mimeType.includes("msword") ||
    mimeType.includes("text/plain") || mimeType.includes("text/markdown") ||
    mimeType.includes("rtf") || /\.(?:docx?|txt|md|rtf|odt|pages)$/i.test(name)
  ) return "document";
  if (
    mimeType.includes("javascript") || mimeType.includes("typescript") ||
    mimeType.includes("json") || mimeType.includes("xml") ||
    mimeType.includes("html") || mimeType.includes("css") ||
    mimeType.includes("python") || mimeType.includes("java") ||
    mimeType.includes("x-sh") ||
    /\.(?:js|jsx|ts|tsx|py|rb|rs|go|c|cpp|h|swift|kt|java|json|yaml|yml|toml|sh|bash|zsh|css|scss|html|xml|sql|lua|r|php)$/i.test(name)
  ) return "code";
  return "file";
}

function FileIcon({ category }: { category: ReturnType<typeof resolveFileCategory> }) {
  const shared = { size: 16, strokeWidth: 1.75 };
  switch (category) {
    case "pdf":
      return <FileText {...shared} />;
    case "document":
      return <FileText {...shared} />;
    case "spreadsheet":
      return <FileSpreadsheet {...shared} />;
    case "code":
      return <Code {...shared} />;
    case "archive":
      return <Archive {...shared} />;
    case "audio":
      return <Music {...shared} />;
    case "video":
      return <Video {...shared} />;
    default:
      return <File {...shared} />;
  }
}

const FILE_CATEGORY_LABEL_KEYS: Record<
  ReturnType<typeof resolveFileCategory>,
  string
> = {
  pdf: "app.chat.fileCategory.pdf",
  document: "app.chat.fileCategory.document",
  spreadsheet: "app.chat.fileCategory.spreadsheet",
  code: "app.chat.fileCategory.code",
  archive: "app.chat.fileCategory.archive",
  audio: "app.chat.fileCategory.audio",
  video: "app.chat.fileCategory.video",
  file: "app.chat.fileCategory.file",
};

/**
 * Catalog key for the human type label of a file attachment whose real
 * filename is missing (older persisted payloads). Never a generic
 * "Attachment" string that a narrow chip would clip into nonsense.
 * Callers resolve it with `t()` at render time.
 */
export function fileAttachmentTypeLabelKey(mimeType?: string): string {
  return FILE_CATEGORY_LABEL_KEYS[resolveFileCategory(mimeType ?? "", "")];
}

type FileAttachmentChipProps = {
  name: string;
  size?: number;
  mimeType?: string;
  /**
   * On-disk source path. When present the chip opens the original in its
   * default app — the same preview convention as the composer.
   */
  path?: string;
  chipClassName?: string;
  removeLabel?: string;
  onRemove?: () => void;
};

/**
 * Canonical document/file chip used before and after send: file-type
 * glyph, real filename (extension-preserving truncation), optional size.
 * Composer callers add removal; sent-message callers keep the same
 * visual body without a remove affordance.
 */
export function FileAttachmentChip({
  name,
  mimeType,
  path,
  chipClassName,
  removeLabel,
  onRemove,
}: FileAttachmentChipProps) {
  const t = useT();
  const category = resolveFileCategory(mimeType ?? "", name);
  // Disk-backed attachments open in their default app for preview;
  // synthetic files (no on-disk path) have no preview target.
  const canOpen = Boolean(path);
  const displayName = fileDisplayName(name);
  return (
    <span className="attachment-tile-shell composer-chip-shell">
      <button
        type="button"
        className={cn("attachment-tile attachment-tile--file", chipClassName)}
        data-openable={canOpen ? "true" : undefined}
        title={
          canOpen ? t("app.chat.contextChips.fileClickToOpen", { name }) : name
        }
        onClick={
          canOpen
            ? () => {
                void getElectronApi()?.system?.openPath?.(path!);
              }
            : undefined
        }
      >
        <span className="attachment-tile__file-icon">
          <FileIcon category={category} />
        </span>
        <span className="attachment-tile__name">{displayName}</span>
      </button>
      {onRemove && removeLabel ? (
        <ChipRemoveButton label={removeLabel} onRemove={onRemove} />
      ) : null}
    </span>
  );
}

export function FileContextChip({
  file,
  index,
  setChatContext,
  chipClassName,
}: {
  file: ChatContextFile;
  index: number;
  setChatContext: SetChatContext;
  chipClassName?: string;
}) {
  const t = useT();
  return (
    <FileAttachmentChip
      name={file.name}
      size={file.size}
      mimeType={file.mimeType}
      path={file.path}
      chipClassName={chipClassName}
      removeLabel={t("app.chat.contextChips.removeFile", { name: file.name })}
      onRemove={() => removeComposerFileContext(index, setChatContext)}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Pasted-text chips                                                 */
/* ------------------------------------------------------------------ */

export function PastedTextChip({
  text,
  index,
  setChatContext,
}: {
  text: string;
  index: number;
  setChatContext: SetChatContext;
  className?: string;
}) {
  const t = useT();
  const stats = describePastedText(toPastedTextDescriptor(text));
  const preview =
    text.length > PASTED_TEXT_PREVIEW_MAX_CHARS
      ? `${text.slice(0, PASTED_TEXT_PREVIEW_MAX_CHARS)}…`
      : text;
  return (
    <PastedTextTile
      text={text}
      preview={preview}
      label={t("app.chat.contextChips.pastedTextTitle", { stats })}
      remove={
        <ChipRemoveButton
          label={t("app.chat.contextChips.removePastedText")}
          onRemove={() => removeComposerPastedTextContext(index, setChatContext)}
        />
      }
    />
  );
}
