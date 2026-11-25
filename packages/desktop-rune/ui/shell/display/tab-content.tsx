import { useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { OfficePreviewRef } from "@stella/contracts/office-preview";
import type { DisplayPayload } from "@stella/contracts/desktop/display-payload";
import { DisplayFileSourceContext } from "@/shared/hooks/display-file-source";
import { useDisplayFileBytes } from "@/shared/hooks/use-display-file-data";
import { useT } from "@/shared/i18n";
import { openExternalUrl } from "@/platform/electron/open-external";
import { useFilePreviewActions } from "@/features/chat/hooks/use-file-preview-actions";
import { DELIMITED_PREVIEW_MAX_BYTES } from "@/shell/display/parse-delimited-rows";
import { DIFF_PREVIEW_MAX_BYTES, MARKDOWN_PREVIEW_MAX_BYTES, type PreviewResult } from "@/shell/display/preview-parser";
import { sourceDiffBatches, useSourceDiffBatches, type SourceDiffBatch } from "@/features/workspace-display/source-diff-batches";
import { isPlainTextPath } from "@/features/workspace-display/path-to-viewer";
import { useRegisterViewerNav, useViewerDetailReporter } from "@/shell/workspace-stage/viewer-item-context";
import { usePreviewParser } from "../../replace/shell/display/use-preview-parser";
import { EmptyState, Icons, type EmptyStateMotif } from "../../kit";
import { CHAT_TEXT } from "../../kit";
import { font, look, mixOklch, derive, useTokens, type Tokens } from "../../theme";
import { Markdown } from "../../chat/Markdown";
import { mounted } from "../../app/mount";

export { MediaTabContent } from "./media-tab/MediaTabContent";

const fileName = (filePath: string): string => filePath.split(/[\\/]/).pop() ?? filePath;

const previewLook = (t: Tokens) =>
  derive(t, "display-file-preview", (t) => ({
    buttonFill: mixOklch(t.c.foreground, 5, "transparent"),
    buttonHover: mixOklch(t.c.foreground, 8, "transparent"),
    buttonBorder: mixOklch(t.c.borderBase, 60, "transparent"),
    markerRule: mixOklch(t.c.borderBase, 55, "transparent"),
    add: mixOklch(t.vars["--diff-add"] ?? t.c.success, 13, "transparent"),
    addText: t.vars["--diff-add"] ?? t.c.success,
    del: mixOklch(t.vars["--diff-delete"] ?? t.c.destructive, 13, "transparent"),
    delText: t.vars["--diff-delete"] ?? t.c.destructive,
    navHover: mixOklch(t.c.foreground, 5, "transparent"),
    navCurrent: mixOklch(t.c.foreground, 8, "transparent"),
  }));

const READABLE_ERROR_MAX = 120;
const isReadableError = (error: string): boolean => error.length <= READABLE_ERROR_MAX && !/(^|\s)(\/|[A-Za-z]:\\)\S/u.test(error) && !/^[\w.-]+:[\w.-]+\b/u.test(error);

/** desktop-ui's `PreviewProblem`: a missing file, or a preview that failed (with a retry). */
export function PreviewProblem({ error, missing = false, onRetry, size = "regular", title }: { error?: string | null; missing?: boolean; onRetry?: () => void; size?: "regular" | "compact"; title?: string }) {
  const t = useT();
  const message = error?.trim() ?? "";
  if (missing) return <EmptyState motif="unavailable" size={size} title={title ?? t("shell.display.preview.unavailableTitle")} body={message || undefined} />;
  const readable = message.length > 0 && message !== t("shell.display.preview.unavailable") && isReadableError(message);
  return (
    <EmptyState
      motif="preview"
      size={size}
      title={title ?? t("shell.display.preview.failedTitle")}
      body={readable ? message : t("shell.display.preview.failedBody")}
      detail={message && !readable ? message : undefined}
      action={onRetry ? { label: t("common.tryAgain"), icon: Icons.stella.RotateCcw, onClick: onRetry } : undefined}
    />
  );
}

export function PreviewEmpty({ title, body, motif = "blank", size = "regular" }: { title: string; body?: string; motif?: EmptyStateMotif; size?: "regular" | "compact" }) {
  return <EmptyState motif={motif} size={size} title={title} body={body} />;
}

function PreviewButton({ id, label, onPress }: { id: string; label: string; onPress: () => void }) {
  const t = useTokens();
  const l = previewLook(t);
  return (
    <box id={id} role="button" label={label} focusable px={9} py={5} radius={8} fill={l.buttonFill} hover={l.buttonHover} border={l.buttonBorder} focusRing={{ width: 2, offset: 0, color: t.c.ring, radius: 8 }} onPress={onPress}>
      <text {...look(12, 400)} color={t.c.textBase}>
        {label}
      </text>
    </box>
  );
}

/** `.display-file-preview__header`: an eyebrow, the title, and Save / Copy. */
function PreviewHeader({ id, eyebrow, title, tooltip, actions, status }: { id: string; eyebrow: string; title: string; tooltip?: string; actions?: { label: string; run: () => void }[]; status?: string | null }) {
  const t = useTokens();
  return (
    <row id={`${id}-header`} shrink={false} align="center" gap={12} minH={46} px={2} pb={10}>
      <col grow={1} minW={0} gap={2}>
        <text size={10} weight={600} tracking={0.8} textCase="upper" color={t.c.textWeak}>
          {eyebrow}
        </text>
        <text {...look(13, 600, { lh: 1.25 })} color={t.c.textStrong} nowrap truncate title={tooltip}>
          {title}
        </text>
      </col>
      {actions?.length ? (
        <row shrink={false} gap={6} align="center" justify="end" wrap>
          {actions.map((action) => (
            <PreviewButton key={action.label} id={`${id}-${action.label.toLowerCase()}`} label={action.label} onPress={action.run} />
          ))}
          {status ? (
            <text {...look(11, 400)} color={t.c.textWeak}>
              {status}
            </text>
          ) : null}
        </row>
      ) : null}
    </row>
  );
}

function Rich({ id, pad = 12, children, fill }: { id: string; pad?: number; children: ReactNode; fill?: string }) {
  return (
    <col id={id} grow={1} minH={0} w="full" pad={pad} clip={0} fill={fill}>
      {children}
    </col>
  );
}

function LimitNotice() {
  const t = useT();
  const tk = useTokens();
  return (
    <text role="status" {...look(11, 400)} color={tk.c.textWeak} pt={8} px={2}>
      {t("shell.display.preview.limited")}
    </text>
  );
}

function Loading({ label }: { label: string }) {
  const tk = useTokens();
  return (
    <col grow={1} center>
      <text {...look(13, 400)} color={tk.c.textWeak}>
        {label}
      </text>
    </col>
  );
}

export const UrlTabContent = ({ url, title }: { url: string; title: string }) => {
  const t = useT();
  const tk = useTokens();
  const [reloadKey, setReloadKey] = useState(0);
  return (
    <Rich id="display-url" pad={0} fill={tk.c.surfaceBase}>
      <col px={12} pt={12}>
        <PreviewHeader
          id="display-url"
          eyebrow={t("shell.display.url.eyebrow")}
          title={title}
          tooltip={url}
          actions={[
            { label: t("shell.display.url.reload"), run: () => setReloadKey((value) => value + 1) },
            { label: t("shell.display.url.openInBrowser"), run: () => openExternalUrl(url) },
          ]}
        />
      </col>
      <webview key={reloadKey} id={`display-url-view-${reloadKey}`} url={url} grow={1} minH={0} w="full" />
    </Rich>
  );
};

const OfficeArtifactPanel = mounted<{ previewRef: OfficePreviewRef }>(import.meta.glob("./office-artifact-panel.tsx", { eager: true }), "OfficeArtifactPanel", () => <PreviewProblem error="Office previews aren't drawn here yet." />);

export const OfficeTabContent = ({ previewRef }: { previewRef: OfficePreviewRef }) => (
  <Rich id="display-office">
    <OfficeArtifactPanel previewRef={previewRef} />
  </Rich>
);

export const OfficeFileTabContent = ({ filePath, title, refreshToken }: { filePath: string; title?: string; refreshToken?: number }) => {
  const t = useT();
  const cloudSource = useContext(DisplayFileSourceContext);
  const [previewRef, setPreviewRef] = useState<OfficePreviewRef | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setPreviewRef(null);
    setError(null);
    if (cloudSource) {
      setError("Office previews for Drive files are not available yet.");
      return;
    }
    const api = window.electronAPI?.officePreview;
    if (typeof api?.start !== "function") {
      setError("Office previews require the Stella desktop app.");
      return;
    }
    void api
      .start(filePath)
      .then((ref) => {
        if (!cancelled) setPreviewRef(title ? { ...ref, title } : ref);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError((caught instanceof Error ? caught.message : String(caught)).replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/u, ""));
      });
    return () => {
      cancelled = true;
    };
  }, [filePath, title, refreshToken, cloudSource, attempt]);

  if (previewRef) return <OfficeTabContent previewRef={previewRef} />;
  return (
    <Rich id="display-office-file">
      {error ? <PreviewProblem error={error} onRetry={cloudSource ? undefined : () => setAttempt((value) => value + 1)} /> : <Loading label={t("shell.display.office.preparing")} />}
    </Rich>
  );
};

const TABLE_ROW = 32;
const TABLE_COLUMN = 160;

export const DelimitedTableTabContent = (props: { filePath: string; title?: string }) => {
  const [attempt, setAttempt] = useState(0);
  return <DelimitedTableView key={attempt} {...props} onRetry={() => setAttempt((value) => value + 1)} />;
};

function DelimitedTableView({ filePath, title, onRetry }: { filePath: string; title?: string; onRetry: () => void }) {
  const t = useT();
  const tk = useTokens();
  const { bytes, error, loading, missing, truncated } = useDisplayFileBytes(filePath, t("shell.display.spreadsheet.desktopRequired"), undefined, undefined, DELIMITED_PREVIEW_MAX_BYTES);
  const delimiter: "," | "\t" = filePath.toLowerCase().endsWith(".tsv") ? "\t" : ",";
  const request = useMemo(() => (bytes ? { kind: "table" as const, bytes, delimiter, truncated } : null), [bytes, delimiter, truncated]);
  const parsed = usePreviewParser(request);
  const rows = parsed?.result?.rows ?? [];
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const header = rows[0] ?? [];
  const body = rows.slice(1);
  const { actionStatus, handleSave, handleCopy } = useFilePreviewActions({ sourcePath: filePath, suggestedName: title ?? fileName(filePath) ?? "data.csv" });
  const cell = (value: string, key: number, strong: boolean) => (
    <box key={key} w={TABLE_COLUMN} h={TABLE_ROW} px={10} align="center" shrink={false} borderSides={[0, 1, 1, 0]} border={tk.c.borderWeak} fill={strong ? tk.c.surfaceBase : undefined}>
      <text {...look(12, strong ? 600 : 400)} color={strong ? tk.c.textStrong : tk.c.textBase} nowrap truncate>
        {value}
      </text>
    </box>
  );
  return (
    <Rich id="display-table">
      <PreviewHeader
        id="display-table"
        eyebrow={t("shell.display.spreadsheet.eyebrow")}
        title={title ?? fileName(filePath) ?? t("shell.display.spreadsheet.eyebrow")}
        tooltip={filePath}
        actions={missing ? undefined : [
          { label: t("shell.display.filePreview.save"), run: handleSave },
          { label: t("shell.display.filePreview.copy"), run: handleCopy },
        ]}
        status={actionStatus}
      />
      {error || parsed?.error ? (
        <PreviewProblem error={error || parsed?.error} missing={missing} onRetry={missing ? undefined : onRetry} />
      ) : loading || (request && !parsed) ? (
        <Loading label={t("common.loading")} />
      ) : rows.length === 0 ? (
        <PreviewEmpty title={t("shell.display.preview.emptyTitle")} />
      ) : (
        <col id="display-table-scroll" shrink minH={0} h={Math.min(480, (body.length + 1) * TABLE_ROW)} scrollX scrollY border={tk.c.borderWeak} radius={8} clip={8}>
          <col w={columnCount * TABLE_COLUMN}>
            <row sticky="top">{Array.from({ length: columnCount }, (_, i) => cell(header[i] || t("shell.display.spreadsheet.column", { index: i + 1 }), i, true))}</row>
            <list id="display-table-rows" estimate={TABLE_ROW} overscan={[8, 8]} growth={false}>
              {body.map((row, r) => (
                <row key={r} id={`display-table-row-${r}`}>
                  {Array.from({ length: columnCount }, (_, i) => cell(row[i] ?? "", i, false))}
                </row>
              ))}
            </list>
          </col>
        </col>
      )}
      {parsed?.result?.limited ? <LimitNotice /> : null}
    </Rich>
  );
}

const PdfViewerCard = mounted<{ filePath: string; title?: string; pageRail?: boolean; onPageChange?: (page: number, total: number) => void }>(import.meta.glob("./PdfViewerCard.tsx", { eager: true }), "PdfViewerCard", ({ filePath }) => <PreviewProblem error={`${fileName(filePath)} can't be shown here yet.`} />);

export const PdfTabContent = ({ filePath, title }: { filePath: string; title?: string }) => {
  const reportDetail = useViewerDetailReporter();
  const onPageChange = useCallback((page: number, total: number) => reportDetail(total > 1 ? `p. ${page}` : null), [reportDetail]);
  return (
    <Rich id="display-pdf">
      <PdfViewerCard filePath={filePath} title={title} pageRail onPageChange={onPageChange} />
    </Rich>
  );
};

const DOCUMENT_TEXT = { ...CHAT_TEXT, lineHeight: 1.7 };

export const MarkdownTabContent = (props: { filePath: string; title?: string }) => {
  const [attempt, setAttempt] = useState(0);
  return <MarkdownView key={attempt} {...props} onRetry={() => setAttempt((value) => value + 1)} />;
};

function MarkdownView({ filePath, title, onRetry }: { filePath: string; title?: string; onRetry: () => void }) {
  const t = useT();
  const tk = useTokens();
  const plainText = isPlainTextPath(filePath);
  const { bytes, error, loading, missing, truncated } = useDisplayFileBytes(filePath, t("shell.display.markdown.desktopRequired"), undefined, undefined, MARKDOWN_PREVIEW_MAX_BYTES);
  const request = useMemo(() => (bytes ? { kind: "markdown" as const, bytes, truncated } : null), [bytes, truncated]);
  const parsed = usePreviewParser(request);
  const markdown = parsed?.result?.text ?? "";
  const { actionStatus, handleSave, handleCopy } = useFilePreviewActions({
    sourcePath: filePath,
    ...(parsed?.result && !parsed.result.limited ? { copyText: markdown } : {}),
    suggestedName: title ?? fileName(filePath) ?? "document.md",
  });
  return (
    <Rich id="display-markdown">
      <col w="full" maxW={1040} selfAlign="center" grow={1} minH={0}>
        <PreviewHeader
          id="display-markdown"
          eyebrow={plainText ? t("shell.display.markdown.textEyebrow") : t("shell.display.markdown.eyebrow")}
          title={title ?? fileName(filePath) ?? t("shell.display.markdown.eyebrow")}
          tooltip={filePath}
          actions={missing ? undefined : [
            { label: t("shell.display.filePreview.save"), run: handleSave },
            { label: t("shell.display.filePreview.copy"), run: handleCopy },
          ]}
          status={actionStatus}
        />
        <col id="display-markdown-viewer" grow={1} minH={0} scrollY pt={18} px={20} pb={24}>
          {error || parsed?.error ? (
            <PreviewProblem error={error || parsed?.error} missing={missing} onRetry={missing ? undefined : onRetry} />
          ) : loading || (request && !parsed) ? (
            <Loading label={t("shell.display.filePreview.loading")} />
          ) : markdown.trim().length === 0 ? (
            <PreviewEmpty title={t("shell.display.preview.emptyTitle")} />
          ) : plainText ? (
            <text size={12} lineHeight={19.2} family={font.mono} color={tk.c.textBase} selectable>
              {markdown}
            </text>
          ) : (
            <col maxW={760}>
              <Markdown text={markdown} cacheKey={`document:${filePath}`} chat={DOCUMENT_TEXT} />
            </col>
          )}
        </col>
        {parsed?.result?.limited ? <LimitNotice /> : null}
      </col>
    </Rich>
  );
}

const DIFF_ROW = 18.6;

function DiffRows({ id, preview }: { id: string; preview: PreviewResult }) {
  const tk = useTokens();
  const l = previewLook(tk);
  return (
    <>
      <col id={`${id}-scroll`} shrink={false} h={Math.min(480, preview.lines.length * DIFF_ROW + 20)} scrollY scrollX pad={10}>
        <list id={`${id}-lines`} estimate={DIFF_ROW} overscan={[24, 24]} growth={false}>
          {preview.lines.map((line, index) =>
            line.kind === "header" ? (
              <row key={index} id={`${id}-line-${index}`} py={8} px={10} borderSides={[0, 0, 1, 0]} border={tk.c.borderBase} fill={tk.c.card}>
                <text size={12} weight={600} family={font.mono} color={tk.c.textStrong} nowrap truncate>
                  {line.text}
                </text>
              </row>
            ) : (
              <row key={index} id={`${id}-line-${index}`} fill={line.kind === "add" ? l.add : line.kind === "delete" ? l.del : undefined}>
                <box w={28} shrink={false} center borderSides={[0, 1, 0, 0]} border={l.markerRule}>
                  <text size={11} lineHeight={17} family={font.mono} color={line.kind === "add" ? l.addText : line.kind === "delete" ? l.delText : tk.c.textWeak}>
                    {line.kind === "add" ? "+" : line.kind === "delete" ? "-" : line.kind === "meta" ? "@" : " "}
                  </text>
                </box>
                <text size={11} lineHeight={17} family={font.mono} color={tk.c.textBase} px={10} nowrap selectable>
                  {line.text || " "}
                </text>
              </row>
            ),
          )}
        </list>
      </col>
      {preview.limited ? <LimitNotice /> : null}
    </>
  );
}

type SourceDiffPayload = Extract<DisplayPayload, { kind: "source-diff" }>;

function ParsedDiff({ id, parsed }: { id: string; parsed: ReturnType<typeof usePreviewParser> }) {
  const t = useT();
  if (parsed?.error) return <PreviewProblem error={parsed.error} size="compact" />;
  if (!parsed?.result) return <Loading label={t("shell.display.filePreview.loading")} />;
  if (!parsed.result.lines.length && !parsed.result.limited) return <PreviewEmpty motif="changes" size="compact" title={t("shell.display.diff.noChangesTitle")} />;
  return <DiffRows id={id} preview={parsed.result} />;
}

function SourceDiffPatchBlock({ patch, id }: { patch: string; id: string }) {
  const request = useMemo(() => ({ kind: "diff" as const, patch: patch.slice(0, DIFF_PREVIEW_MAX_BYTES), filePath: "", truncated: patch.length > DIFF_PREVIEW_MAX_BYTES }), [patch]);
  return <ParsedDiff id={id} parsed={usePreviewParser(request)} />;
}

function SourceDiffFileBytesBlock({ filePath, id }: { filePath: string; id: string }) {
  const t = useT();
  const { bytes, error, missing, truncated } = useDisplayFileBytes(filePath, t("shell.display.diff.desktopRequired"), undefined, undefined, DIFF_PREVIEW_MAX_BYTES);
  const request = useMemo(() => (bytes ? { kind: "diff" as const, bytes, filePath, truncated } : null), [bytes, filePath, truncated]);
  const parsed = usePreviewParser(request);
  if (error) return <PreviewProblem error={error} missing={missing} size="compact" />;
  return <ParsedDiff id={id} parsed={parsed} />;
}

function SourceDiffFileBlock({ payload, id }: { payload: SourceDiffPayload; id: string }) {
  if (payload.patch && payload.patch.trim().length > 0) return <SourceDiffPatchBlock patch={payload.patch} id={id} />;
  return <SourceDiffFileBytesBlock filePath={payload.filePath} id={id} />;
}

const formatRelativeTime = (timestamp: number, now: number): string => {
  const delta = Math.max(0, now - timestamp);
  if (delta < 45_000) return "just now";
  const minutes = Math.round(delta / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
};

const useNowTick = (intervalMs: number): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
};

function SourceDiffBatchFooter({ batches, activeBatchId, now }: { batches: ReadonlyArray<SourceDiffBatch>; activeBatchId: string | null; now: number }) {
  const tk = useTokens();
  const l = previewLook(tk);
  if (batches.length <= 1) return null;
  return (
    <row shrink={false} gap={6} pt={10} wrap>
      {batches.map((batch) => {
        const active = batch.id === activeBatchId;
        const label = batch.label ?? (batch.payloads.length === 1 ? "1 file" : `${batch.payloads.length} files`);
        return (
          <row
            key={batch.id}
            id={`display-diff-batch-${batch.id}`}
            role="button"
            selected={active}
            title={batch.payloads.filter((entry): entry is SourceDiffPayload => entry.kind === "source-diff").map((entry) => entry.filePath).join("\n")}
            gap={6}
            px={9}
            py={4}
            radius={999}
            align="center"
            fill={active ? l.navCurrent : undefined}
            hover={l.navHover}
            border={l.buttonBorder}
            onPress={() => sourceDiffBatches.select(batch.id)}
          >
            <text {...look(11, 500)} color={active ? tk.c.textStrong : tk.c.textBase}>
              {label}
            </text>
            <text {...look(11, 400)} color={tk.c.textWeak}>
              {formatRelativeTime(batch.createdAt, now)}
            </text>
          </row>
        );
      })}
    </row>
  );
}

function SourceDiffBatchFiles({ payloads, wide }: { payloads: SourceDiffPayload[]; wide: boolean }) {
  const tk = useTokens();
  const l = previewLook(tk);
  const [current, setCurrent] = useState<string | null>(payloads[0]?.filePath ?? null);
  const reportDetail = useViewerDetailReporter();
  useEffect(() => {
    reportDetail(current && payloads.length > 1 ? fileName(current) : null);
  }, [current, payloads.length, reportDetail]);
  const currentIndex = Math.max(0, payloads.findIndex((payload) => payload.filePath === current));
  const jumpTo = useCallback((filePath: string) => {
    setCurrent(filePath);
    void stella.engine.scroll.intoView(`display-diff-file-${filePath}`).catch(() => {});
  }, []);
  useRegisterViewerNav(
    payloads.length > 1
      ? {
          canPrevious: currentIndex > 0,
          canNext: currentIndex < payloads.length - 1,
          previous: () => {
            const target = payloads[currentIndex - 1];
            if (target) jumpTo(target.filePath);
          },
          next: () => {
            const target = payloads[currentIndex + 1];
            if (target) jumpTo(target.filePath);
          },
          previousLabel: "Previous file",
          nextLabel: "Next file",
        }
      : null,
  );
  const blocks = (
    <col id="display-diff-files" grow={1} minW={0} minH={0} scrollY gap={10}>
      {payloads.map((payload) => (
        <col key={payload.filePath} id={`display-diff-file-${payload.filePath}`} shrink={false} border={tk.c.borderBase} radius={10} clip={10}>
          <SourceDiffFileBlock payload={payload} id={`display-diff-${payload.filePath}`} />
        </col>
      ))}
    </col>
  );
  if (payloads.length <= 1) return blocks;
  return (
    <row grow={1} minH={0} gap={12}>
      {wide ? (
        <col role="navigation" label="Changed files" w={196} shrink={false} gap={1} minH={0} scrollY>
          <text {...look(11, 400)} color={tk.c.textWeak} pt={4} px={8} pb={8}>
            {payloads.length} files changed
          </text>
          {payloads.map((payload) => (
            <box
              key={payload.filePath}
              id={`display-diff-nav-${payload.filePath}`}
              role="button"
              selected={payload.filePath === current}
              title={payload.filePath}
              py={6}
              px={8}
              radius={6}
              fill={payload.filePath === current ? l.navCurrent : undefined}
              hover={l.navHover}
              onPress={() => jumpTo(payload.filePath)}
            >
              <text size={11} family={font.mono} color={payload.filePath === current ? tk.c.textStrong : tk.c.textBase} nowrap truncate>
                {fileName(payload.filePath)}
              </text>
            </box>
          ))}
        </col>
      ) : null}
      {blocks}
    </row>
  );
}

export const SourceDiffTabContent = () => {
  const t = useT();
  const { batches, activeBatchId } = useSourceDiffBatches();
  const now = useNowTick(30_000);
  const [width, setWidth] = useState(0);
  const activeBatch = useMemo(() => (batches.length === 0 ? null : (batches.find((entry) => entry.id === activeBatchId) ?? batches[0]!)), [batches, activeBatchId]);
  const headerLabel = activeBatch
    ? activeBatch.payloads.length === 1
      ? activeBatch.payloads[0]!.kind === "source-diff"
        ? (fileName((activeBatch.payloads[0] as SourceDiffPayload).filePath) ?? t("shell.display.diff.changes"))
        : t("shell.display.diff.changes")
      : `${activeBatch.payloads.length} files changed`
    : t("shell.display.diff.codeChanges");
  return (
    <Rich id="display-diff">
      <col w="full" maxW={1040} selfAlign="center" grow={1} minH={0} onLayout={(r) => setWidth(r.w)}>
        <PreviewHeader id="display-diff" eyebrow={t("shell.display.diff.changes")} title={headerLabel} tooltip={headerLabel} />
        <col grow={1} minH={0}>
          {!activeBatch ? (
            <PreviewEmpty motif="changes" title={t("shell.display.diff.emptyTitle")} body={t("shell.display.diff.emptyBody")} />
          ) : (
            <SourceDiffBatchFiles key={activeBatch.id} payloads={activeBatch.payloads.filter((payload): payload is SourceDiffPayload => payload.kind === "source-diff")} wide={width > 620} />
          )}
        </col>
        <SourceDiffBatchFooter batches={batches} activeBatchId={activeBatchId} now={now} />
      </col>
    </Rich>
  );
};

const TrashTab = mounted<object>(import.meta.glob("./TrashTabContent.tsx", { eager: true }), "TrashTabContent", () => null);
export const TrashTabContent = () => <TrashTab />;
