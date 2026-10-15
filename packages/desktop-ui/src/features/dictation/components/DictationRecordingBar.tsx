import { useEffect, useRef } from "react";
import { cn } from "@/shared/lib/utils";
import { ArrowUp, Check, X } from "@/ui/icons";
import { useT } from "@/shared/i18n";
import {
  DICTATION_WAVEFORM_BAR_WIDTH,
  createDictationWaveformState,
  dictationWaveformBarCount,
  dictationWaveformBarLook,
  dictationWaveformLevel,
  dictationWaveformOffset,
  stepDictationWaveform,
} from "@stella/contracts/dictation-waveform";
import "./dictation-recording-bar.css";

type DictationRecordingBarProps = {
  className?: string;
  readLevel: () => number;
  elapsedMs: number;
  onCancel?: () => void;
  onConfirm?: () => void;
  showControls?: boolean;
  onSend?: () => void;
};

export function DictationRecordingBar({
  className,
  readLevel,
  elapsedMs,
  onCancel,
  onConfirm,
  showControls = true,
  onSend,
}: DictationRecordingBarProps) {
  const t = useT();
  return (
    <div className={cn("composer-dictation-recording-bar", className)}>
      <div className="composer-dictation-recording-row">
        <DictationWaveform readLevel={readLevel} />
        <span className="composer-dictation-timer" aria-live="polite">
          {formatElapsed(elapsedMs)}
        </span>
        {showControls ? (
          <>
            <DictationCancelButton onClick={onCancel} />
            <button
              type="button"
              className={cn(
                "chat-composer-icon-button composer-dictation-control",
                "composer-dictation-control--confirm",
              )}
              onClick={onConfirm}
              title={t("features.dictation.stopAndTranscribe")}
              aria-label={t("features.dictation.stopAndTranscribeLabel")}
            >
              <CheckIcon />
            </button>
            {onSend && (
              <button
                type="button"
                className={cn(
                  "chat-composer-icon-button composer-dictation-control",
                  "composer-dictation-control--send",
                )}
                onClick={onSend}
                title={t("features.dictation.stopTranscribeSend")}
                aria-label={t("features.dictation.stopTranscribeSendLabel")}
              >
                <SendIcon />
              </button>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

export function DictationCancelButton({
  className,
  onClick,
}: {
  className?: string;
  onClick?: () => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      className={cn(
        "chat-composer-icon-button composer-dictation-control",
        className,
      )}
      onClick={onClick}
      title={t("features.dictation.cancel")}
      aria-label={t("features.dictation.cancel")}
    >
      <CancelIcon />
    </button>
  );
}

const WAVEFORM_FILL = 0.94;

function DictationWaveform({ readLevel }: { readLevel: () => number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const readLevelRef = useRef(readLevel);
  readLevelRef.current = readLevel;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const wave = createDictationWaveformState();
    let width = 0;
    let height = 0;
    let color = "#9aa1a8";
    let frame = 0;

    const measure = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const targetW = Math.round(width * dpr);
      const targetH = Math.round(height * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      color = getComputedStyle(canvas).color || color;
    };

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      stepDictationWaveform(wave, now, readLevelRef.current());
      ctx.clearRect(0, 0, width, height);
      if (width === 0 || height === 0) return;
      ctx.fillStyle = color;
      const midY = height / 2;
      const maxHeight = height * WAVEFORM_FILL;
      const radius = DICTATION_WAVEFORM_BAR_WIDTH / 2;
      const count = dictationWaveformBarCount(width);
      for (let age = 0; age < count; age += 1) {
        const offset = dictationWaveformOffset(wave, age);
        const x = width - offset - DICTATION_WAVEFORM_BAR_WIDTH;
        if (x + DICTATION_WAVEFORM_BAR_WIDTH <= 0) break;
        const level = dictationWaveformLevel(wave, age) ?? 0;
        const look = dictationWaveformBarLook(level, offset, width, maxHeight);
        ctx.globalAlpha = look.opacity;
        ctx.beginPath();
        ctx.roundRect(
          x,
          midY - look.height / 2,
          DICTATION_WAVEFORM_BAR_WIDTH,
          look.height,
          radius,
        );
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="composer-dictation-waveform"
      aria-hidden
    />
  );
}

const formatElapsed = (ms: number): string => {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

function CancelIcon() {
  return <X size={16} />;
}

function CheckIcon() {
  return <Check size={18} />;
}

function SendIcon() {
  return <ArrowUp size={16} strokeWidth={2.5} />;
}
