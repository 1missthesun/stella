import { useEffect, useRef } from "react";
import { AudioLines } from "@/ui/icons";

const CANVAS_HEIGHT = 44;
const BAR_GAP = 1;

export const WaveformTile = ({
  peaks,
  durationLabel,
}: {
  peaks: number[];
  durationLabel?: string;
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || peaks.length === 0) return;
    const width = canvas.clientWidth;
    if (width <= 0) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(CANVAS_HEIGHT * ratio);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(ratio, ratio);
    context.fillStyle = getComputedStyle(canvas).color;
    const step = width / peaks.length;
    const barWidth = Math.max(1, step - BAR_GAP);
    for (let index = 0; index < peaks.length; index += 1) {
      const amplitude = Math.max(0.04, peaks[index] ?? 0);
      const barHeight = amplitude * CANVAS_HEIGHT;
      context.fillRect(
        index * step,
        (CANVAS_HEIGHT - barHeight) / 2,
        barWidth,
        barHeight,
      );
    }
  }, [peaks]);

  return (
    <span className="media-tile__wave">
      <span className="media-tile__wave-glyph" aria-hidden="true">
        <AudioLines size={12} />
      </span>
      <canvas ref={canvasRef} className="media-tile__wave-canvas" />
      {durationLabel ? (
        <span className="media-tile__wave-time">{durationLabel}</span>
      ) : null}
    </span>
  );
};
