import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  createStellaMark,
  type CreateStellaMarkOptions,
  type StellaCharacterShape,
  type StellaCharacterState,
  type StellaMarkHandle,
} from "./rig";

export type { StellaCharacterShape, StellaCharacterState };

export interface StellaCharacterProps {
  size: number | null;
  state?: StellaCharacterState;
  shape?: StellaCharacterShape;
  ink?: "aurora" | "vivid";
  eyeColor?: string;
  glow?: boolean;
  paused?: boolean;
  followPointer?: boolean;
  className?: string;
  style?: React.CSSProperties;
  handleRef?: React.RefObject<StellaMarkHandle | null>;
}

export function StellaCharacter({
  size,
  state = "idle",
  shape = "star",
  ink = "aurora",
  eyeColor,
  glow = false,
  paused = false,
  followPointer = false,
  className,
  style,
  handleRef,
}: StellaCharacterProps) {
  const hostRef = useRef<HTMLSpanElement | null>(null);
  const [mark, setMark] = useState<StellaMarkHandle | null>(null);
  const readMotion = useEffectEvent(() => ({ state, shape, paused }));

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const opts: CreateStellaMarkOptions = {
      size,
      ink,
      glow,
      followPointer,
      ...readMotion(),
    };
    if (eyeColor) opts.eyeColor = eyeColor;
    const created = createStellaMark(host, opts);
    setMark(created);
    return () => {
      setMark(null);
      created.destroy();
    };
  }, [size, ink, glow, eyeColor, followPointer]);

  useLayoutEffect(() => {
    if (!handleRef || !mark) return;
    handleRef.current = mark;
    return () => {
      handleRef.current = null;
    };
  }, [handleRef, mark]);

  useEffect(() => {
    mark?.setState(state);
  }, [mark, state]);

  useEffect(() => {
    mark?.setShape(shape);
  }, [mark, shape]);

  useEffect(() => {
    if (!mark) return;
    if (paused) mark.pause();
    else mark.resume();
  }, [mark, paused]);

  return (
    <span
      ref={hostRef}
      className={className}
      aria-hidden
      style={{
        display: "inline-block",
        width: size ?? undefined,
        height: size ?? undefined,
        flex: "0 0 auto",
        ...style,
      }}
    />
  );
}
