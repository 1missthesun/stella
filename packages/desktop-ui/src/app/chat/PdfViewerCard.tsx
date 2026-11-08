import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { useFilePreviewActions } from "@/features/chat/hooks/use-file-preview-actions";
import { FilePreviewCardShell } from "./FilePreviewCardShell";
import { useRegisterViewerNav } from "@/shell/workspace-stage/viewer-item-context";
import { useDisplayFileBytes } from "@/shared/hooks/use-display-file-data";
import { useT } from "@/shared/i18n";
import { PreviewBoundary, PreviewProblem } from "@/shell/display/preview-states";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import "./pdf-viewer-card.css";

const PDF_WORKER_URL = `${import.meta.env.BASE_URL}vendor/pdfjs/pdf.worker.min.mjs`;

if (pdfjs.GlobalWorkerOptions.workerSrc !== PDF_WORKER_URL) {
  pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
}

type PdfViewerCardProps = {
  filePath: string;
  title?: string;
  /** Show a rail of page thumbnails beside the pages. */
  pageRail?: boolean;
  onPageChange?: (page: number, total: number) => void;
};

const PAGE_RAIL_MAX_PAGES = 80;
const PAGE_RAIL_THUMB_WIDTH = 76;

type LoadStatus = "loading" | "ready" | "error";

const RESIZE_DEBOUNCE_MS = 100;

export function PdfViewerCard({
  filePath,
  title,
  pageRail,
  onPageChange,
}: PdfViewerCardProps) {
  const [attempt, setAttempt] = useState(0);
  return (
    <PreviewBoundary key={filePath}>
      <PdfViewerCardContent
        key={attempt}
        filePath={filePath}
        title={title}
        {...(pageRail ? { pageRail } : {})}
        {...(onPageChange ? { onPageChange } : {})}
        onRetry={() => setAttempt((value) => value + 1)}
      />
    </PreviewBoundary>
  );
}

function PdfViewerCardContent({
  filePath,
  title,
  pageRail = false,
  onPageChange,
  onRetry,
}: PdfViewerCardProps & { onRetry: () => void }) {
  const t = useT();
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);
  const {
    bytes,
    error: fileError,
    missing: fileMissing,
  } = useDisplayFileBytes(
    filePath,
    t("app.chat.pdfViewer.hostRequired"),
  );
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageWidth, setPageWidth] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const resizeTimerRef = useRef<number | null>(null);
  const lastWidthRef = useRef<number | null>(null);
  // While a page jump animates, scroll position lags behind the target.
  const jumpUntilRef = useRef(0);

  const status: LoadStatus = fileError ? "error" : loadStatus;
  const errorMessage = fileError ?? loadErrorMessage;

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;

    const applyWidth = () => {
      const next = Math.floor(container.getBoundingClientRect().width);
      if (next > 0 && next !== lastWidthRef.current) {
        lastWidthRef.current = next;
        setPageWidth(next);
      }
    };

    applyWidth();

    const observer = new ResizeObserver(() => {
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
      }
      resizeTimerRef.current = window.setTimeout(() => {
        resizeTimerRef.current = null;
        applyWidth();
      }, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = null;
      }
    };
    // The page pane mounts inside <Document> once it loads; re-attach then.
  }, [numPages]);

  const handleLoadSuccess = useCallback(
    ({ numPages }: { numPages: number }) => {
      setNumPages(Math.max(numPages, 1));
      setLoadStatus("ready");
    },
    [],
  );

  const handleLoadError = useCallback(
    (error: Error) => {
      setLoadStatus("error");
      setLoadErrorMessage(error.message || t("app.chat.pdfViewer.loadFailed"));
    },
    [t],
  );

  const documentFile = useMemo(() => (bytes ? { data: bytes } : null), [bytes]);

  // The current page is the last one whose top has passed the upper third
  // of the pane. (Pages are usually taller than the pane, so visibility
  // ratios can't tell which one you're reading.)
  useEffect(() => {
    const layout = layoutRef.current;
    if (!layout || numPages <= 0) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const container = containerRef.current;
      if (!container) return;
      const line =
        container.getBoundingClientRect().top + container.clientHeight / 3;
      let page = 1;
      for (const el of container.querySelectorAll<HTMLElement>(
        "[data-pdf-page]",
      )) {
        if (el.getBoundingClientRect().top > line) break;
        page = Number(el.dataset.pdfPage) || page;
      }
      setCurrentPage(page);
    };
    const onScroll = () => {
      if (Date.now() < jumpUntilRef.current) return;
      if (!frame) frame = requestAnimationFrame(update);
    };
    // Scroll doesn't bubble; capture on the stable wrapper, since react-pdf
    // can remount the scrolling pane.
    layout.addEventListener("scroll", onScroll, { passive: true, capture: true });
    update();
    return () => {
      layout.removeEventListener("scroll", onScroll, { capture: true });
      if (frame) cancelAnimationFrame(frame);
    };
  }, [numPages]);

  useEffect(() => {
    if (numPages > 0) onPageChange?.(currentPage, numPages);
  }, [currentPage, numPages, onPageChange]);

  const scrollToPage = useCallback((pageNumber: number) => {
    const container = containerRef.current;
    const page = container?.querySelector<HTMLElement>(
      `[data-pdf-page="${pageNumber}"]`,
    );
    if (!container || !page) return;
    // Scroll only the pages pane; scrollIntoView would also move whatever
    // scrolls around the card (the chat behind a floating viewer).
    const top =
      page.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop;
    jumpUntilRef.current = Date.now() + 700;
    setCurrentPage(pageNumber);
    container.scrollTo({ top, behavior: "smooth" });
  }, []);

  const showRail = pageRail && numPages > 1;

  // In the viewer, ← → and the edge arrows turn pages.
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

  const headerTitle =
    title?.replace(/\.pdf$/i, "") ??
    filePath
      .split("/")
      .pop()
      ?.replace(/\.pdf$/i, "") ??
    "PDF";
  const { actionStatus, handleSave, handleCopy } = useFilePreviewActions({
    sourcePath: filePath,
    suggestedName: filePath.split(/[\\/]/).pop() ?? title ?? "document.pdf",
  });

  return (
    <FilePreviewCardShell
      className="pdf-viewer-card"
      headerClassName="pdf-viewer-card__header"
      eyebrow="PDF"
      title={headerTitle}
      titlePath={filePath}
      meta={
        status === "ready" && numPages > 0 ? (
          <span className="pdf-viewer-card__page-counter">
            {currentPage} / {numPages}
          </span>
        ) : null
      }
      actionStatus={actionStatus}
      hideActions={Boolean(fileError) && fileMissing}
      onSave={handleSave}
      onCopy={handleCopy}
    >
      {status === "error" ? (
        <PreviewProblem
          error={errorMessage ?? t("app.chat.pdfViewer.loadFailed")}
          missing={Boolean(fileError) && fileMissing}
          {...(fileMissing ? {} : { onRetry })}
        />
      ) : (
        <div
          ref={layoutRef}
          className="pdf-viewer-card__layout"
          data-page-rail={showRail ? "true" : undefined}
        >
          {documentFile ? (
            <Document
              file={documentFile}
              loading={null}
              noData={null}
              onLoadSuccess={handleLoadSuccess}
              onLoadError={handleLoadError}
              className="pdf-viewer-card__document-root"
            >
              {showRail ? (
                <nav className="pdf-viewer-card__rail" aria-label="Pages">
                  {Array.from(
                    { length: Math.min(numPages, PAGE_RAIL_MAX_PAGES) },
                    (_, index) => {
                      const pageNumber = index + 1;
                      return (
                        <button
                          key={pageNumber}
                          type="button"
                          className="pdf-viewer-card__rail-page"
                          data-current={
                            pageNumber === currentPage ? "true" : undefined
                          }
                          aria-label={`Page ${pageNumber}`}
                          aria-current={
                            pageNumber === currentPage ? "page" : undefined
                          }
                          onClick={() => scrollToPage(pageNumber)}
                        >
                          <Page
                            pageNumber={pageNumber}
                            width={PAGE_RAIL_THUMB_WIDTH}
                            renderAnnotationLayer={false}
                            renderTextLayer={false}
                            loading={null}
                            className="pdf-viewer-card__rail-thumb"
                          />
                          <span className="pdf-viewer-card__rail-number">
                            {pageNumber}
                          </span>
                        </button>
                      );
                    },
                  )}
                </nav>
              ) : null}
              <div ref={containerRef} className="pdf-viewer-card__scroll">
              <div className="pdf-viewer-card__document">
              {Array.from({ length: numPages }, (_, index) => {
                const pageNumber = index + 1;
                return (
                  <div
                    key={pageNumber}
                    className="pdf-viewer-card__page-wrap"
                    data-pdf-page={pageNumber}
                  >
                    <Page
                      pageNumber={pageNumber}
                      width={pageWidth ?? undefined}
                      renderAnnotationLayer={false}
                      renderTextLayer={false}
                      className="pdf-viewer-card__page"
                    />
                  </div>
                );
              })}
              </div>
              </div>
            </Document>
          ) : (
            <div
              ref={containerRef}
              className="file-preview-card__placeholder pdf-viewer-card__placeholder"
            >
              {t("app.chat.pdfViewer.loading")}
            </div>
          )}
        </div>
      )}
    </FilePreviewCardShell>
  );
}
