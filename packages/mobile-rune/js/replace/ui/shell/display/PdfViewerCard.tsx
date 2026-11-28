// The phone's stand-in for desktop-rune/ui/shell/display/PdfViewerCard.tsx. A computer shows a PDF
// with pdf.js in a web view; the phone's engine has no web view, so the app draws each page itself
// (ios/StellaRune/PdfPages.swift, PdfRenderer on Android) as the viewer nears it, and the pages
// are pictures in a column that scrolls like the rest of the app, as the RN app's viewer shows a
// PDF in the system's own document view. Same header, page count and Save / Copy as a computer.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFilePreviewActions } from "@/features/chat/hooks/use-file-preview-actions";
import { useRegisterViewerNav } from "@/shell/workspace-stage/viewer-item-context";
import { useDisplayFileBytes } from "@/shared/hooks/use-display-file-data";
import { useT } from "@/shared/i18n";
import { fontSize, look, useTokens } from "../../../../../../desktop-rune/ui/theme";
import { FilePreviewCardShell } from "../../../../../../desktop-rune/ui/chat/FilePreviewCardShell";
import { PreviewBoundary, PreviewProblem } from "../../../../../../desktop-rune/ui/shell/display/preview-states";
import { phoneRequest } from "../../../../../ui/native/app";
import type { ScrollPos } from "../../../../../../desktop-rune/host/rune-jsx/props";

type PdfViewerCardProps = {
  filePath: string;
  title?: string;
  pageRail?: boolean;
  onPageChange?: (page: number, total: number) => void;
};

const PAGE_GAP = 12;
const PAD = 12;
/** Pages drawn ahead of and behind the ones on screen. */
const AHEAD = 2;
const RENDERING_AT_ONCE = 2;
/** Pictures kept per document (a long one scrolled end to end lets go of the far pages). */
const KEPT_PAGES = 24;

const folder = () => `${__native.env.caches}/pdf-pages`;

const hashOf = (value: string): string => {
  const digest = __native.digest("SHA-256", new TextEncoder().encode(value));
  let hex = "";
  for (let i = 0; i < 10; i++) hex += digest[i]!.toString(16).padStart(2, "0");
  return hex;
};

export function PdfViewerCard(props: PdfViewerCardProps) {
  const [attempt, setAttempt] = useState(0);
  return (
    <PreviewBoundary key={props.filePath}>
      <PdfViewerCardContent key={attempt} {...props} onRetry={() => setAttempt((value) => value + 1)} />
    </PreviewBoundary>
  );
}

function PdfViewerCardContent({ filePath, title, onPageChange, onRetry }: PdfViewerCardProps & { onRetry: () => void }) {
  const t = useT();
  const tokens = useTokens();
  const { bytes, error: fileError, missing: fileMissing } = useDisplayFileBytes(filePath, t("app.chat.pdfViewer.hostRequired"));
  const [doc, setDoc] = useState<{ path: string; pages: [number, number][] } | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const [scroll, setScroll] = useState({ y: 0, h: 0 });
  const [pictures, setPictures] = useState<ReadonlyMap<number, string>>(new Map());
  const scrollId = useMemo(() => `pdf-pages-${hashOf(filePath)}`, [filePath]);

  // The document on disk, where the app's renderer reads it.
  useEffect(() => {
    if (!bytes) return;
    let live = true;
    const key = hashOf(`${filePath}\u0000${bytes.byteLength}`);
    const path = `${folder()}/${key}.pdf`;
    if (!__native.writeFile(path, bytes)) {
      setOpenError(t("app.chat.pdfViewer.loadFailed"));
      return;
    }
    phoneRequest<{ pages: [number, number][] }>("pdf.open", { path }).then(
      ({ pages }) => live && setDoc({ path, pages: pages.length > 0 ? pages : [[612, 792]] }),
      () => live && setOpenError(t("app.chat.pdfViewer.loadFailed")),
    );
    return () => {
      live = false;
    };
  }, [bytes, filePath, t]);

  const pageWidth = Math.max(0, width - PAD * 2);
  const layout = useMemo(() => {
    const tops: number[] = [];
    const heights: number[] = [];
    let y = PAD;
    for (const [w, h] of doc?.pages ?? []) {
      tops.push(y);
      const height = Math.round(pageWidth * (h / Math.max(1, w)));
      heights.push(height);
      y += height + PAGE_GAP;
    }
    return { tops, heights };
  }, [doc, pageWidth]);

  const total = doc?.pages.length ?? 0;
  // The page at the middle of the screen (1-based), and the run of pages near the screen.
  const { current, first, last } = useMemo(() => {
    if (total === 0) return { current: 1, first: 0, last: -1 };
    const mid = scroll.y + scroll.h / 2;
    let at = 0;
    while (at + 1 < total && layout.tops[at + 1]! <= mid) at += 1;
    let top = 0;
    while (top + 1 < total && layout.tops[top + 1]! <= scroll.y) top += 1;
    let bottom = top;
    while (bottom + 1 < total && layout.tops[bottom + 1]! < scroll.y + scroll.h) bottom += 1;
    return { current: at + 1, first: Math.max(0, top - AHEAD), last: Math.min(total - 1, bottom + AHEAD) };
  }, [layout, scroll, total]);

  useEffect(() => {
    if (total > 0) onPageChange?.(current, total);
  }, [current, total, onPageChange]);

  // Draws the pages near the screen, nearest first, a couple at a time. `drawn` is what is drawn
  // (read at once, as a page done from disk finishes in the same turn); `pictures` shows it.
  const rendering = useRef(new Set<number>());
  const drawn = useRef(new Map<number, string>());
  const failed = useRef(new Set<number>());
  const pixelWidth = Math.round(pageWidth * __native.env.scale);
  useEffect(() => {
    drawn.current = new Map();
    setPictures(new Map());
  }, [pixelWidth]);
  // What the pump works from: the latest pages wanted, read when a render finishes.
  const want = useRef({ doc, pages: [] as number[], pixelWidth, current });
  const mounted = useRef(true);
  useEffect(() => () => void (mounted.current = false), []);
  const pump = useRef(() => {});
  pump.current = () => {
    const { doc, pages, pixelWidth, current } = want.current;
    if (!doc || pixelWidth <= 0) return;
    const show = (page: number, path: string) => {
      const next = drawn.current;
      next.set(page, path);
      // Lets go of the pages farthest from here.
      while (next.size > KEPT_PAGES) {
        let far = -1;
        for (const p of next.keys()) if (far < 0 || Math.abs(p - current) > Math.abs(far - current)) far = p;
        next.delete(far);
      }
      setPictures(new Map(next));
    };
    for (const page of pages) {
      if (rendering.current.size >= RENDERING_AT_ONCE) return;
      if (drawn.current.has(page) || rendering.current.has(page) || failed.current.has(page)) continue;
      const out = `${folder()}/${hashOf(doc.path)}-${page}-${pixelWidth}.jpg`;
      if (__native.readFile(out)) {
        show(page, out);
        continue;
      }
      rendering.current.add(page);
      const settle = (path: string | null) => {
        rendering.current.delete(page);
        if (!mounted.current) return;
        // Drawn at the width still shown: keep it, whether or not it's still near the screen.
        if (path && want.current.pixelWidth === pixelWidth && want.current.doc === doc) show(page, path);
        else if (!path) failed.current.add(page);
        pump.current();
      };
      phoneRequest<{ path: string }>("pdf.render", { path: doc.path, page, width: pixelWidth, out }).then(
        ({ path }) => settle(path),
        () => settle(null),
      );
    }
  };
  useEffect(() => {
    const pages: number[] = [];
    for (let i = first; i <= last; i++) pages.push(i + 1);
    pages.sort((a, b) => Math.abs(a - current) - Math.abs(b - current));
    want.current = { doc, pages, pixelWidth, current };
    pump.current();
  }, [doc, first, last, current, pixelWidth]);

  const scrollToPage = useCallback(
    (page: number) => {
      const top = layout.tops[page - 1];
      if (top === undefined) return;
      void stella.engine.scroll.to(scrollId, Math.max(0, top - PAD), { animate: true }).catch(() => {});
    },
    [layout, scrollId],
  );

  useRegisterViewerNav(
    total > 1
      ? {
          canPrevious: current > 1,
          canNext: current < total,
          previous: () => scrollToPage(Math.max(1, current - 1)),
          next: () => scrollToPage(Math.min(total, current + 1)),
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
  const error = fileError ?? openError;

  return (
    <FilePreviewCardShell
      grow
      headerAlign="center"
      eyebrow="PDF"
      title={headerTitle}
      titlePath={filePath}
      meta={
        total > 0 ? (
          <text shrink={false} {...look(fontSize.sm, 400)} color={tokens.c.mutedForeground} features="'tnum' 1">
            {`${current} / ${total}`}
          </text>
        ) : null
      }
      actionStatus={actionStatus}
      hideActions={Boolean(fileError) && fileMissing}
      onSave={handleSave}
      onCopy={handleCopy}
    >
      {error ? (
        <PreviewProblem error={error} missing={Boolean(fileError) && fileMissing} {...(fileMissing ? {} : { onRetry })} />
      ) : (
        <col
          id={scrollId}
          grow={1}
          minH={0}
          w="full"
          scrollY
          fill={tokens.c.background}
          onSize={(r) => setWidth(Math.floor(r.w))}
          onScroll={(p: ScrollPos) => setScroll((s) => (Math.abs(s.y - p.y) < 24 && s.h === p.viewport[1] ? s : { y: p.y, h: p.viewport[1] }))}
        >
          {doc && pageWidth > 0 ? (
            <col w="full" px={PAD} py={PAD} gap={PAGE_GAP} shrink={false}>
              {doc.pages.map((_, index) => {
                const picture = pictures.get(index + 1);
                return (
                  <box key={index} w={pageWidth} h={layout.heights[index]} shrink={false} fill="#ffffff" radius={4} clip={4} border={tokens.c.border}>
                    {picture ? <image src={picture} w="full" h="full" fit="stretch" /> : null}
                  </box>
                );
              })}
            </col>
          ) : (
            <text py={28} px={16} textAlign="center" {...look(fontSize.base, 400)} color={tokens.c.mutedForeground}>
              {t("app.chat.pdfViewer.loading")}
            </text>
          )}
        </col>
      )}
    </FilePreviewCardShell>
  );
}
