import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  useRegisterViewerNav,
  useViewerDetailReporter,
} from "@/shell/workspace-stage/viewer-item-context";

/**
 * The page rail for Word and Slides: slides, or the document's headings.
 * Office previews are HTML, so this lists them by text rather than drawing a
 * thumbnail of each one (which would mean re-rendering the whole file per
 * entry).
 */

type OutlineKind = "presentation" | "document";

const SLIDE_SELECTOR = ".slide-container, [data-slide-index]";
const HEADING_SELECTOR = "h1, h2, h3";
const MAX_ENTRIES = 80;

type OutlineEntry = { label: string; level: number };

const textOf = (node: Element | null): string =>
  (node?.textContent ?? "").replace(/\s+/g, " ").trim();

const scrollContainerOf = (node: Element, doc: Document): Element => {
  const win = doc.defaultView;
  for (let el = node.parentElement; el && win; el = el.parentElement) {
    if (el === doc.body || el === doc.documentElement) break;
    const { overflowY } = win.getComputedStyle(el);
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      el.scrollHeight > el.clientHeight
    ) {
      return el;
    }
  }
  return doc.scrollingElement ?? doc.documentElement;
};

/** Viewport top of a scroll container (0 for the document itself). */
const viewportTopOf = (container: Element, doc: Document) =>
  container === (doc.scrollingElement ?? doc.documentElement)
    ? 0
    : container.getBoundingClientRect().top;

export const parseOfficeOutline = (
  html: string | undefined,
  kind: OutlineKind,
): OutlineEntry[] => {
  if (!html || typeof DOMParser === "undefined") return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (kind === "presentation") {
    return Array.from(doc.querySelectorAll(SLIDE_SELECTOR))
      .slice(0, MAX_ENTRIES)
      .map((slide, index) => {
        // Slide previews often lead with their own "Slide N" label.
        const clean = (text: string) =>
          text.replace(/^slide\s+\d+\s*[:.\-–]?\s*/i, "");
        const heading = clean(
          textOf(slide.querySelector("h1, h2, h3, .title, [class*='title']")),
        );
        const fallback = clean(textOf(slide)).slice(0, 60);
        return {
          label: heading || fallback || `Slide ${index + 1}`,
          level: 1,
        };
      });
  }
  return Array.from(doc.querySelectorAll(HEADING_SELECTOR))
    .map((heading) => ({
      label: textOf(heading),
      level: Number(heading.tagName.slice(1)) || 1,
    }))
    .filter((entry) => entry.label.length > 0)
    .slice(0, MAX_ENTRIES);
};

const targetsIn = (doc: Document, kind: OutlineKind): HTMLElement[] =>
  Array.from(
    doc.querySelectorAll<HTMLElement>(
      kind === "presentation" ? SLIDE_SELECTOR : HEADING_SELECTOR,
    ),
  ).filter((node) => kind === "presentation" || textOf(node).length > 0);

export function OfficeOutlineRail({
  html,
  kind,
  frameRef,
}: {
  html: string | undefined;
  kind: OutlineKind;
  frameRef: RefObject<HTMLIFrameElement | null>;
}) {
  const entries = useMemo(() => parseOfficeOutline(html, kind), [html, kind]);
  const [current, setCurrent] = useState(0);
  // While a jump animates, the scroll position lags behind the target.
  const jumpUntilRef = useRef(0);
  const reportDetail = useViewerDetailReporter();

  useEffect(() => {
    if (entries.length < 2) {
      reportDetail(null);
      return;
    }
    reportDetail(
      kind === "presentation"
        ? `slide ${current + 1}`
        : (entries[current]?.label.slice(0, 32) ?? null),
    );
  }, [current, entries, kind, reportDetail]);

  // Follow the frame's scroll so the rail and the composer chip track it.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || entries.length < 2) return;
    let detach = () => {};
    const attach = () => {
      detach();
      const win = frame.contentWindow;
      const doc = frame.contentDocument;
      if (!win || !doc) return;
      const onScroll = () => {
        if (Date.now() < jumpUntilRef.current) return;
        const targets = targetsIn(doc, kind);
        const first = targets[0];
        if (!first) return;
        const line = viewportTopOf(scrollContainerOf(first, doc), doc) + 48;
        let index = 0;
        for (let i = 0; i < targets.length; i += 1) {
          if (targets[i]!.getBoundingClientRect().top <= line) index = i;
          else break;
        }
        setCurrent(index);
      };
      // Previews may scroll an inner element, so listen in the capture phase.
      doc.addEventListener("scroll", onScroll, {
        capture: true,
        passive: true,
      });
      detach = () =>
        doc.removeEventListener("scroll", onScroll, { capture: true });
    };
    frame.addEventListener("load", attach);
    attach();
    return () => {
      frame.removeEventListener("load", attach);
      detach();
    };
  }, [entries.length, frameRef, kind]);

  const jumpTo = useCallback(
    (index: number) => {
      const doc = frameRef.current?.contentDocument;
      if (!doc) return;
      const target = targetsIn(doc, kind)[index];
      if (target) {
        // Scroll vertically only; scrollIntoView would also shift wide slides
        // sideways.
        const container = scrollContainerOf(target, doc);
        const top =
          target.getBoundingClientRect().top -
          viewportTopOf(container, doc) +
          container.scrollTop;
        jumpUntilRef.current = Date.now() + 700;
        container.scrollTo({ top, behavior: "smooth" });
      }
      setCurrent(index);
    },
    [frameRef, kind],
  );

  useRegisterViewerNav(
    entries.length > 1
      ? {
          canPrevious: current > 0,
          canNext: current < entries.length - 1,
          previous: () => jumpTo(Math.max(0, current - 1)),
          next: () => jumpTo(Math.min(entries.length - 1, current + 1)),
          previousLabel:
            kind === "presentation" ? "Previous slide" : "Previous section",
          nextLabel: kind === "presentation" ? "Next slide" : "Next section",
        }
      : null,
  );

  if (entries.length < 2) return null;

  return (
    <nav
      className="office-outline-rail"
      aria-label={kind === "presentation" ? "Slides" : "Outline"}
    >
      {entries.map((entry, index) => (
        <button
          key={index}
          type="button"
          className="office-outline-rail__item"
          data-level={entry.level}
          data-current={index === current ? "true" : undefined}
          aria-current={index === current ? "true" : undefined}
          title={entry.label}
          onClick={() => jumpTo(index)}
        >
          {kind === "presentation" ? (
            <span className="office-outline-rail__number">{index + 1}</span>
          ) : null}
          <span className="office-outline-rail__label">{entry.label}</span>
        </button>
      ))}
    </nav>
  );
}
