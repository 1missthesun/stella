import {
  Suspense,
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
import {
  useRegisterViewerNav,
  useViewerWindow,
} from "@/shell/workspace-stage/viewer-item-context";
import { useDisplayFileBytes } from "@/shared/hooks/use-display-file-data";
import { useT } from "@/shared/i18n";
import { PreviewBoundary, PreviewProblem } from "@/shell/display/preview-states";
import { useRetainedSurfaceActive } from "@/ui/retained-surface";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import "./pdf-viewer-card.css";

const PDF_WORKER_URL = `${import.meta.env.BASE_URL}vendor/pdfjs/pdf.worker.min.mjs`;

// @reloadable pointing pdf.js at its worker is the same every time
if (pdfjs.GlobalWorkerOptions.workerSrc !== PDF_WORKER_URL) {
  pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
}

type PdfViewerCardProps = {
  filePath: string;
  title?: string;
  pageRail?: boolean;
  onPageChange?: (page: number, total: number) => void;
};

const PAGE_RAIL_MAX_PAGES = 80;
const PAGE_RAIL_THUMB_WIDTH = 76;
const PAGE_RAIL_WIDTH = 112;
const PAGE_RAIL_MIN_VIEWER_WIDTH = 620;
const EAGER_MAIN_PAGES = 2;
const DEFAULT_PAGE_ASPECT = 792 / 612;

type LoadStatus = "loading" | "ready" | "error";

const RESIZE_DEBOUNCE_MS = 100;

/**
 * A page drawn in a viewer window keeps its pixels when the viewer docks again,
 * but shows blank once that window closes: drawing them back onto the same
 * canvas shows them again without rendering the page anew.
 */
function useRepaintAfterMove(ref: React.RefObject<HTMLElement | null>) {
  const viewerWindow = useViewerWindow();
  const shownIn = useRef(viewerWindow);
  useEffect(() => {
    if (shownIn.current === viewerWindow) return;
    shownIn.current = viewerWindow;
    const frame = viewerWindow.requestAnimationFrame(() => {
      for (const canvas of ref.current?.querySelectorAll("canvas") ?? []) {
        if (canvas.width === 0 || canvas.height === 0) continue;
        const context = canvas.getContext("2d");
        if (!context) continue;
        context.save();
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.globalCompositeOperation = "copy";
        context.drawImage(canvas, 0, 0);
        context.restore();
      }
    });
    return () => viewerWindow.cancelAnimationFrame(frame);
  }, [ref, viewerWindow]);
}

function useNearScrollRoot(
  ref: React.RefObject<HTMLElement | null>,
  rootRef: React.RefObject<HTMLElement | null>,
  enabled: boolean,
  rootMargin: string,
): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!enabled || visible) return;
    const target = ref.current;
    if (!target || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      { root: rootRef.current, rootMargin },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [enabled, rootMargin, rootRef, ref, visible]);
  return visible;
}

function LazyPdfPage({
  pageNumber,
  width,
  aspect,
  scrollRef,
  eager,
  onFirstRender,
}: {
  pageNumber: number;
  width: number | null;
  aspect: number;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  eager: boolean;
  onFirstRender?: (aspectRatio: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const near = useNearScrollRoot(wrapRef, scrollRef, !eager, "800px 0px");
  const shouldRender = eager || near;
  const estHeight = Math.round((width ?? 612) * aspect);
  return (
    <div
      ref={wrapRef}
      className="pdf-viewer-card__page-wrap"
      data-pdf-page={pageNumber}
      style={shouldRender ? undefined : { minHeight: estHeight }}
    >
      {shouldRender ? (
        // react-pdf's pages suspend while they load: each holds its own place,
        // or the card's boundary would hide the whole card and drop its scroll.
        <Suspense fallback={<div style={{ height: estHeight }} />}>
          <Page
            pageNumber={pageNumber}
            width={width ?? undefined}
            renderAnnotationLayer={false}
            renderTextLayer={false}
            className="pdf-viewer-card__page"
            onRenderSuccess={
              onFirstRender
                ? () => {
                    const canvas = wrapRef.current?.querySelector("canvas");
                    if (canvas && canvas.width > 0 && canvas.height > 0) {
                      onFirstRender(canvas.height / canvas.width);
                    } else {
                      onFirstRender(DEFAULT_PAGE_ASPECT);
                    }
                  }
                : undefined
            }
          />
        </Suspense>
      ) : null}
    </div>
  );
}

const RailThumbPlaceholder = () => (
  <span
    className="pdf-viewer-card__rail-thumb"
    style={{
      display: "block",
      width: PAGE_RAIL_THUMB_WIDTH,
      height: Math.round(PAGE_RAIL_THUMB_WIDTH * DEFAULT_PAGE_ASPECT),
    }}
  />
);

function LazyRailThumb({
  pageNumber,
  current,
  railRef,
  enabled,
  onSelect,
}: {
  pageNumber: number;
  current: boolean;
  railRef: React.RefObject<HTMLElement | null>;
  enabled: boolean;
  onSelect: () => void;
}) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const near = useNearScrollRoot(btnRef, railRef, enabled, "300px 0px");
  return (
    <button
      ref={btnRef}
      type="button"
      className="pdf-viewer-card__rail-page"
      data-current={current ? "true" : undefined}
      aria-label={`Page ${pageNumber}`}
      aria-current={current ? "page" : undefined}
      onClick={onSelect}
    >
      {enabled && near ? (
        <Suspense fallback={<RailThumbPlaceholder />}>
          <Page
            pageNumber={pageNumber}
            width={PAGE_RAIL_THUMB_WIDTH}
            renderAnnotationLayer={false}
            renderTextLayer={false}
            loading={null}
            className="pdf-viewer-card__rail-thumb"
          />
        </Suspense>
      ) : (
        <RailThumbPlaceholder />
      )}
      <span className="pdf-viewer-card__rail-number">{pageNumber}</span>
    </button>
  );
}

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
  const active = useRetainedSurfaceActive();
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
  const [firstPageReady, setFirstPageReady] = useState(false);
  const [pageAspect, setPageAspect] = useState(DEFAULT_PAGE_ASPECT);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLElement | null>(null);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const resizeTimerRef = useRef<number | null>(null);
  const lastWidthRef = useRef<number | null>(null);
  const jumpUntilRef = useRef(0);
  useRepaintAfterMove(layoutRef);

  const status: LoadStatus = fileError ? "error" : loadStatus;
  const errorMessage = fileError ?? loadErrorMessage;
  const showRail = pageRail && numPages > 1;
  const hasBytes = Boolean(bytes);

  useLayoutEffect(() => {
    if (!active) return;
    const layout = layoutRef.current;
    const container = containerRef.current;
    if (!layout || typeof ResizeObserver === "undefined") return;

    const measure = () => {
      const scroll = containerRef.current;
      let next = scroll ? Math.floor(scroll.getBoundingClientRect().width) : 0;
      if (next <= 0) {
        const layoutWidth = Math.floor(layout.getBoundingClientRect().width);
        if (layoutWidth > 0) {
          const viewer = layout.closest<HTMLElement>(".file-viewer");
          const viewerWidth = viewer
            ? viewer.getBoundingClientRect().width
            : layoutWidth;
          const railSpace =
            showRail && viewerWidth > PAGE_RAIL_MIN_VIEWER_WIDTH
              ? PAGE_RAIL_WIDTH
              : 0;
          next = Math.max(120, layoutWidth - railSpace);
        }
      }
      if (next > 0 && next !== lastWidthRef.current) {
        lastWidthRef.current = next;
        setPageWidth(next);
      }
    };

    measure();

    const observer = new ResizeObserver(() => {
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
      }
      resizeTimerRef.current = window.setTimeout(() => {
        resizeTimerRef.current = null;
        measure();
      }, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(container ?? layout);

    return () => {
      observer.disconnect();
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = null;
      }
    };
  }, [active, numPages, showRail, hasBytes]);

  useEffect(() => {
    if (numPages <= 1 || firstPageReady) return;
    const fallback = window.setTimeout(() => setFirstPageReady(true), 250);
    return () => window.clearTimeout(fallback);
  }, [firstPageReady, numPages]);

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

  const handleFirstPageRender = useCallback((aspect: number) => {
    setPageAspect(aspect);
    setFirstPageReady(true);
  }, []);

  const documentFile = useMemo(
    () => (bytes ? { data: bytes } : null),
    [bytes],
  );

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
      if (performance.now() < jumpUntilRef.current) return;
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
    jumpUntilRef.current = performance.now() + 700;
    setCurrentPage(pageNumber);
    container.scrollTo({ top, behavior: "smooth" });
  }, []);

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

  const loadingPlaceholder = (
    <div className="file-preview-card__placeholder pdf-viewer-card__placeholder">
      {t("app.chat.pdfViewer.loading")}
    </div>
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
            <Suspense fallback={loadingPlaceholder}>
              <Document
                file={documentFile}
                loading={null}
                noData={null}
                onLoadSuccess={handleLoadSuccess}
                onLoadError={handleLoadError}
                className="pdf-viewer-card__document-root"
              >
                {showRail ? (
                  <nav
                    ref={railRef}
                    className="pdf-viewer-card__rail"
                    aria-label="Pages"
                  >
                    {Array.from(
                      { length: Math.min(numPages, PAGE_RAIL_MAX_PAGES) },
                      (_, index) => {
                        const pageNumber = index + 1;
                        return (
                          <LazyRailThumb
                            key={pageNumber}
                            pageNumber={pageNumber}
                            current={pageNumber === currentPage}
                            railRef={railRef}
                            enabled={firstPageReady}
                            onSelect={() => scrollToPage(pageNumber)}
                          />
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
                    <LazyPdfPage
                      key={pageNumber}
                      pageNumber={pageNumber}
                      width={pageWidth}
                      aspect={pageAspect}
                      scrollRef={containerRef}
                      eager={pageNumber <= EAGER_MAIN_PAGES}
                      onFirstRender={
                        pageNumber === 1 ? handleFirstPageRender : undefined
                      }
                    />
                  );
                })}
                </div>
                </div>
              </Document>
            </Suspense>
          ) : (
            loadingPlaceholder
          )}
        </div>
      )}
    </FilePreviewCardShell>
  );
}
