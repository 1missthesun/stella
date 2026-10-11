import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  type RefObject,
} from "react";

export type ReplyMorphIndicatorHandle = {
  pill: () => HTMLElement | null;
  vacate: () => void;
  exit: () => void;
};

const REPLY_HOLD_MS = 120;
const HANDOFF_WAIT_MS = 600;
const RUN_END_WAIT_MS = 80;
const MORPH_MS = 520;
const GHOST_FADE_MS = 150;
const CONTENT_DELAY_MS = 190;
const CONTENT_FADE_MS = 230;
const MORPH_SPRING =
  "linear(0, 0.041, 0.138, 0.259, 0.386, 0.506, 0.614, 0.705, 0.781, 0.842, 0.889, 0.925, 0.952, 0.971, 0.984, 0.993, 0.999, 1.002, 1.004, 1.005, 1.005, 1.005, 1.004, 1.003, 1.003, 1.002, 1)";

const prefersReducedMotion = () =>
  document.documentElement.getAttribute("data-reduce-motion") === "reduce" ||
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

function startMorph(
  row: HTMLElement,
  pill: HTMLElement,
  onDone: () => void,
): (() => void) | null {
  const bubble = row.querySelector<HTMLElement>(".assistant-message-text");
  if (!bubble) return null;
  const from = pill.getBoundingClientRect();
  const to = bubble.getBoundingClientRect();
  if (from.width === 0 || to.width === 0) return null;
  const bubbleStyle = getComputedStyle(bubble);

  const layer = document.createElement("div");
  layer.className = "reply-morph-layer";
  layer.setAttribute("aria-hidden", "true");
  layer.style.backgroundColor = bubbleStyle.backgroundColor;
  layer.style.backgroundImage = bubbleStyle.backgroundImage;
  layer.style.borderRadius = bubbleStyle.borderTopLeftRadius;
  const ghost = pill.cloneNode(true) as HTMLElement;
  ghost.classList.add("reply-morph-ghost");
  layer.append(ghost);
  const content = Array.from(bubble.children) as HTMLElement[];
  bubble.classList.add("assistant-message-text--morphing");
  bubble.append(layer);

  const grow = layer.animate(
    {
      width: [`${from.width}px`, `${to.width}px`],
      height: [`${from.height}px`, `${to.height}px`],
    },
    { duration: MORPH_MS, easing: MORPH_SPRING, fill: "both" },
  );
  const radius = bubbleStyle.borderTopLeftRadius;
  const clip = bubble.animate(
    {
      clipPath: [
        `inset(0px ${to.width - from.width}px ${to.height - from.height}px 0px round ${radius})`,
        `inset(0px 0px 0px 0px round ${radius})`,
      ],
    },
    { duration: MORPH_MS, easing: MORPH_SPRING, fill: "both" },
  );
  const animations = [
    grow,
    clip,
    ghost.animate(
      { opacity: [1, 0] },
      { duration: GHOST_FADE_MS, easing: "ease-out", fill: "both" },
    ),
    ...content.map((child) =>
      child.animate(
        { opacity: [0, 1] },
        {
          delay: CONTENT_DELAY_MS,
          duration: CONTENT_FADE_MS,
          easing: "cubic-bezier(0.33, 0, 0.2, 1)",
          fill: "backwards",
        },
      ),
    ),
  ];

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    for (const animation of animations) animation.cancel();
    layer.remove();
    bubble.classList.remove("assistant-message-text--morphing");
    onDone();
  };
  grow.finished.then(finish, () => {});
  return finish;
}

export function createReplyMorphController() {
  let indicator: ReplyMorphIndicatorHandle | null = null;
  let held: { row: HTMLElement; timer: number } | null = null;
  let deactivation: { timer: number } | null = null;
  let frame: number | null = null;
  const morphs = new Map<HTMLElement, () => void>();

  const releaseHeld = () => {
    if (!held) return;
    window.clearTimeout(held.timer);
    delete held.row.dataset.replyMorph;
    held = null;
  };

  const clearDeactivation = () => {
    if (!deactivation) return;
    window.clearTimeout(deactivation.timer);
    deactivation = null;
  };

  const resolve = () => {
    if (frame !== null) {
      window.cancelAnimationFrame(frame);
      frame = null;
    }
    if (!held) return;
    const row = held.row;
    window.clearTimeout(held.timer);
    held = null;
    clearDeactivation();
    const pill = indicator?.pill() ?? null;
    const finish = pill
      ? startMorph(row, pill, () => morphs.delete(row))
      : null;
    if (finish) {
      row.dataset.replyMorph = "morph";
      morphs.set(row, finish);
    } else {
      delete row.dataset.replyMorph;
    }
    if (pill) indicator?.vacate();
  };

  return {
    attachIndicator(handle: ReplyMorphIndicatorHandle): () => void {
      indicator = handle;
      return () => {
        if (indicator !== handle) return;
        indicator = null;
        clearDeactivation();
        releaseHeld();
      };
    },
    indicatorDeactivated(handoff: boolean) {
      if (deactivation || held) return;
      deactivation = {
        timer: window.setTimeout(
          () => {
            deactivation = null;
            indicator?.exit();
          },
          handoff ? HANDOFF_WAIT_MS : RUN_END_WAIT_MS,
        ),
      };
    },
    indicatorReactivated() {
      clearDeactivation();
    },
    offerReply(row: HTMLElement) {
      if (!indicator?.pill() || prefersReducedMotion()) return;
      releaseHeld();
      row.dataset.replyMorph = "hold";
      held = { row, timer: window.setTimeout(resolve, REPLY_HOLD_MS) };
      if (frame === null) frame = window.requestAnimationFrame(resolve);
    },
    forgetReply(row: HTMLElement) {
      if (held?.row === row) releaseHeld();
      morphs.get(row)?.();
    },
  };
}

export type ReplyMorphController = ReturnType<
  typeof createReplyMorphController
>;

export const ReplyMorphContext = createContext<ReplyMorphController | null>(
  null,
);

export function useReplyMorphController(): ReplyMorphController | null {
  return useContext(ReplyMorphContext);
}

export function useReplyMorphArrival(
  rowRef: RefObject<HTMLElement | null>,
  justArrived: boolean,
  finalAnswer: boolean,
) {
  const controller = useReplyMorphController();
  const arrivedOnMountRef = useRef(justArrived && finalAnswer);
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!controller || !row || !arrivedOnMountRef.current) return;
    controller.offerReply(row);
    return () => controller.forgetReply(row);
  }, [controller, rowRef]);
}
