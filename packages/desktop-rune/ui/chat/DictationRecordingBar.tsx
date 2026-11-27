import { useEffect, useRef, useState } from "react";
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
import { Icon, Icons, withStroke, type IconData } from "../kit";
import { derive, mixOklch, useTokens } from "../theme";
import type { VectorPath } from "../../host/rune-jsx/props";

const CONTROL = 32;
const WAVEFORM_H = 32;
const WAVEFORM_FILL = 0.94;
const TNUM = "'tnum' 1";

const useDictationLook = () =>
  derive(useTokens(), "chat:dictation-bar", (k) => ({
    wave: mixOklch(k.c.textBase, 70, "transparent"),
    control: mixOklch(k.c.textBase, 7, "transparent"),
    controlIcon: mixOklch(k.c.textBase, 75, "transparent"),
  }));

const formatElapsed = (ms: number): string => {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(totalSec / 60)}:${(totalSec % 60).toString().padStart(2, "0")}`;
};

type DictationRecordingBarProps = {
  className?: string;
  readLevel: () => number;
  elapsedMs: number;
  onCancel?: () => void;
  onConfirm?: () => void;
  showControls?: boolean;
  onSend?: () => void;
};

/** desktop-ui's `DictationRecordingBar`: the live waveform, the timer, and cancel / transcribe / send. */
export function DictationRecordingBar({ readLevel, elapsedMs, onCancel, onConfirm, showControls = true, onSend }: DictationRecordingBarProps) {
  const t = useT();
  const c = useTokens().c;
  const look = useDictationLook();
  return (
    <col grow={1} minW={0} gap={7} py={1}>
      <row minW={0} minH={36} align="center" gap={8}>
        <DictationWaveform readLevel={readLevel} color={look.wave} />
        <text shrink={false} px={4} size={12} features={TNUM} color={look.wave} role="status">
          {formatElapsed(elapsedMs)}
        </text>
        {showControls ? (
          <>
            <DictationCancelButton onClick={onCancel} />
            <DictationControl icon={Icons.stella.Check} iconSize={18} color={c.textStrong} hoverColor={c.primary} title={t("features.dictation.stopAndTranscribe")} label={t("features.dictation.stopAndTranscribeLabel")} onPress={onConfirm} />
            {onSend ? (
              <DictationControl icon={withStroke(Icons.stella.ArrowUp, 2.5)} iconSize={16} color={c.textStrong} hoverColor={c.primary} title={t("features.dictation.stopTranscribeSend")} label={t("features.dictation.stopTranscribeSendLabel")} onPress={onSend} />
            ) : null}
          </>
        ) : null}
      </row>
    </col>
  );
}

export function DictationCancelButton({ onClick }: { className?: string; onClick?: () => void }) {
  const t = useT();
  const c = useTokens().c;
  const look = useDictationLook();
  return <DictationControl icon={Icons.stella.X} iconSize={16} color={look.controlIcon} hoverColor={c.textStrong} title={t("features.dictation.cancel")} label={t("features.dictation.cancel")} onPress={onClick} />;
}

function DictationControl({ icon, iconSize, color, hoverColor, title, label, onPress }: { icon: IconData; iconSize: number; color: string; hoverColor: string; title: string; label: string; onPress?: () => void }) {
  const tokens = useTokens();
  const look = useDictationLook();
  return (
    <box role="button" focusable title={title} label={label} shrink={false} w={CONTROL} h={CONTROL} center radius={CONTROL / 2} fill={look.control} hoverColor={hoverColor} motion={{ dur: 0.15, bounce: 0 }} focusRing={{ color: tokens.c.ring, width: 2, offset: 0 }} onPress={onPress}>
      <Icon icon={icon} size={iconSize} color={color} />
    </box>
  );
}

const barPath = (x: number, y: number, w: number, h: number): string => {
  const r = Math.min(w / 2, h / 2);
  return `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${2 * r - w}a${r} ${r} 0 0 1 ${-r} ${-r}v${2 * r - h}a${r} ${r} 0 0 1 ${r} ${-r}z`;
};

function DictationWaveform({ readLevel, color }: { readLevel: () => number; color: string }) {
  const readLevelRef = useRef(readLevel);
  readLevelRef.current = readLevel;
  const [width, setWidth] = useState(0);
  const [paths, setPaths] = useState<VectorPath[]>([]);

  useEffect(() => {
    if (width === 0) return;
    const wave = createDictationWaveformState();
    const midY = WAVEFORM_H / 2;
    const maxHeight = WAVEFORM_H * WAVEFORM_FILL;
    let frame = 0;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      stepDictationWaveform(wave, now, readLevelRef.current());
      const next: VectorPath[] = [];
      const count = dictationWaveformBarCount(width);
      for (let age = 0; age < count; age += 1) {
        const offset = dictationWaveformOffset(wave, age);
        const x = width - offset - DICTATION_WAVEFORM_BAR_WIDTH;
        if (x + DICTATION_WAVEFORM_BAR_WIDTH <= 0) break;
        const bar = dictationWaveformBarLook(dictationWaveformLevel(wave, age) ?? 0, offset, width, maxHeight);
        if (bar.height <= 0 || bar.opacity <= 0) continue;
        next.push({ d: barPath(x, midY - bar.height / 2, DICTATION_WAVEFORM_BAR_WIDTH, bar.height), fill: color, opacity: bar.opacity });
      }
      setPaths(next);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [color, width]);

  return (
    <box grow={1} minW={0} h={WAVEFORM_H} clip={0} inert onSize={(r) => setWidth(Math.round(r.w))}>
      {width > 0 ? <vector w={width} h={WAVEFORM_H} viewBox={[width, WAVEFORM_H]} paths={paths} /> : null}
    </box>
  );
}
