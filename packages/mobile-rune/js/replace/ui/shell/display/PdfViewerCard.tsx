// The phone's stand-in for desktop-rune/ui/shell/display/PdfViewerCard.tsx. A computer shows a PDF
// with pdf.js in a web view; the phone's engine has no web view, so the app draws each page itself
// (ios/StellaRune/PdfPages.swift, PdfRenderer on Android) as the viewer nears it, and the pages
// are pictures in a column that scrolls like the rest of the app, as the RN app's viewer shows a
// PDF in the system's own document view: the pages fill the sheet (its header already names the
// file), pinch zooms about the fingers while they pan, one finger pans a zoomed page any way, and
// a double tap zooms in there and back. Zoomed, the part on screen is drawn again at the zoom
// once it comes to rest, so text stays sharp.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useRegisterViewerNav } from "@/shell/workspace-stage/viewer-item-context";
import { useDisplayFileBytes } from "@/shared/hooks/use-display-file-data";
import { useT } from "@/shared/i18n";
import { fontSize, look, useTokens } from "../../../../../../desktop-rune/ui/theme";
import { PreviewBoundary, PreviewProblem } from "../../../../../../desktop-rune/ui/shell/display/preview-states";
import { phoneRequest } from "../../../../../ui/native/app";
import type { Magnify, ScrollPos } from "../../../../../../desktop-rune/host/rune-jsx/props";

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

/** Zoom: the most, a double tap's, and how far a pinch may overshoot either end before it settles back. */
const ZOOM_MAX = 5;
const ZOOM_DOUBLE = 2.5;
const ZOOM_SLACK_IN = 1.3;
const ZOOM_SLACK_OUT = 0.6;
/** A zoom springs back into bounds (and to identity after a pinch's layout lands) on this. */
const ZOOM_GLIDE = { dur: 0.32, bounce: 0 };
/** Quiet time after the last scroll or zoom before the part on screen is drawn sharp. */
const TILE_SETTLE_MS = 140;
/** A sharp tile reaches this far past the screen on each side (fraction of the screen). */
const TILE_MARGIN = 0.15;
/** Widest tile drawn (pixels). */
const TILE_MAX_PX = 4096;

const folder = () => `${__native.env.caches}/pdf-pages`;

const hashOf = (value: string): string => {
  const digest = __native.digest("SHA-256", new TextEncoder().encode(value));
  let hex = "";
  for (let i = 0; i < 10; i++) hex += digest[i]!.toString(16).padStart(2, "0");
  return hex;
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The content's transform while a pinch runs, and the spring that lands it after one. */
type View = { k: number; x: number; y: number; live: boolean };
const IDENTITY: View = { k: 1, x: 0, y: 0, live: false };
type Pt = { x: number; y: number };
/** A sharp picture of part of a page: `rect` is fractions of the page, `zoom` the zoom it was drawn for. */
type Tile = { path: string; rect: [number, number, number, number]; zoom: number };

export function PdfViewerCard(props: PdfViewerCardProps) {
  const [attempt, setAttempt] = useState(0);
  return (
    <PreviewBoundary key={props.filePath}>
      <PdfViewerCardContent key={attempt} {...props} onRetry={() => setAttempt((value) => value + 1)} />
    </PreviewBoundary>
  );
}

function PdfViewerCardContent({ filePath, onPageChange, onRetry }: PdfViewerCardProps & { onRetry: () => void }) {
  const t = useT();
  const tokens = useTokens();
  const { bytes, error: fileError, missing: fileMissing } = useDisplayFileBytes(filePath, t("app.chat.pdfViewer.hostRequired"));
  const [doc, setDoc] = useState<{ path: string; pages: [number, number][] } | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  /** The scroll, in the unzoomed layout's points, as often as the pages near the screen need it. */
  const [scroll, setScroll] = useState({ y: 0, h: 0 });
  const [pictures, setPictures] = useState<ReadonlyMap<number, string>>(new Map());
  const [tiles, setTiles] = useState<ReadonlyMap<number, Tile>>(new Map());
  const [zoom, setZoom] = useState(1);
  const [view, setView] = useState<View>(IDENTITY);
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

  // The unzoomed layout: a zoom draws it `zoom` times larger, pads and gaps included.
  const pageWidth = Math.max(0, size.w - PAD * 2);
  const layout = useMemo(() => {
    const tops: number[] = [];
    const heights: number[] = [];
    let y = PAD;
    for (const [w, h] of doc?.pages ?? []) {
      tops.push(y);
      const height = pageWidth * (h / Math.max(1, w));
      heights.push(height);
      y += height + PAGE_GAP;
    }
    return { tops, heights, height: y - PAGE_GAP + PAD };
  }, [doc, pageWidth]);

  const total = doc?.pages.length ?? 0;
  // The page at the middle of the screen (1-based), the pages on it, and the run of pages near it.
  const { current, first, last, onFirst, onLast } = useMemo(() => {
    if (total === 0) return { current: 1, first: 0, last: -1, onFirst: 0, onLast: -1 };
    const mid = scroll.y + scroll.h / 2;
    let at = 0;
    while (at + 1 < total && layout.tops[at + 1]! <= mid) at += 1;
    let top = 0;
    while (top + 1 < total && layout.tops[top + 1]! <= scroll.y) top += 1;
    let bottom = top;
    while (bottom + 1 < total && layout.tops[bottom + 1]! < scroll.y + scroll.h) bottom += 1;
    return { current: at + 1, first: Math.max(0, top - AHEAD), last: Math.min(total - 1, bottom + AHEAD), onFirst: top, onLast: bottom };
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

  // Where the viewport is scrolled (exact, in the zoomed layout's points) and the zoom laid out.
  const pos = useRef<Pt>({ x: 0, y: 0 });
  const zoomNow = useRef(1);
  zoomNow.current = zoom;
  /** Bumped when scrolling or zooming comes to rest: the sharp tiles are drawn for there. */
  const [restKey, setRestKey] = useState(0);
  const restTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteMotion = () => {
    if (restTimer.current) clearTimeout(restTimer.current);
    restTimer.current = setTimeout(() => setRestKey((k) => k + 1), TILE_SETTLE_MS);
  };
  useEffect(() => () => void (restTimer.current && clearTimeout(restTimer.current)), []);

  const onScroll = (p: ScrollPos) => {
    pos.current = { x: p.x, y: p.y };
    const z = zoomNow.current;
    const y = p.y / z;
    const h = p.viewport[1] / z;
    setScroll((s) => (Math.abs(s.y - y) < 24 / z && s.h === h ? s : { y, h }));
    noteMotion();
  };

  /**
   * Lands zoom `to` from the zoom drawn now (`from`, with the content transformed by `shown`),
   * keeping `q` (a point of the unzoomed layout) under screen point `f`, inside the content's
   * ends: the layout at the new zoom, its scroll and a transform that draws it exactly as it
   * showed land in one commit, then the transform springs away, so the page never jumps.
   */
  const landings = useRef(0);
  const land = (from: number, shown: View, q: Pt, f: Pt, to: number) => {
    const z = clamp(to, 1, ZOOM_MAX);
    const z2 = z < 1.08 ? 1 : z;
    // Where the content showed: screen = from · q − S (S is the scroll it showed at).
    const live = from * shown.k;
    const S = { x: live * q.x - f.x, y: live * q.y - f.y };
    const maxX = Math.max(0, size.w * z2 - size.w);
    const maxY = Math.max(0, layout.height * z2 - size.h);
    const s = { x: clamp(z2 * q.x - f.x, 0, maxX), y: clamp(z2 * q.y - f.y, 0, maxY) };
    const k = live / z2;
    // Instant even when it lands exactly: the column's new size mustn't spring on its motion.
    flushSync(() => {
      setZoom(z2);
      setView({ k, x: s.x - S.x, y: s.y - S.y, live: true });
      setScroll({ y: s.y / z2, h: size.h / z2 });
    });
    zoomNow.current = z2;
    pos.current = s;
    // The scroll's reply comes once the engine has drawn the new layout (the command follows
    // the commit's ops): only then may the transform spring away, or the layout's own change
    // would land in a commit that animates and spring too.
    const landing = ++landings.current;
    void stella.engine.scroll.to(scrollId, s.y, { x: s.x, animate: false }).catch(() => {}).then(() => {
      if (landing === landings.current && !pinch.current) setView(IDENTITY);
    });
    noteMotion();
  };

  // Pinch: the point that began under the fingers stays under them, so spreading zooms about
  // them and moving them together pans, at the same time (packages/mobile's pinch).
  const pinch = useRef<{ from: number; s0: Pt; q: Pt; z: number } | null>(null);
  const onMagnify = (m: Magnify) => {
    if (size.w <= 0 || total === 0) return;
    if (m.phase === "start" || !pinch.current) {
      const from = zoomNow.current;
      const s0 = pos.current;
      pinch.current = { from, s0, q: { x: (m.x + s0.x) / from, y: (m.y + s0.y) / from }, z: from };
    }
    const p = pinch.current;
    if (m.phase !== "end") p.z = clamp(p.z * (1 + m.delta), ZOOM_SLACK_OUT, ZOOM_MAX * ZOOM_SLACK_IN);
    if (m.phase === "end" || m.wheel) {
      pinch.current = null;
      land(p.from, { k: p.z / p.from, x: 0, y: 0, live: true }, p.q, { x: m.x, y: m.y }, p.z);
      return;
    }
    // Drawn now at `from` and scrolled to s0: scale by k about the content's corner, then shift.
    const k = p.z / p.from;
    setView({ k, x: m.x - k * p.from * p.q.x + p.s0.x, y: m.y - k * p.from * p.q.y + p.s0.y, live: true });
  };

  const onDoublePress = (at: Pt) => {
    if (size.w <= 0 || total === 0 || pinch.current) return;
    const from = zoomNow.current;
    const f = Number.isFinite(at.x) && Number.isFinite(at.y) ? at : { x: size.w / 2, y: size.h / 2 };
    const s = pos.current;
    land(from, IDENTITY, { x: (f.x + s.x) / from, y: (f.y + s.y) / from }, f, from > 1.05 ? 1 : ZOOM_DOUBLE);
  };

  // Zoomed: once it rests, the part of each page on screen is drawn again at the zoom, sharp.
  const tileRun = useRef(0);
  useEffect(() => {
    const run = ++tileRun.current;
    if (!doc || zoom <= 1.05 || size.w <= 0) {
      setTiles((prev) => {
        if (prev.size === 0) return prev;
        prev.forEach((tile) => __native.removeFile(tile.path));
        return new Map();
      });
      return;
    }
    const scale = __native.env.scale;
    const s = pos.current;
    const mx = size.w * TILE_MARGIN;
    const my = size.h * TILE_MARGIN;
    const view0 = { x0: s.x - mx, y0: s.y - my, x1: s.x + size.w + mx, y1: s.y + size.h + my };
    const wanted: { page: number; rect: [number, number, number, number]; px: number }[] = [];
    for (let i = onFirst; i <= onLast; i++) {
      const left = PAD * zoom;
      const top = layout.tops[i]! * zoom;
      const w = pageWidth * zoom;
      const h = layout.heights[i]! * zoom;
      const x0 = Math.max(left, view0.x0);
      const x1 = Math.min(left + w, view0.x1);
      const y0 = Math.max(top, view0.y0);
      const y1 = Math.min(top + h, view0.y1);
      if (x1 - x0 < 1 || y1 - y0 < 1) continue;
      const rect: [number, number, number, number] = [(x0 - left) / w, (y0 - top) / h, (x1 - left) / w, (y1 - top) / h];
      wanted.push({ page: i + 1, rect: rect.map((v) => Math.round(v * 10000) / 10000) as typeof rect, px: Math.min(TILE_MAX_PX, Math.round((x1 - x0) * scale)) });
    }
    void (async () => {
      for (const { page, rect, px } of wanted) {
        const out = `${folder()}/${hashOf(`${doc.path}\u0000${page}\u0000${zoom}\u0000${rect.join(",")}\u0000${px}`)}-tile.jpg`;
        const done = await phoneRequest<{ path: string }>("pdf.render", { path: doc.path, page, width: px, rect, out }).then(
          ({ path }) => path,
          () => null,
        );
        if (!mounted.current || run !== tileRun.current) {
          if (done) __native.removeFile(done);
          return;
        }
        if (!done) continue;
        setTiles((prev) => {
          const next = new Map<number, Tile>();
          for (const [p, tile] of prev) {
            if (p === page || tile.zoom !== zoom || !wanted.some((w) => w.page === p)) {
              if (tile.path !== done) __native.removeFile(tile.path);
              continue;
            }
            next.set(p, tile);
          }
          next.set(page, { path: done, rect, zoom });
          return next;
        });
      }
    })();
    // Drawn for where it rested: `restKey`, and the zoom it rested at.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restKey, zoom, doc, size.w, size.h]);
  // Tiles are files of their own: none outlive the viewer.
  const tilesNow = useRef(tiles);
  tilesNow.current = tiles;
  useEffect(() => () => tilesNow.current.forEach((tile) => __native.removeFile(tile.path)), []);

  const scrollToPage = useCallback(
    (page: number) => {
      const top = layout.tops[page - 1];
      if (top === undefined) return;
      const z = zoomNow.current;
      void stella.engine.scroll.to(scrollId, Math.max(0, (top - PAD) * z), { x: pos.current.x, animate: true }).catch(() => {});
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

  const error = fileError ?? openError;

  // The pages, at the zoom laid out; a pinch only transforms the column around them.
  const pages = useMemo(() => {
    if (!doc || pageWidth <= 0) return null;
    const w = pageWidth * zoom;
    return doc.pages.map((_, index) => {
      const picture = pictures.get(index + 1);
      const tile = tiles.get(index + 1);
      const h = layout.heights[index]! * zoom;
      return (
        // Instant: a page's picture and tile follow its new size at once, never springing to it.
        <box key={index} w={w} h={h} shrink={false} fill="#ffffff" radius={4} border={tokens.c.border} instant>
          {picture ? <image src={picture} w="full" h="full" fit="stretch" radius={4} /> : null}
          {tile && tile.zoom === zoom ? (
            <image
              src={tile.path}
              absolute={{ left: tile.rect[0] * w, top: tile.rect[1] * h }}
              w={(tile.rect[2] - tile.rect[0]) * w}
              h={(tile.rect[3] - tile.rect[1]) * h}
              fit="stretch"
            />
          ) : null}
        </box>
      );
    });
  }, [doc, pageWidth, zoom, pictures, tiles, layout, tokens.c.border]);

  if (error) {
    return <PreviewProblem error={error} missing={Boolean(fileError) && fileMissing} {...(fileMissing ? {} : { onRetry })} />;
  }
  return (
    <col
      id={scrollId}
      grow={1}
      minH={0}
      w="full"
      scrollY
      scrollX
      // A zoom places the scroll itself, in the same commit as the new layout.
      noScrollAnchor
      fill={tokens.c.background}
      onSize={(r) => setSize({ w: Math.floor(r.w), h: r.h })}
      onScroll={onScroll}
      onMagnify={onMagnify}
      onDoublePress={onDoublePress}
    >
      {pages ? (
        <col
          w={size.w * zoom}
          px={PAD * zoom}
          py={PAD * zoom}
          gap={PAGE_GAP * zoom}
          shrink={false}
          origin={[0, 0]}
          scale={view.k}
          x={view.x}
          y={view.y}
          motion={ZOOM_GLIDE}
          instant={view.live}
        >
          {pages}
        </col>
      ) : (
        <text py={28} px={16} textAlign="center" {...look(fontSize.base, 400)} color={tokens.c.mutedForeground}>
          {t("app.chat.pdfViewer.loading")}
        </text>
      )}
    </col>
  );
}
