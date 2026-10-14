/**
 * Modal — the accessible shell for hand-rolled modal surfaces.
 *
 * Most dialogs in the app ride on `ui/dialog.tsx` (Radix), which already
 * ships the dialog role, the focus trap, Esc-to-close and focus restore.
 * A few surfaces cannot use it: they must render *inside* a specific
 * layout box rather than a body portal (the chat-column focus overlay),
 * or they predate the primitive entirely (the screenshot preview). This
 * is the tiny in-house equivalent for those — no new dependency, and
 * deliberately unopinionated about looks: every visual decision stays in
 * the caller's own class names.
 *
 * What it guarantees:
 *  - `role="dialog"` + `aria-modal="true"` on the panel
 *  - an accessible name via `aria-labelledby` or `aria-label`, and an
 *    optional `aria-describedby`
 *  - focus moved into the panel on open (explicit target, else the first
 *    tabbable, else the panel itself)
 *  - Tab / Shift+Tab cycling inside the panel
 *  - Escape closes the topmost open modal only
 *  - focus restored to whatever opened it on close
 *  - the rest of the page marked `inert` + `aria-hidden` while open
 *
 * Motion is left to CSS: the app's global `html[data-reduce-motion="reduce"]`
 * rule in `index.css` already neutralizes animations, so callers keep the
 * animations they had and inherit the same reduced-motion behavior.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

const TABBABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "audio[controls]",
  "video[controls]",
  "[contenteditable]:not([contenteditable='false'])",
  "[tabindex]",
].join(",");

const isVisible = (element: HTMLElement) => {
  if (element.hidden || element.closest("[hidden]") !== null) return false;
  const check = (element as HTMLElement & { checkVisibility?: () => boolean })
    .checkVisibility;
  return typeof check === "function" ? check.call(element) : true;
};

export function getTabbableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR),
  ).filter(
    (element) =>
      !element.hasAttribute("disabled") &&
      element.getAttribute("aria-hidden") !== "true" &&
      Number(element.getAttribute("tabindex") ?? "0") >= 0 &&
      element.closest("[inert]") === null &&
      isVisible(element),
  );
}

const modalStack: HTMLElement[] = [];

const isTopmost = (panel: HTMLElement | null) =>
  panel !== null && modalStack[modalStack.length - 1] === panel;

function inertBackground(root: HTMLElement): () => void {
  const undo: Array<() => void> = [];
  let node: HTMLElement | null = root;
  while (node && node.parentElement) {
    const parent: HTMLElement = node.parentElement;
    const self = node;
    for (const sibling of Array.from(parent.children)) {
      if (sibling === self || !(sibling instanceof HTMLElement)) continue;
      if (sibling.dataset.stellaModalInert === "1") continue;
      const previousAriaHidden = sibling.getAttribute("aria-hidden");
      const wasInert = sibling.hasAttribute("inert");
      sibling.dataset.stellaModalInert = "1";
      sibling.setAttribute("aria-hidden", "true");
      if (!wasInert) sibling.setAttribute("inert", "");
      undo.push(() => {
        delete sibling.dataset.stellaModalInert;
        if (previousAriaHidden === null) sibling.removeAttribute("aria-hidden");
        else sibling.setAttribute("aria-hidden", previousAriaHidden);
        if (!wasInert) sibling.removeAttribute("inert");
      });
    }
    node = parent === document.body ? null : parent;
  }
  return () => {
    for (const step of undo) step();
  };
}

export type ModalProps = {
  onClose: () => void;
  children: ReactNode;
  labelledBy?: string;
  label?: string;
  describedBy?: string;
  className?: string;
  style?: CSSProperties;
  backdropClassName?: string;
  backdropStyle?: CSSProperties;
  backdropProps?: Record<string, string | undefined>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  closeOnBackdropClick?: boolean;
  modal?: boolean;
  container?: HTMLElement | null;
};

export function Modal({
  onClose,
  children,
  labelledBy,
  label,
  describedBy,
  className,
  style,
  backdropClassName,
  backdropStyle,
  backdropProps,
  initialFocusRef,
  closeOnBackdropClick = true,
  modal = true,
  container = null,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const opener = document.activeElement;
    modalStack.push(panel);
    const restoreBackground = modal ? inertBackground(panel) : () => {};
    return () => {
      restoreBackground();
      const index = modalStack.indexOf(panel);
      if (index >= 0) modalStack.splice(index, 1);
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus({ preventScroll: true });
      }
    };
  }, [modal]);

  const [openFocusRef] = useState(() => initialFocusRef);
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const explicit = openFocusRef?.current;
    const target = explicit ?? getTabbableElements(panel)[0] ?? panel;
    target.focus({ preventScroll: true });
  }, [openFocusRef]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const panel = panelRef.current;
      if (!panel || event.defaultPrevented || !isTopmost(panel)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !modal) return;
      const tabbables = getTabbableElements(panel);
      if (tabbables.length === 0) {
        event.preventDefault();
        panel.focus({ preventScroll: true });
        return;
      }
      const first = tabbables[0];
      const last = tabbables[tabbables.length - 1];
      const active = document.activeElement;
      const inside = active instanceof HTMLElement && panel.contains(active);
      if (event.shiftKey && (!inside || active === first || active === panel)) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && (!inside || active === last)) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [modal]);

  const handleBackdropPointerDown = useCallback(
    (event: React.MouseEvent) => {
      if (!closeOnBackdropClick) return;
      if (event.target !== event.currentTarget) return;
      onCloseRef.current();
    },
    [closeOnBackdropClick],
  );

  const tree = (
    <div
      className={backdropClassName}
      style={backdropStyle}
      onMouseDown={handleBackdropPointerDown}
      {...backdropProps}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal={modal ? "true" : undefined}
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : label}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={className}
        style={style}
      >
        {children}
      </div>
    </div>
  );

  return container ? createPortal(tree, container) : tree;
}
