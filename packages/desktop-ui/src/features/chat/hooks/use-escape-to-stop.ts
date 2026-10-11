import { useEffect, useRef, type RefObject } from "react";

export function useEscapeToStop(args: {
  active: boolean;
  stop: () => void;
  inputRef: RefObject<HTMLElement | null>;
  whenUnfocused?: boolean;
}) {
  const { active, inputRef, whenUnfocused = false } = args;
  const stopRef = useRef(args.stop);
  stopRef.current = args.stop;

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (event.isComposing || event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
      }
      const focused = document.activeElement;
      const inComposer =
        inputRef.current !== null && focused === inputRef.current;
      const unfocused =
        whenUnfocused && (focused === null || focused === document.body);
      if (!inComposer && !unfocused) return;
      event.preventDefault();
      stopRef.current();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [active, inputRef, whenUnfocused]);
}
