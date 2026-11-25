import { useEffect, useId, useRef, useState } from "react";
import { useLocalMediaFailure } from "@/shared/hooks/use-local-media-failure";
import { Icon, Icons } from "../../kit";
import { radius, useTokens } from "../../theme";
import { rune } from "../engine";

const PLOT_HEIGHT = 44;
const BAR_GAP = 1;
const CURSOR_POLL_MS = 33;

export const WaveformTile = ({ peaks, filePath, durationLabel }: { peaks: number[]; filePath: string; durationLabel?: string }) => {
  const tokens = useTokens();
  const id = `waveform:${useId()}`;
  const [armed, setArmed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [plotW, setPlotW] = useState(0);
  const { failure, onError } = useLocalMediaFailure(filePath, "audio file");
  const playingRef = useRef(false);

  useEffect(() => {
    if (!armed) return;
    void rune()
      .media.play(id)
      .catch(() => {
        setPlaying(false);
        onError();
      });
  }, [armed, id, onError]);

  useEffect(() => {
    if (!armed) return;
    let live = true;
    const timer = setInterval(() => {
      void rune()
        .media.state(id)
        .then((state) => {
          if (!live) return;
          const ended = !state.playing && playingRef.current && state.duration !== null && state.time >= state.duration - 0.05;
          playingRef.current = state.playing;
          setPlaying(state.playing);
          setProgress(ended ? 0 : state.duration ? Math.min(1, state.time / state.duration) : 0);
        })
        .catch(() => undefined);
    }, CURSOR_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [armed, id]);

  const step = peaks.length > 0 ? plotW / peaks.length : 0;
  const barW = Math.max(1, step - BAR_GAP);
  return (
    <row absolute={{ left: 0, top: 0, right: 0, bottom: 0 }} align="center" gap={8} px={10}>
      <box
        role="button"
        focusable
        label={playing ? "Pause" : "Play"}
        shrink={false}
        w={24}
        h={24}
        center
        radius={radius.full}
        fill={tokens.c.background}
        border={tokens.c.panelSurfaceBorder}
        cursor="pointer"
        focusRing={{ color: tokens.c.ring, width: 2, offset: 0 }}
        onPress={() => {
          if (!armed) {
            setArmed(true);
            return;
          }
          void (playing ? rune().media.pause(id) : rune().media.play(id));
        }}
      >
        <Icon icon={playing ? Icons.stella.Pause : Icons.stella.Play} size={12} color={tokens.c.foreground} />
      </box>
      <box grow={1} minW={0} h={PLOT_HEIGHT} inert onLayout={(r) => setPlotW(r.w)}>
        {plotW > 0
          ? peaks.map((peak, index) => {
              const barH = Math.max(0.04, peak ?? 0) * PLOT_HEIGHT;
              return <box key={index} absolute={{ left: index * step, top: (PLOT_HEIGHT - barH) / 2 }} w={barW} h={barH} fill={tokens.c.mutedForeground} />;
            })
          : null}
        <box absolute={{ left: 0, top: 0, bottom: 0 }} w={1.5} fill={tokens.c.primary} x={progress * plotW} />
      </box>
      {failure ? (
        <text shrink={false} size={10} features="'tnum' 1" color={tokens.c.mutedForeground} title={failure} role="status">
          Unavailable
        </text>
      ) : durationLabel ? (
        <text size={10} features="'tnum' 1" color={tokens.c.mutedForeground}>
          {durationLabel}
        </text>
      ) : null}
      {armed ? <audio id={id} src={filePath} w={0} h={0} /> : null}
    </row>
  );
};
