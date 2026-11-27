import { createContext, useContext, useId, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { fileDisplayName } from "@stella/contracts/file-display-name";
import type { ShowCaptureAttachment } from "@stella/contracts";
import type { ChatContext, ChatContextFile } from "@/shared/types/electron";
import { translateNow, useT } from "@/shared/i18n";
import { showInViewer } from "@/features/workspace-display/open-payload";
import { EMAIL_CHIP_REMOVED_EVENT, EMAIL_SELECTION_SURFACE, VIEWER_SELECTION_SURFACE } from "@/features/workspace-display/file-viewer-store";
import { getElectronApi } from "@/platform/electron/electron";
import { viewAtom } from "@/platform/view-state/view-state";
import { describePastedText, PASTED_TEXT_PREVIEW_MAX_CHARS, toPastedTextDescriptor } from "@/features/chat/lib/paste-context";
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
import { copyImage, fileMenu } from "@/platform/context-menu";
import { contextMenu } from "./context-menu";
import { Icon, Icons, ImageLightbox, type IconData } from "../kit";
import { derive, fontSize, mixOklch, radius, useTokens } from "../theme";
import { PastedTextTile, TILE_SIZE, tileLook } from "./AttachmentTiles";
import { ChipPreview, useHoverPreview } from "./HoverPreview";
import { pillColors, previewCard } from "./surfaces";

type SetChatContext = Dispatch<SetStateAction<ChatContext | null>>;

const PILL_TEXT = { size: fontSize.sm, weight: 500, lineHeight: Math.round(fontSize.sm * 1.3 * 100) / 100 };

/** `.composer-chip-shell` + `.composer-chip-remove`: a chip with the round × that shows on hover. */
export function ChipShell({ removeLabel, onRemove, children, ...rest }: { removeLabel?: string; onRemove?: () => void; children: ReactNode } & Record<string, unknown>) {
  return (
    <box hoverGroup shrink={false} maxW="full" minW={0} {...rest}>
      {children}
      {onRemove && removeLabel ? <ChipRemoveButton label={removeLabel} onRemove={onRemove} /> : null}
    </box>
  );
}

function ChipRemoveButton({ label, onRemove }: { label: string; onRemove: () => void }) {
  const t = useTokens();
  const hover = derive(t, "chip-remove-hover", (k) => mixOklch(k.c.foreground, 8, k.c.background));
  return (
    <box
      absolute={{ top: -4, right: -4 }}
      raise
      w={16}
      h={16}
      center
      radius={radius.full}
      border={t.c.borderStrong}
      fill={t.c.background}
      hoverFill={hover}
      hoverOpacity={[0, 1]}
      role="button"
      label={label}
      title={label}
      focusable
      motion={{ dur: 0.12, bounce: 0 }}
      onPress={onRemove}
    >
      <Icon icon={Icons.stella.X} size={10} strokeWidth={2.25} color={t.c.textWeak} />
    </box>
  );
}

export type ContextPillKind = "window" | "app-selection" | "activity" | "pasted-text" | "selected-text" | "viewing" | "email" | "canvas";

const CONTEXT_PILL_ICONS: Record<ContextPillKind, IconData> = {
  window: Icons.stella.AppWindowMac,
  "app-selection": Icons.stella.Crop,
  activity: Icons.stella.ClipboardList,
  "pasted-text": Icons.stella.ClipboardPaste,
  "selected-text": Icons.stella.TextQuote,
  viewing: Icons.stella.Eye,
  email: Icons.stella.Mail,
  canvas: Icons.stella.AppWindowMac,
};

type ContextPillProps = {
  id?: string;
  kind: ContextPillKind;
  label: string;
  title?: string;
  maxW?: number;
  hovered?: boolean;
  onPress?: () => void;
  children?: ReactNode;
};

/** `.context-pill--compact`: the narrower pill cap of the compact composer. */
export const CompactContextPills = createContext(false);
const COMPACT_PILL_MAX_W = 200;

/** desktop-ui's `ContextPill`: a primary-tinted 12px pill with its kind's icon; brighter while its shell is hovered. */
export function ContextPill({ id, kind, label, title, maxW, hovered, onPress, children }: ContextPillProps) {
  const t = useTokens();
  const c = pillColors(t);
  const compact = useContext(CompactContextPills);
  const limit = maxW ?? (compact && kind !== "window" ? COMPACT_PILL_MAX_W : kind === "selected-text" ? 520 : 340);
  return (
    <row
      id={id}
      role={onPress ? "button" : undefined}
      label={title ?? label}
      title={title}
      focusable={Boolean(onPress)}
      onPress={onPress}
      shrink={false}
      align="center"
      gap={5}
      minW={0}
      maxW={limit}
      pt={4 + 1}
      pb={4 + 1}
      pl={8 + 1}
      pr={10 + 1}
      radius={radius.md}
      fill={hovered ? c.hoverFill : c.fill}
      border={hovered ? c.hoverBorder : c.border}
      hoverFill={c.hoverFill}
      hoverBorder={c.hoverBorder}
      motion={{ dur: 0.12, bounce: 0 }}
    >
      <Icon icon={CONTEXT_PILL_ICONS[kind]} size={13} strokeWidth={1.75} color={c.icon} />
      <text {...PILL_TEXT} color={c.text} truncate nowrap minW={0} shrink>
        {label}
      </text>
      {children}
    </row>
  );
}

type WindowContextChipProps = {
  chatWindow: NonNullable<ChatContext["window"]>;
  chatWindowScreenshot?: ChatContext["windowScreenshot"];
  capturePending?: boolean;
  setChatContext: SetChatContext;
  textFormatter?: (chatWindow: NonNullable<ChatContext["window"]>) => string;
};

export function WindowContextChip({ chatWindow, chatWindowScreenshot, capturePending = false, setChatContext, textFormatter }: WindowContextChipProps) {
  const t = useT();
  const tokens = useTokens();
  const id = useId();
  const baseLabel = textFormatter ? textFormatter(chatWindow) : `${chatWindow.app}${chatWindow.title ? ` - ${chatWindow.title}` : ""}`;
  const displayLabel = truncateChipLabel(baseLabel);
  const shot = chatWindowScreenshot?.dataUrl;
  const preview = useHoverPreview();
  const [previewOpen, setPreviewOpen] = useState(false);
  const c = pillColors(tokens);
  const pulse = capturePending ? { kind: "sequence" as const, period: 1.4, frames: [{ at: 0, opacity: 1 }, { at: 0.5, opacity: 0.7 }, { at: 1, opacity: 1 }] } : undefined;
  return (
    <ChipShell id={`window-chip:${id}`} removeLabel={t("app.chat.contextChips.removeWindow", { app: chatWindow.app })} onRemove={() => clearComposerWindowContext(setChatContext)} onHover={preview.onHover}>
      {shot ? (
        <col
          role="button"
          focusable
          title={capturePending ? t("app.chat.contextChips.windowCapturing", { label: baseLabel }) : t("app.chat.contextChips.windowClickToEnlarge", { label: baseLabel })}
          align="center"
          gap={4}
          pt={4 + 1}
          px={6 + 1}
          pb={6 + 1}
          radius={10}
          fill={c.fill}
          border={c.border}
          maxW={320}
          loop={pulse}
          onPress={() => setPreviewOpen(true)}
        >
          <image src={shot} w={56} h={42} fit="cover" radius={6} />
          <text size={fontSize.sm} lineHeight={Math.round(fontSize.sm * 1.2 * 100) / 100} color={tokens.c.textWeak} nowrap truncate maxW="full">
            {displayLabel}
          </text>
        </col>
      ) : (
        <ContextPill kind="window" label={displayLabel} title={capturePending ? t("app.chat.contextChips.windowCapturing", { label: baseLabel }) : baseLabel} onPress={() => undefined} />
      )}
      {shot ? (
        <ChipPreview anchor={`window-chip:${id}`} open={preview.open && !previewOpen} side="top" pad={6 + 1} radius={14} {...previewCard(tokens)}>
          <image src={shot} maxW={432} maxH={280} fit="contain" radius={8} label={t("app.chat.contextChips.windowPreviewAlt")} />
        </ChipPreview>
      ) : null}
      {shot ? <ImageLightbox id={`window-shot:${id}`} open={previewOpen} onOpenChange={setPreviewOpen} src={shot} alt={t("app.chat.contextChips.windowScreenshotAlt", { label: baseLabel })} /> : null}
    </ChipShell>
  );
}

export function SelectedTextChip({ selectedText, setSelectedText, setChatContext }: { selectedText: string; setSelectedText: Dispatch<SetStateAction<string | null>>; setChatContext: SetChatContext }) {
  const t = useT();
  return (
    <ChipShell removeLabel={t("app.chat.contextChips.removeSelectedText")} onRemove={() => clearComposerSelectedTextContext(setSelectedText, setChatContext)}>
      <ContextPill kind="selected-text" label={`"${truncateChipLabel(selectedText, 36)}"`} title={`"${selectedText}"`} onPress={() => undefined} />
    </ChipShell>
  );
}

export function AppSelectionChip({ appSelection, index = 0, setChatContext }: { appSelection: NonNullable<ChatContext["appSelection"]>; index?: number; setChatContext: SetChatContext }) {
  const t = useT();
  const label = appSelection.label || t("app.chat.contextChips.selectedAreaFallback");
  const removeLabel = t("app.chat.contextChips.removeSelectedArea", { label });
  if (appSelection.surface === EMAIL_SELECTION_SURFACE) {
    return (
      <ChipShell
        removeLabel={removeLabel}
        onRemove={() => {
          window.dispatchEvent(new CustomEvent(EMAIL_CHIP_REMOVED_EVENT, { detail: { key: appSelection.anchor?.path } }));
          removeComposerAppSelectionContext(index, setChatContext);
        }}
      >
        <ContextPill kind="email" label={truncateChipLabel(label, 44)} title={label} />
      </ChipShell>
    );
  }
  if (appSelection.surface === VIEWER_SELECTION_SURFACE) {
    const viewedId = appSelection.anchor?.path;
    return (
      <ChipShell removeLabel={removeLabel} onRemove={() => removeComposerAppSelectionContext(index, setChatContext)}>
        <ContextPill kind="viewing" label={truncateChipLabel(label, 30)} title={label} onPress={() => viewedId && showInViewer(viewedId)} />
      </ChipShell>
    );
  }
  const source = appSelection.source;
  const sourceSuffix = source?.filePath ? `\n${source.componentName ? `${source.componentName} — ` : ""}${source.filePath}${typeof source.lineNumber === "number" ? `:${source.lineNumber}` : ""}` : "";
  return (
    <ChipShell removeLabel={removeLabel} onRemove={() => removeComposerAppSelectionContext(index, setChatContext)}>
      <ContextPill kind="app-selection" label={truncateChipLabel(label)} title={`${label}${sourceSuffix}`} onPress={() => undefined} />
    </ChipShell>
  );
}

export function AppSelectionChips({ appSelections, setChatContext }: { appSelections: NonNullable<ChatContext["appSelection"]>[]; setChatContext: SetChatContext }) {
  return (
    <>
      {appSelections.map((appSelection, index) => (
        <AppSelectionChip key={index} appSelection={appSelection} index={index} setChatContext={setChatContext} />
      ))}
    </>
  );
}

export function ActivityContextChip({ activity, setChatContext }: { activity: NonNullable<ChatContext["activity"]>; setChatContext: SetChatContext }) {
  const t = useT();
  const label = activity.label || t("app.chat.contextChips.activityFallback");
  return (
    <ChipShell removeLabel={t("app.chat.contextChips.removeActivity")} onRemove={() => clearComposerActivityContext(setChatContext)}>
      <ContextPill kind="activity" label={truncateChipLabel(label, 28)} title={label} onPress={() => undefined} />
    </ChipShell>
  );
}

/** `.composer-context-pending-inner`: a shimmering placeholder while a capture is on its way. */
export function PendingCaptureChip({ w = 56, h = 42 }: { w?: number; h?: number }) {
  const t = useTokens();
  const c = derive(t, "pending-capture", (k) => ({ lo: mixOklch(k.c.foreground, 8, "transparent"), hi: mixOklch(k.c.foreground, 16, "transparent") }));
  return (
    <box pad={2 + 1} radius={radius.full} border={t.c.borderStrong} fill={t.c.muted} inert>
      <box w={w} h={h} radius={6} fill={c.lo} loop={{ kind: "opacity", period: 1.2, low: 0.6, high: 1 }} />
    </box>
  );
}

/** `.attachment-tile--pending`: the same shimmer filling a 64px attachment tile. */
export function PendingCaptureTile() {
  const t = useTokens();
  const lo = derive(t, "pending-capture-tile", (k) => mixOklch(k.c.foreground, 8, "transparent"));
  return (
    <box w={TILE_SIZE} h={TILE_SIZE} radius={12} clip={12} border={t.c.border} fill={t.c.muted} inert>
      <box w="full" h="full" fill={lo} loop={{ kind: "opacity", period: 1.2, low: 0.6, high: 1 }} />
    </box>
  );
}

type ImageAttachmentChipProps = { thumbnailUrl: string; fullImageUrl: string; alt: string; title: string; removeLabel?: string; onRemove?: () => void };

export function ImageAttachmentChip({ thumbnailUrl, fullImageUrl, alt, title, removeLabel, onRemove }: ImageAttachmentChipProps) {
  const t = useTokens();
  const id = useId();
  const [previewOpen, setPreviewOpen] = useState(false);
  const look = tileLook(t);
  return (
    <ChipShell
      removeLabel={removeLabel}
      onRemove={onRemove}
      onContextMenu={contextMenu(
        () => [
          [{ label: translateNow("contextMenu.open"), run: () => setPreviewOpen(true) }],
          [{ label: translateNow("contextMenu.copyImage"), run: () => copyImage({ src: fullImageUrl }) }],
          ...(onRemove ? [[{ label: translateNow("contextMenu.remove"), run: onRemove }]] : []),
        ],
        { claims: ["image"] },
      )}
    >
      <box role="button" focusable label={alt} title={title} h={TILE_SIZE} minW={40} maxW={180} pad={1} radius={12} clip={12} border={look.border} fill={look.fill} hoverBorder={look.hoverBorder} hoverFill={look.hoverFill} center onPress={() => setPreviewOpen(true)}>
        <image src={thumbnailUrl} h={TILE_SIZE - 2} maxW={180 - 2} fit="contain" radius={11} />
      </box>
      <ImageLightbox id={`image-chip:${id}`} open={previewOpen} onOpenChange={setPreviewOpen} src={fullImageUrl} alt={alt} />
    </ChipShell>
  );
}

export function ScreenshotContextChip({ screenshot, index, setChatContext }: { screenshot: NonNullable<ChatContext["regionScreenshots"]>[number]; index: number; setChatContext: SetChatContext }) {
  const t = useT();
  return (
    <ImageAttachmentChip
      thumbnailUrl={screenshot.previewUrl ?? screenshot.dataUrl}
      fullImageUrl={screenshot.dataUrl}
      alt={t("app.chat.contextChips.screenshotAlt", { index: index + 1 })}
      title={t("app.chat.contextChips.screenshotEnlargeTitle")}
      removeLabel={t("app.chat.contextChips.removeScreenshot", { index: index + 1 })}
      onRemove={() => removeComposerScreenshotContext(index, setChatContext)}
    />
  );
}

type FileCategory = "pdf" | "document" | "spreadsheet" | "code" | "archive" | "audio" | "video" | "file";

function resolveFileCategory(mimeType: string, name: string): FileCategory {
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.includes("zip") || mimeType.includes("tar") || mimeType.includes("gzip") || mimeType.includes("rar") || mimeType.includes("7z")) return "archive";
  if (mimeType.includes("spreadsheet") || mimeType.includes("csv") || /\.(?:xlsx?|csv|tsv|ods)$/i.test(name)) return "spreadsheet";
  if (mimeType.includes("document") || mimeType.includes("msword") || mimeType.includes("text/plain") || mimeType.includes("text/markdown") || mimeType.includes("rtf") || /\.(?:docx?|txt|md|rtf|odt|pages)$/i.test(name)) return "document";
  if (
    mimeType.includes("javascript") || mimeType.includes("typescript") || mimeType.includes("json") || mimeType.includes("xml") || mimeType.includes("html") || mimeType.includes("css") || mimeType.includes("python") || mimeType.includes("java") || mimeType.includes("x-sh") ||
    /\.(?:js|jsx|ts|tsx|py|rb|rs|go|c|cpp|h|swift|kt|java|json|yaml|yml|toml|sh|bash|zsh|css|scss|html|xml|sql|lua|r|php)$/i.test(name)
  )
    return "code";
  return "file";
}

const FILE_ICONS: Record<FileCategory, IconData> = {
  pdf: Icons.stella.FileText,
  document: Icons.stella.FileText,
  spreadsheet: Icons.stella.FileSpreadsheet,
  code: Icons.stella.Code,
  archive: Icons.stella.Archive,
  audio: Icons.stella.Music,
  video: Icons.stella.Video,
  file: Icons.stella.File,
};

const FILE_CATEGORY_LABEL_KEYS: Record<FileCategory, string> = {
  pdf: "app.chat.fileCategory.pdf",
  document: "app.chat.fileCategory.document",
  spreadsheet: "app.chat.fileCategory.spreadsheet",
  code: "app.chat.fileCategory.code",
  archive: "app.chat.fileCategory.archive",
  audio: "app.chat.fileCategory.audio",
  video: "app.chat.fileCategory.video",
  file: "app.chat.fileCategory.file",
};

export function fileAttachmentTypeLabelKey(mimeType?: string): string {
  return FILE_CATEGORY_LABEL_KEYS[resolveFileCategory(mimeType ?? "", "")];
}

type FileAttachmentChipProps = { name: string; size?: number; mimeType?: string; path?: string; removeLabel?: string; onRemove?: () => void };

export function FileAttachmentChip({ name, mimeType, path, removeLabel, onRemove }: FileAttachmentChipProps) {
  const t = useT();
  const tokens = useTokens();
  const look = tileLook(tokens);
  const category = resolveFileCategory(mimeType ?? "", name);
  const open = path ? () => void getElectronApi()?.system?.openPath?.(path) : undefined;
  return (
    <ChipShell
      removeLabel={removeLabel}
      onRemove={onRemove}
      onContextMenu={contextMenu(async () => [
        ...(path ? await fileMenu(path, { open: () => void getElectronApi()?.system?.openPath?.(path), addToChat: null })() : []),
        ...(onRemove ? [[{ label: translateNow("contextMenu.remove"), run: onRemove }]] : []),
      ])}
    >
      <col
        role="button"
        focusable
        label={name}
        title={path ? t("app.chat.contextChips.fileClickToOpen", { name }) : name}
        w={TILE_SIZE}
        h={TILE_SIZE}
        center
        gap={4}
        radius={12}
        clip={12}
        border={look.border}
        fill={look.fill}
        hoverBorder={look.hoverBorder}
        hoverFill={look.hoverFill}
        cursor={path ? "pointer" : "default"}
        onPress={open}
      >
        <Icon icon={FILE_ICONS[category]} size={16} strokeWidth={1.75} color={tokens.c.textWeak} />
        <text size={fontSize.xs} weight={500} lineHeight={Math.round(fontSize.xs * 1.2 * 100) / 100} color={tokens.c.textStrong} px={6} nowrap truncate maxW="full">
          {fileDisplayName(name)}
        </text>
      </col>
    </ChipShell>
  );
}

export function FileContextChip({ file, index, setChatContext }: { file: ChatContextFile; index: number; setChatContext: SetChatContext }) {
  const t = useT();
  return (
    <FileAttachmentChip
      name={file.name}
      size={file.size}
      mimeType={file.mimeType}
      path={file.path}
      removeLabel={t("app.chat.contextChips.removeFile", { name: file.name })}
      onRemove={() => removeComposerFileContext(index, setChatContext)}
    />
  );
}

export function PastedTextChip({ text, index, setChatContext }: { text: string; index: number; setChatContext: SetChatContext }) {
  const t = useT();
  const stats = describePastedText(toPastedTextDescriptor(text));
  const preview = text.length > PASTED_TEXT_PREVIEW_MAX_CHARS ? `${text.slice(0, PASTED_TEXT_PREVIEW_MAX_CHARS)}…` : text;
  return (
    <PastedTextTile
      text={text}
      preview={preview}
      label={t("app.chat.contextChips.pastedTextTitle", { stats })}
      removeLabel={t("app.chat.contextChips.removePastedText")}
      onRemove={() => removeComposerPastedTextContext(index, setChatContext)}
    />
  );
}

const openShowCapture = viewAtom("showStella.openCapture", "");

const captureClock = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

export function ShowCaptureChip({ capture, setChatContext }: { capture: ShowCaptureAttachment; setChatContext: SetChatContext }) {
  const t = useT();
  const tokens = useTokens();
  const look = tileLook(tokens);
  const openId = openShowCapture.use();
  const title = t("app.chat.contextChips.showCapture.title", { duration: captureClock(capture.durationMs) });
  const remove = () => {
    if (openShowCapture.get() === capture.id) openShowCapture.set("");
    setChatContext((prev) => (prev ? { ...prev, showCaptures: (prev.showCaptures ?? []).filter((entry) => entry.id !== capture.id) } : prev));
  };
  const setSaveVideo = (save: boolean) =>
    setChatContext((prev) => (prev ? { ...prev, showCaptures: (prev.showCaptures ?? []).map((entry) => (entry.id === capture.id ? { ...entry, saveVideoToDrive: save } : entry)) } : prev));
  const sheet = capture.status === "ready" ? capture.contactSheet : undefined;
  const detail = capture.status === "preparing" ? t("app.chat.contextChips.showCapture.preparing") : capture.status === "failed" ? t("app.chat.contextChips.showCapture.failed") : (capture.said ?? "");
  const small = { size: fontSize.sm, lineHeight: Math.round(fontSize.sm * 1.3 * 100) / 100 };
  const sheetFill = derive(tokens, "show-capture-sheet", (k) => mixOklch(k.c.foreground, 6, k.c.muted));
  const saving = capture.saveVideoToDrive === true;
  return (
    <ChipShell removeLabel={t("app.chat.contextChips.showCapture.remove")} onRemove={remove}>
      <row w={268} h={TILE_SIZE} gap={10} pt={5 + 1} pb={5 + 1} pl={5 + 1} pr={10 + 1} radius={12} clip={12} border={look.border} fill={look.fill} title={capture.status === "failed" ? capture.error : undefined}>
        {sheet ? (
          <box w={84} h="full" radius={8} clip={8} fill={sheetFill} role="button" focusable title={t("app.chat.contextChips.screenshotEnlargeTitle")} onPress={() => openShowCapture.set(capture.id)}>
            <image src={sheet.previewUrl} w="full" h="full" fit="cover" />
          </box>
        ) : (
          <box w={84} h="full" radius={8} fill={sheetFill} center>
            <Icon icon={Icons.stella.Record} size={18} strokeWidth={1.75} color={tokens.c.textWeak} />
          </box>
        )}
        <col justify="center" gap={2} minW={0} grow={1} shrink>
          <row align="center" gap={5}>
            <Icon icon={Icons.stella.Record} size={12} strokeWidth={1.75} color={tokens.c.destructive} />
            <text {...small} weight={600} color={tokens.c.textStrong} nowrap truncate>
              {title}
            </text>
          </row>
          {detail ? (
            <text {...small} color={tokens.c.textWeak} nowrap truncate>
              {detail}
            </text>
          ) : null}
          {capture.status === "ready" && capture.video ? (
            <row align="center" gap={5} role="checkbox" checked={saving} focusable onPress={() => setSaveVideo(!saving)}>
              <box w={13} h={13} radius={3} border={saving ? tokens.c.primary : tokens.c.borderStrong} fill={saving ? tokens.c.primary : tokens.c.background} center>
                {saving ? <Icon icon={Icons.stella.Check} size={10} strokeWidth={3} color={tokens.c.primaryForeground} /> : null}
              </box>
              <text size={11.5} lineHeight={15} color={tokens.c.textWeak}>
                {t("app.chat.contextChips.showCapture.saveVideo")}
              </text>
            </row>
          ) : null}
        </col>
      </row>
      {sheet ? <ImageLightbox id={`show-capture:${capture.id}`} open={openId === capture.id} onOpenChange={(open) => openShowCapture.set(open ? capture.id : "")} src={sheet.previewUrl} alt={t("app.chat.contextChips.showCapture.alt")} /> : null}
    </ChipShell>
  );
}
