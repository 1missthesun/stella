import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useFilePreviewActions } from "@/features/chat/hooks/use-file-preview-actions";
import { useRegisterViewerNav } from "@/shell/workspace-stage/viewer-item-context";
import { useDisplayFileBytes } from "@/shared/hooks/use-display-file-data";
import { useT } from "@/shared/i18n";
import { fontSize, look, useTokens } from "../../theme";
import { FilePreviewCardShell } from "../../chat/FilePreviewCardShell";
import type { WebviewMessage, WebviewRequest } from "../../../host/rune-jsx/props";
import { PreviewBoundary, PreviewProblem } from "./preview-states";
import { PDF_SCHEME, pdfjsAsset, pdfPageHtml, pdfPageTheme, pdfViewerUrl } from "./pdf-page";

type PdfViewerCardProps = {
  filePath: string;
  title?: string;
  pageRail?: boolean;
  onPageChange?: (page: number, total: number) => void;
};

type LoadStatus = "loading" | "ready" | "error";

const PROTOCOLS = [PDF_SCHEME];

export function PdfViewerCard(props: PdfViewerCardProps) {
  const [attempt, setAttempt] = useState(0);
  return (
    <PreviewBoundary key={props.filePath}>
      <PdfViewerCardContent key={attempt} {...props} onRetry={() => setAttempt((value) => value + 1)} />
    </PreviewBoundary>
  );
}

const messageData = (m: WebviewMessage): { type?: unknown; [key: string]: unknown } | null => {
  let data: unknown = m.data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  return data && typeof data === "object" ? (data as { type?: unknown }) : null;
};

function PdfViewerCardContent({ filePath, title, pageRail = false, onPageChange, onRetry }: PdfViewerCardProps & { onRetry: () => void }) {
  const t = useT();
  const tokens = useTokens();
  const viewId = `pdf-viewer-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);
  const { bytes, error: fileError, missing: fileMissing } = useDisplayFileBytes(filePath, t("app.chat.pdfViewer.hostRequired"));
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);

  const status: LoadStatus = fileError ? "error" : loadStatus;
  const errorMessage = fileError ?? loadErrorMessage;

  const themeCss = pdfPageTheme(tokens);
  const page = useRef({ bytes, themeCss, pageRail });
  page.current = { bytes, themeCss, pageRail };

  useEffect(() => {
    void stella.engine.webview.post(viewId, { type: "stella:pdf-theme", css: themeCss }).catch(() => {});
  }, [themeCss, viewId]);

  useEffect(() => {
    if (numPages > 0) onPageChange?.(currentPage, numPages);
  }, [currentPage, numPages, onPageChange]);

  const onRequest = useCallback((r: WebviewRequest) => {
    const respond = (status: number, headers: Record<string, string>, body: string | Uint8Array) => void stella.engine.webview.respond(r.rid, { status, headers, body }).catch(() => {});
    const name = new URL(r.url).pathname.replace(/^\/+/, "");
    if (name === "index.html") return respond(200, { "content-type": "text/html; charset=utf-8" }, pdfPageHtml(page.current.themeCss, page.current.pageRail));
    if (name === "document.pdf") return page.current.bytes ? respond(200, { "content-type": "application/pdf" }, page.current.bytes) : respond(404, {}, "");
    const asset = pdfjsAsset(name);
    if (!asset) return respond(404, {}, "");
    void asset.bytes().then(
      (body) => respond(200, { "content-type": "text/javascript; charset=utf-8" }, body),
      () => respond(404, {}, ""),
    );
  }, []);

  const onMessage = useCallback(
    (m: WebviewMessage) => {
      const data = messageData(m);
      if (data?.type === "stella:pdf-loaded" && typeof data.numPages === "number") {
        setNumPages(Math.max(data.numPages, 1));
        setLoadStatus("ready");
      } else if (data?.type === "stella:pdf-page" && typeof data.page === "number") {
        setCurrentPage(data.page);
      } else if (data?.type === "stella:pdf-error") {
        setLoadStatus("error");
        setLoadErrorMessage((typeof data.message === "string" && data.message) || t("app.chat.pdfViewer.loadFailed"));
      }
    },
    [t],
  );

  const scrollToPage = useCallback(
    (pageNumber: number) => {
      setCurrentPage(pageNumber);
      void stella.engine.webview.post(viewId, { type: "stella:pdf-goto", page: pageNumber }).catch(() => {});
    },
    [viewId],
  );

  useRegisterViewerNav(
    pageRail && numPages > 1
      ? {
          canPrevious: currentPage > 1,
          canNext: currentPage < numPages,
          previous: () => scrollToPage(Math.max(1, currentPage - 1)),
          next: () => scrollToPage(Math.min(numPages, currentPage + 1)),
          previousLabel: "Previous page",
          nextLabel: "Next page",
        }
      : null,
  );

  const headerTitle = title?.replace(/\.pdf$/i, "") ?? filePath.split("/").pop()?.replace(/\.pdf$/i, "") ?? "PDF";
  const { actionStatus, handleSave, handleCopy } = useFilePreviewActions({
    sourcePath: filePath,
    suggestedName: filePath.split(/[\\/]/).pop() ?? title ?? "document.pdf",
  });
  const url = useMemo(() => pdfViewerUrl("index.html"), []);

  return (
    <FilePreviewCardShell
      grow
      headerAlign="center"
      eyebrow="PDF"
      title={headerTitle}
      titlePath={filePath}
      meta={
        status === "ready" && numPages > 0 ? (
          <text shrink={false} {...look(fontSize.sm, 400)} color={tokens.c.mutedForeground} features="'tnum' 1">
            {`${currentPage} / ${numPages}`}
          </text>
        ) : null
      }
      actionStatus={actionStatus}
      hideActions={Boolean(fileError) && fileMissing}
      onSave={handleSave}
      onCopy={handleCopy}
    >
      {status === "error" ? (
        <PreviewProblem error={errorMessage ?? t("app.chat.pdfViewer.loadFailed")} missing={Boolean(fileError) && fileMissing} {...(fileMissing ? {} : { onRetry })} />
      ) : bytes ? (
        <webview id={viewId} grow={1} minH={0} w="full" label={headerTitle} url={url} protocols={PROTOCOLS} fill={tokens.c.background} onRequest={onRequest} onMessage={onMessage} />
      ) : (
        <text py={28} px={16} textAlign="center" {...look(fontSize.base, 400)} color={tokens.c.mutedForeground}>
          {t("app.chat.pdfViewer.loading")}
        </text>
      )}
    </FilePreviewCardShell>
  );
}
